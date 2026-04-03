/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Core Audio Engine (Singleton)
//
// 100 % vanilla TypeScript – zero React dependency.
// Designed to be driven by:
//   1. The React bridge (useMixiSync hook)
//   2. An AI agent via MCP commands (future)
//   3. MIDI controllers (future)
//
// Routing graph:
//
//   Source → Trim → EQ → ColorFX ─┬─→ Fader → Xfader → MasterBus
//                                  └─→ CueGain ──────→ HeadphoneBus
//
//   MasterBus: Gain → Limiter → (routing)
//   HeadphoneBus: CueSum + MasterTap → Mix → Level → (routing)
//
//   Output routing (managed by HeadphoneBus):
//     Stereo mode: Master → destination, HP → destination
//     Split mode:  Master → Right ear, HP → Left ear (via merger)
// ─────────────────────────────────────────────────────────────

import { SampleManager } from './SampleManager';
import type { DeckId, EqBand } from '../types';
import { DeckChannel } from './nodes/DeckChannel';
import { MasterBus } from './nodes/MasterBus';
import { HeadphoneBus } from './nodes/HeadphoneBus';
import { crossfaderGains } from './utils/mathUtils';
import { smoothParam } from './utils/paramSmooth';
import { analyzeWaveform } from './WaveformAnalyzer';
import { AudioDeviceGuard } from './AudioDeviceGuard';
import { useMixiStore } from '../store/mixiStore';
import { useSettingsStore, EQ_RANGE_PRESETS } from '../store/settingsStore';

// ── Per-deck transport state (not exposed to store) ──────────

interface DeckTransport {
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  offset: number;
  startedAt: number;
  playbackRate: number;
}

function createTransport(): DeckTransport {
  return {
    buffer: null,
    source: null,
    offset: 0,
    startedAt: 0,
    playbackRate: 1.0,
  };
}

// ─────────────────────────────────────────────────────────────
// MixiEngine – Singleton
// ─────────────────────────────────────────────────────────────

export class MixiEngine {
  private static instance: MixiEngine | null = null;

  private ctx!: AudioContext;
  private channels!: Record<DeckId, DeckChannel>;
  private master!: MasterBus;
  private headphones!: HeadphoneBus;
  private transports!: Record<DeckId, DeckTransport>;
  private initialized = false;
  /** Auto-gain multiplier per deck (set on track load). */
  private autoGain: Record<DeckId, number> = { A: 1, B: 1 };
  /** Per-deck pitch shift AudioWorkletNode for Key Lock. */
  private pitchShifters: Record<DeckId, AudioWorkletNode | null> = { A: null, B: null };
  private _gateTimer: ReturnType<typeof setInterval> | null = null;
  private _keepAliveOsc: OscillatorNode | null = null;
  private _keepAliveGain: GainNode | null = null;
  private _deviceGuard: AudioDeviceGuard | null = null;
  private _visHandler: (() => void) | null = null;
  /** Generation counter per deck — stale async loads are discarded. */
  private _loadGen: Record<DeckId, number> = { A: 0, B: 0 };

  // ── Singleton access ───────────────────────────────────────

  static getInstance(): MixiEngine {
    if (!MixiEngine.instance) {
      MixiEngine.instance = new MixiEngine();
    }
    return MixiEngine.instance;
  }

  /** Cleanup previous instance on HMR module re-evaluation. */
  static _hmrCleanup(): void {
    if (MixiEngine.instance?.initialized) {
      MixiEngine.instance.destroy();
    }
  }

  private constructor() {}

  // ── Lifecycle ──────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    this.ctx = new AudioContext({ sampleRate: 44_100 });

    // Build channel strips.
    this.channels = {
      A: new DeckChannel(this.ctx, 'A'),
      B: new DeckChannel(this.ctx, 'B'),
    };

    // Build master bus.
    this.master = new MasterBus(this.ctx);

    // Build headphone bus.
    this.headphones = new HeadphoneBus(this.ctx);

    // ── Route deck outputs ───────────────────────────────────

    // Master path: Deck xfaderGain → Master input
    this.channels.A.output.connect(this.master.input);
    this.channels.B.output.connect(this.master.input);

    // PFL path: Deck cueGain → HeadphoneBus cue summing input
    this.channels.A.cueOutput.connect(this.headphones.cueSumBus);
    this.channels.B.cueOutput.connect(this.headphones.cueSumBus);

    // ── Output routing ───────────────────────────────────────
    // #42: Both stereo and split paths are always wired.
    // setSplitMode establishes all permanent connections and sets
    // stereoPathGain=1, splitPathGain=0. Master tap also connected inside.
    this.headphones.setSplitMode(false, this.master.output);

    // Transport state.
    this.transports = {
      A: createTransport(),
      B: createTransport(),
    };

    this.initialized = true;

    // Load the pitch-shift AudioWorklet (non-blocking).
    this.loadPitchWorklet();

    // Boot SampleManager
    const sm = SampleManager.getInstance();
    sm.setContext(this.ctx);
    sm.boot(); // Fire and forget so we don't block the rest of engine boot

    // Edge-case #21: Resume AudioContext when tab regains focus.
    this._visHandler = () => {
      if (!document.hidden && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    };
    document.addEventListener('visibilitychange', this._visHandler);

    // Edge-case #34: Safari silent keep-alive.
    // An inaudible oscillator prevents Safari/iOS from aggressively
    // suspending the AudioContext during idle periods.
    this._keepAliveGain = this.ctx.createGain();
    this._keepAliveGain.gain.value = 0.0001; // essentially silent
    this._keepAliveOsc = this.ctx.createOscillator();
    this._keepAliveOsc.frequency.value = 1;
    this._keepAliveOsc.connect(this._keepAliveGain);
    this._keepAliveGain.connect(this.ctx.destination);
    this._keepAliveOsc.start();

    // Edge-case #38: Monitor audio device disconnection.
    this._deviceGuard = new AudioDeviceGuard(this.ctx);
    this._deviceGuard.start();

    // Gate scheduling tick — 50ms interval for both decks
    this._gateTimer = setInterval(() => {
      const state = useMixiStore.getState();
      for (const d of ['A', 'B'] as const) {
        if (!this.channels[d].fx.isGateActive) continue;
        const deck = state.decks[d];
        if (deck.isPlaying && deck.bpm > 0) {
          const t = this.getCurrentTime(d);
          this.channels[d].updateGate(deck.bpm, t, deck.firstBeatOffset);
        }
      }
    }, 50);
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Audio output latency in seconds (0 if not initialized). */
  get latency(): number {
    return this.initialized ? (this.ctx.baseLatency || 0) : 0;
  }

  /** Expose AudioContext for MediaRecorder / analysis. */
  getAudioContext(): AudioContext {
    this.assertReady();
    return this.ctx;
  }

  /** Expose master output node (AnalyserNode) for MediaRecorder. */
  getMasterOutput(): AnalyserNode {
    this.assertReady();
    return this.master.output;
  }

  /** Expose device guard for settings UI to change output device. */
  get deviceGuard(): AudioDeviceGuard | null {
    return this._deviceGuard;
  }

  /** Expose a deck's channel strip (for groovebox / external sources). */
  getChannel(deckId: DeckId): DeckChannel | null {
    return this.initialized ? this.channels[deckId] : null;
  }

  async destroy(): Promise<void> {
    if (!this.initialized) return;

    if (this._gateTimer) {
      clearInterval(this._gateTimer);
      this._gateTimer = null;
    }

    if (this._keepAliveOsc) {
      this._keepAliveOsc.stop();
      this._keepAliveOsc.disconnect();
      this._keepAliveOsc = null;
    }
    if (this._keepAliveGain) {
      this._keepAliveGain.disconnect();
      this._keepAliveGain = null;
    }

    if (this._deviceGuard) {
      this._deviceGuard.destroy();
      this._deviceGuard = null;
    }

    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }

    for (const id of ['A', 'B'] as DeckId[]) {
      this.stopSource(id);
      if (this.pitchShifters[id]) {
        this.pitchShifters[id]!.disconnect();
        this.pitchShifters[id] = null;
      }
    }

    this.channels.A.destroy();
    this.channels.B.destroy();
    this.master.destroy();
    this.headphones.destroy();

    if (this.ctx.state !== 'closed') {
      await this.ctx.close();
    }
    this.initialized = false;
    MixiEngine.instance = null;
  }

  // ── Track Loading ──────────────────────────────────────────

  /** Maximum file size allowed for decoding (200 MB). */
  private static MAX_FILE_SIZE = 200 * 1024 * 1024;

  async loadTrack(deck: DeckId, arrayBuffer: ArrayBuffer): Promise<void> {
    this.assertReady();

    // BUG-21: Increment load generation so stale async loads are discarded.
    const gen = ++this._loadGen[deck];

    // Edge-case #17: Reject huge files before decodeAudioData OOMs the tab.
    if (arrayBuffer.byteLength > MixiEngine.MAX_FILE_SIZE) {
      throw new Error(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB). Maximum is 200MB.`);
    }

    // Edge-case #20: Catch corrupt / undecodable files.
    let buffer: AudioBuffer;
    try {
      buffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
      const detail = err instanceof Error ? ` (${err.message})` : '';
      throw new Error(
        `File could not be decoded${detail}. ` +
        'Supported formats: MP3, WAV, FLAC, OGG, AAC/M4A. ' +
        'AIFF-C (compressed) is not supported in most browsers.'
      );
    }

    // BUG-21: If another load or eject happened while we were decoding, bail.
    if (this._loadGen[deck] !== gen) return;

    const transport = this.transports[deck];
    const wasPlaying = !!transport.source;

    this.stopSource(deck);

    // Edge-case #18: Explicitly release previous buffer for GC.
    transport.buffer = null;

    transport.buffer = buffer;
    transport.offset = 0;
    transport.startedAt = 0;

    const analysis = await analyzeWaveform(buffer);

    // BUG-21: Check generation again after second await.
    if (this._loadGen[deck] !== gen) return;

    const store = useMixiStore.getState();
    store.setDeckWaveform(deck, analysis.waveform, buffer.duration);
    store.setDeckBpm(deck, analysis.bpm, analysis.firstBeatOffset);
    store.setDeckAnalysis(deck, analysis.dropBeats, analysis.musicalKey);

    // ── Auto-gain: normalise trim so all tracks peak at 0 dBFS ──
    this.autoGain[deck] = Math.min(2.0, Math.max(0.5, 1 / analysis.peakLevel));
    this.applyTrimGain(deck, useMixiStore.getState().decks[deck].gain);

    // BUG-09: If the deck was playing before load, restart playback.
    if (wasPlaying) {
      this.play(deck);
    }
  }

  // ── Transport Controls ─────────────────────────────────────

  play(deck: DeckId): void {
    this.assertReady();
    const transport = this.transports[deck];
    if (!transport.buffer) return;
    if (transport.source) return;

    const source = this.ctx.createBufferSource();
    source.buffer = transport.buffer;
    source.playbackRate.value = transport.playbackRate;

    // Restore loop state if a loop was active before pause.
    const loopState = useMixiStore.getState().decks[deck].activeLoop;
    if (loopState) {
      source.loop = true;
      source.loopStart = loopState.start;
      source.loopEnd = loopState.end;
    }

    this.connectSource(deck, source);

    source.onended = () => {
      if (transport.source === source) {
        transport.source = null;
        transport.offset = 0;
        transport.startedAt = 0;
        // Sync store: track ended naturally.
        useMixiStore.getState().setDeckPlaying(deck, false);
      }
    };

    source.start(0, transport.offset);
    transport.source = source;
    transport.startedAt = this.ctx.currentTime;
  }

  pause(deck: DeckId): void {
    this.assertReady();
    const transport = this.transports[deck];
    if (!transport.source) return;

    // BUG-11: Use getCurrentTime() which correctly handles loop wrapping.
    transport.offset = this.getCurrentTime(deck);
    this.stopSource(deck);
  }

  // ── EQ ─────────────────────────────────────────────────────

  setEq(deck: DeckId, band: EqBand, db: number): void {
    this.assertReady();
    const rangeMin = EQ_RANGE_PRESETS[useSettingsStore.getState().eqRange].min;
    this.channels[deck].setEq(band, db, this.ctx, rangeMin);
  }

  // ── Channel Volume (Line Fader) ────────────────────────────

  setDeckVolume(deck: DeckId, value: number): void {
    this.assertReady();
    this.channels[deck].setVolume(value, this.ctx);
  }

  // ── Crossfader ─────────────────────────────────────────────

  setCrossfader(value: number): void {
    this.assertReady();
    const curve = useMixiStore.getState().crossfaderCurve;
    const { gainA, gainB } = crossfaderGains(value, curve);
    this.channels.A.setXfaderGain(gainA, this.ctx);
    this.channels.B.setXfaderGain(gainB, this.ctx);
  }

  // ── Deck Gain (user trim) ───────────────────────────────────

  /**
   * Set the user-controlled gain/trim for a deck.
   * Combined with auto-gain to set the actual trimGain node.
   * @param db – gain in dB (-12 to +12, 0 = unity)
   */
  setDeckGain(deck: DeckId, db: number): void {
    this.assertReady();
    this.applyTrimGain(deck, db);
  }

  private applyTrimGain(deck: DeckId, userDb: number): void {
    const userLinear = Math.pow(10, userDb / 20);
    const combined = this.autoGain[deck] * userLinear;
    smoothParam(this.channels[deck].trimGain.gain, combined, this.ctx);
  }

  // ── Master Volume ──────────────────────────────────────────

  setMasterVolume(value: number): void {
    this.assertReady();
    this.master.setVolume(value, this.ctx);
  }

  // ── Color FX ───────────────────────────────────────────────

  setColorFx(deck: DeckId, value: number): void {
    this.assertReady();
    this.channels[deck].setColorFx(value, this.ctx);
  }

  // ── Playback Rate (Pitch/Tempo) ────────────────────────────

  setPlaybackRate(deck: DeckId, rate: number): void {
    this.assertReady();
    const transport = this.transports[deck];
    transport.playbackRate = rate;

    if (transport.source) {
      smoothParam(transport.source.playbackRate, rate, this.ctx);
    }

    // When Key Lock is ON, update the pitch compensation ratio.
    const shifter = this.pitchShifters[deck];
    if (shifter && useMixiStore.getState().decks[deck].keyLock) {
      shifter.port.postMessage({ type: 'setPitchRatio', value: 1 / rate });
    }
  }

  // ── VU Metering ─────────────────────────────────────────────

  /**
   * Expose the per-deck AnalyserNode for frequency-domain reads
   * (used by the jog wheel triband spiral visualization).
   */
  getDeckAnalyser(deck: DeckId): AnalyserNode | null {
    if (!this.initialized) return null;
    return this.channels[deck].analyser;
  }

  /** Shared buffer — reused to avoid GC. */
  private _vuBuf: Float32Array<ArrayBuffer> | null = null;

  /**
   * Read the current RMS level (0–1) from the post-fader
   * AnalyserNode for a deck.  Called by VuMeter at ~30 FPS.
   */
  getLevel(deck: DeckId): number {
    if (!this.initialized) return 0;
    const analyser = this.channels[deck].analyser;
    if (!this._vuBuf || this._vuBuf.length !== analyser.fftSize) {
      this._vuBuf = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(this._vuBuf);

    // Compute RMS.
    let sum = 0;
    for (let i = 0; i < this._vuBuf.length; i++) {
      const s = this._vuBuf[i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / this._vuBuf.length);

    // Scale: RMS of a full-scale sine is ~0.707.
    // Map 0–0.707 to 0–1 for display.
    return Math.min(1, rms * 1.414);
  }

  /** Shared buffer for master analyser — reused to avoid GC. */
  private _masterBuf: Float32Array<ArrayBuffer> | null = null;

  /**
   * Read the current RMS level (0–1) from the post-limiter
   * master AnalyserNode. Called by MasterLedScreen at ~30 FPS.
   */
  getMasterLevel(): number {
    if (!this.initialized) return 0;
    const analyser = this.master.analyser;
    if (!this._masterBuf || this._masterBuf.length !== analyser.fftSize) {
      this._masterBuf = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(this._masterBuf);

    let sum = 0;
    for (let i = 0; i < this._masterBuf.length; i++) {
      const s = this._masterBuf[i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / this._masterBuf.length);
    return Math.min(1, rms * 1.414);
  }

  /**
   * Read the current limiter gain reduction in dB (0 = no reduction,
   * negative = compressing). Used by MasterLedScreen.
   */
  getLimiterReduction(): number {
    if (!this.initialized) return 0;
    return this.master.limiter.reduction;
  }

  // ── Stereo Spatializer Data ────────────────────────────────

  /**
   * Fill the provided L/R buffers with time-domain data from
   * the master stereo split analysers. Returns the number of
   * samples written (= analyser.fftSize).
   * Used by the spatializer/vectorscope at ~30 FPS.
   */
  getMasterStereoData(outL: Float32Array<ArrayBuffer>, outR: Float32Array<ArrayBuffer>): number {
    if (!this.initialized) return 0;
    const aL = this.master.analyserL;
    const aR = this.master.analyserR;
    aL.getFloatTimeDomainData(outL);
    aR.getFloatTimeDomainData(outR);
    return aL.fftSize;
  }

  /** The fftSize of the stereo analysers — call once to allocate buffers. */
  get stereoAnalyserSize(): number {
    if (!this.initialized) return 512;
    return this.master.analyserL.fftSize;
  }

  // ── Distortion ─────────────────────────────────────────────

  /** Set master filter (-1 = full LPF, 0 = bypass, +1 = full HPF). */
  setMasterFilter(knob: number): void {
    if (!this.initialized) return;
    this.master.setFilter(knob, this.ctx);
  }

  /** Set master distortion amount (0 = off, 1 = full). */
  setDistortion(amount: number): void {
    if (!this.initialized) return;
    this.master.setDistortion(amount, this.ctx);
  }

  /** Set master punch compression (0 = off, 1 = full parallel compression). */
  setPunch(amount: number): void {
    if (!this.initialized) return;
    this.master.setPunch(amount, this.ctx);
  }

  // ── Per-Deck FX ─────────────────────────────────────────────

  /** Set a per-deck FX amount and active state. */
  setDeckFx(deck: DeckId, fxId: string, amount: number, active: boolean): void {
    if (!this.initialized) return;
    this.channels[deck].setFx(fxId as import('./nodes/DeckFx').FxId, amount, active, this.ctx);
  }

  /** BUG-13/19: Reset all FX on a deck (used by ejectDeck). */
  resetDeckFx(deck: DeckId): void {
    if (!this.initialized) return;
    this.channels[deck].fx.resetAllFx(this.ctx);
  }

  /** BUG-21: Bump load generation so in-flight decodes are discarded. */
  bumpLoadGen(deck: DeckId): void {
    this._loadGen[deck]++;
  }

  // ── PFL / CUE ──────────────────────────────────────────────

  /** Activate or deactivate the CUE (PFL) send for a deck. */
  setCueActive(deck: DeckId, active: boolean): void {
    this.assertReady();
    this.channels[deck].setCueActive(active, this.ctx);
  }

  // ── Headphone Controls ─────────────────────────────────────

  /**
   * Set the CUE / MASTER mix knob.
   * mix = 0 → all CUE, mix = 1 → all MASTER.
   */
  setHeadphoneMix(mix: number): void {
    this.assertReady();
    this.headphones.setMix(mix, this.master.output);
  }

  /** Set headphone output level (0–1). */
  setHeadphoneLevel(value: number): void {
    this.assertReady();
    this.headphones.setLevel(value);
  }

  /**
   * Toggle Mono Split output mode.
   *
   * When ON:  L = Headphone (CUE), R = Master
   * When OFF: Both → destination (stereo overlay)
   */
  setSplitMode(enabled: boolean): void {
    this.assertReady();
    this.headphones.setSplitMode(enabled, this.master.output);
  }

  // ── Seeking (Hot Cue jumps) ────────────────────────────────

  seek(deck: DeckId, time: number): void {
    this.assertReady();
    const transport = this.transports[deck];
    if (!transport.buffer) return;

    const clampedTime = Math.max(0, Math.min(time, transport.buffer.duration));

    if (!transport.source) {
      transport.offset = clampedTime;
      return;
    }

    const trim = this.channels[deck].trimGain.gain;
    const now = this.ctx.currentTime;
    const FADE = 0.005; // 5 ms micro-fade

    // ── Fade-out on audio thread ────────────────────────────
    trim.cancelScheduledValues(now);
    trim.setValueAtTime(trim.value, now);
    trim.linearRampToValueAtTime(0, now + FADE);

    // ── Prepare new source immediately (no setTimeout jitter)
    // It will start at the precise audio-thread time after the fade.
    const startAt = now + FADE;

    // Stop & disconnect old source *after* the fade completes.
    // We rely on the old source's gain being 0 at startAt.
    this.stopSource(deck);

    const source = this.ctx.createBufferSource();
    source.buffer = transport.buffer;
    source.playbackRate.value = transport.playbackRate;

    const loopState = useMixiStore.getState().decks[deck].activeLoop;
    if (loopState) {
      source.loop = true;
      source.loopStart = loopState.start;
      source.loopEnd = loopState.end;
    }

    this.connectSource(deck, source);

    source.onended = () => {
      if (transport.source === source) {
        transport.source = null;
        transport.offset = 0;
        transport.startedAt = 0;
      }
    };

    // Schedule the new source to start exactly when the fade-out finishes.
    source.start(startAt, clampedTime);
    transport.source = source;
    transport.offset = clampedTime;
    transport.startedAt = startAt;

    // ── Fade-in at the precise start moment ─────────────────
    // Restore the correct auto-gain × user-trim level (not hardcoded 1).
    const userDb = useMixiStore.getState().decks[deck].gain;
    const userLinear = Math.pow(10, userDb / 20);
    const trimTarget = this.autoGain[deck] * userLinear;
    trim.setValueAtTime(0, startAt);
    trim.linearRampToValueAtTime(trimTarget, startAt + FADE);
  }

  // ── Looping ────────────────────────────────────────────────

  /**
   * Edge-case #32: Snap a time value to the nearest zero-crossing in the
   * audio buffer, searching within ±windowSamples of the ideal point.
   * This eliminates clicks at loop boundaries.
   */
  private snapToZeroCrossing(
    buffer: AudioBuffer, timeSec: number, windowSamples = 2048,
  ): number {
    const sr = buffer.sampleRate;
    const idealSample = Math.round(timeSec * sr);
    const data = buffer.getChannelData(0); // use L channel
    const lo = Math.max(0, idealSample - windowSamples);
    const hi = Math.min(data.length - 1, idealSample + windowSamples);

    let bestIdx = idealSample;
    let bestAbs = Math.abs(data[idealSample] ?? 1);

    for (let i = lo; i <= hi; i++) {
      const v = Math.abs(data[i]);
      if (v < bestAbs) {
        bestAbs = v;
        bestIdx = i;
      }
    }
    return bestIdx / sr;
  }

  setLoop(deck: DeckId, startTime: number, endTime: number): void {
    this.assertReady();
    const transport = this.transports[deck];
    if (!transport.source) return;

    // #32: Snap loop boundaries to nearest zero-crossing to avoid clicks.
    const buf = transport.buffer;
    const loopStart = buf ? this.snapToZeroCrossing(buf, startTime) : startTime;
    const loopEnd = buf ? this.snapToZeroCrossing(buf, endTime) : endTime;

    transport.source.loop = true;
    transport.source.loopStart = loopStart;
    transport.source.loopEnd = loopEnd;

    const currentPos = this.getCurrentTime(deck);
    if (currentPos > endTime || currentPos < startTime) {
      this.seek(deck, startTime);
    }
  }

  exitLoop(deck: DeckId): void {
    this.assertReady();
    const transport = this.transports[deck];
    if (!transport.source) return;
    transport.source.loop = false;
  }

  // ── Playback Position ──────────────────────────────────────

  getCurrentTime(deck: DeckId): number {
    if (!this.initialized) return 0;
    const transport = this.transports[deck];
    if (!transport.buffer) return 0;

    if (transport.source) {
      const elapsed =
        (this.ctx.currentTime - transport.startedAt) * transport.playbackRate;
      let pos = transport.offset + elapsed;

      // When looping, the Web Audio API wraps playback internally
      // but our elapsed calculation keeps counting linearly.
      // Wrap pos to the loop region so the UI stays in sync.
      if (transport.source.loop && transport.source.loopEnd > transport.source.loopStart) {
        const loopStart = transport.source.loopStart;
        const loopEnd = transport.source.loopEnd;
        const loopLen = loopEnd - loopStart;
        if (pos >= loopEnd) {
          pos = loopStart + ((pos - loopStart) % loopLen);
        }
      } else {
        pos = pos % transport.buffer.duration;
      }

      return pos;
    }

    return transport.offset;
  }

  // ── Internal Helpers ───────────────────────────────────────

  private stopSource(deck: DeckId): void {
    const transport = this.transports[deck];
    if (transport.source) {
      transport.source.onended = null;
      // Memory Leak Fix for WebAudio: Disable loop so the buffer isn't pinned indefinitely
      transport.source.loop = false; 
      try {
        transport.source.stop();
      } catch {
        // stop() throws if already stopped – harmless.
      }
      transport.source.disconnect();
      transport.source.buffer = null; // Hard wipe buffer reference
      transport.source = null;
    }
  }

  // ── Pitch Shift / Key Lock ────────────────────────────────

  /**
   * Load the pitch-shift AudioWorklet and create per-deck nodes.
   * Called once from init(); failures are non-fatal (key lock
   * simply won't be available).
   */
  private async loadPitchWorklet(): Promise<void> {
    try {
      await this.ctx.audioWorklet.addModule(
        new URL('./pitch-shift-processor.ts', import.meta.url),
      );

      for (const deck of ['A', 'B'] as const) {
        const node = new AudioWorkletNode(this.ctx, 'pitch-shift-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.connect(this.channels[deck].input);
        this.pitchShifters[deck] = node;
      }
    } catch (err) {
      console.warn('MixiEngine: pitch-shift worklet failed to load', err);
    }
  }

  /**
   * Connect a source to the deck's audio input, routing through
   * the pitch shifter when available.
   */
  private connectSource(deck: DeckId, source: AudioBufferSourceNode): void {
    const shifter = this.pitchShifters[deck];
    if (shifter) {
      source.connect(shifter);
    } else {
      source.connect(this.channels[deck].input);
    }
  }

  /**
   * Enable / disable key lock for a deck.
   * Sends enable flag to the worklet and recomputes the pitch ratio.
   */
  setKeyLock(deck: DeckId, enabled: boolean): void {
    this.assertReady();
    const shifter = this.pitchShifters[deck];
    if (!shifter) return;

    shifter.port.postMessage({ type: 'setEnabled', value: enabled });

    if (enabled) {
      const rate = this.transports[deck].playbackRate;
      shifter.port.postMessage({ type: 'setPitchRatio', value: 1 / rate });
    }
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error(
        'MixiEngine: not initialised. Call init() from a user gesture first.',
      );
    }
  }
}

// ── HMR cleanup: prevent stale timers / AudioContexts ────────
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    MixiEngine._hmrCleanup();
  });
}
