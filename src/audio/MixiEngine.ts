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
import { findAutoCuePoint } from './autoCue';
import { phaseLockLoop } from './PhaseLockLoop';
import { AudioDeviceGuard } from './AudioDeviceGuard';
import { useMixiStore } from '../store/mixiStore';
import { useSettingsStore, EQ_RANGE_PRESETS } from '../store/settingsStore';
import { log } from '../utils/logger';
import { telemetry } from '../utils/TelemetryService';
import { LocalParamBus, SharedParamBus, PARAM_BUS_SIZE } from './dsp';
import { DspParamWriter } from './dsp/DspParamWriter';
import { WasmDspBridge } from './dsp/WasmDspBridge';
import { NativeAudioBridge } from './native/NativeAudioBridge';

import { AudioStreamingBuffer } from './AudioStreamingBuffer';

// ── Per-deck transport state (not exposed to store) ──────────

interface DeckTransport {
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  offset: number;
  startedAt: number;
  playbackRate: number;
  /** Slip mode: ctx.currentTime when slip started (null = not slipping). */
  slipStartTime: number | null;
  /** Slip mode: transport offset at the moment slip was engaged. */
  slipRealOffset: number;

  // Decimated Streaming variables:
  streamingBuffer: AudioStreamingBuffer | null;
  currentSegmentStart: number;
  currentSegmentDuration: number;
  totalDuration: number;
  isTransitioning?: boolean;
}

function createTransport(): DeckTransport {
  return {
    buffer: null,
    source: null,
    gain: null,
    offset: 0,
    startedAt: 0,
    playbackRate: 1.0,
    slipStartTime: null,
    slipRealOffset: 0,
    streamingBuffer: null,
    currentSegmentStart: 0,
    currentSegmentDuration: 0,
    totalDuration: 0,
    isTransitioning: false,
  };
}

// ─────────────────────────────────────────────────────────────
// MixiEngine – Singleton
// ─────────────────────────────────────────────────────────────

export class MixiEngine {
  private static instance: MixiEngine | null = null;

  private ctx!: AudioContext;
  private _channels!: Record<DeckId, DeckChannel>;

  /** Read-only access to deck channel strips (for analyser nodes, VFX, etc.) */
  get channels(): Record<DeckId, DeckChannel> {
    return this._channels;
  }
  private master!: MasterBus;
  private headphones!: HeadphoneBus;
  private transports!: Record<DeckId, DeckTransport>;
  private initialized = false;
  /** Auto-gain multiplier per deck (set on track load). */
  private autoGain: Record<DeckId, number> = { A: 1, B: 1 };
  /** Per-deck pitch shift AudioWorkletNode for Key Lock. */
  private pitchShifters: Record<DeckId, AudioWorkletNode | null> = { A: null, B: null };
  private _gateTimer: ReturnType<typeof setInterval> | null = null;
  private _streamingLookAheadTimer: ReturnType<typeof setInterval> | null = null;
  private _keepAliveOsc: OscillatorNode | null = null;
  private _keepAliveGain: GainNode | null = null;
  private _deviceGuard: AudioDeviceGuard | null = null;
  private _visHandler: (() => void) | null = null;
  /** Generation counter per deck — stale async loads are discarded. */
  private _loadGen: Record<DeckId, number> = { A: 0, B: 0 };
  /** Analysis queue — serialize waveform analysis to avoid 6 concurrent OfflineAudioContext jobs. */
  private _analysisQueue: Promise<void> = Promise.resolve();

  /** DSP Parameter Writer — populates the shared param bus for Wasm DSP. */
  private _paramWriter: DspParamWriter | null = null;
  /** Unsubscribe for the store→param-bus flush subscription (live updates). */
  private _paramFlushUnsub: (() => void) | null = null;
  /** Gain-0 tap that keeps the per-deck WebAudio chains rendering (for VU
   *  analysers) while the Wasm DSP worklet carries the actual audio. */
  private _meterKeepAlive: GainNode | null = null;
  /** Wasm DSP bridge — manages AudioWorklet lifecycle. */
  private _wasmBridge: WasmDspBridge | null = null;

  // ── Native Audio I/O ──────────────────────────────────────
  private _nativeOutputActive = false;
  private _nativeOutputTap: AudioWorkletNode | null = null;
  private _nativeOutputRing: SharedArrayBuffer | null = null;
  /** Ring buffer capacity in frames for native output. */
  private static NATIVE_RING_FRAMES = 4096; // ~93ms at 44.1kHz
  /** Number of output channels for native ring buffer. */
  private static NATIVE_RING_CHANNELS = 2; // stereo master

  /** Public access to the param writer (for useMixiSync). */
  get paramWriter(): DspParamWriter | null { return this._paramWriter; }
  /** Public access to the wasm bridge state. */
  get wasmDspActive(): boolean { return this._wasmBridge?.isReady ?? false; }
  /** Whether native (cpal) audio output is active. */
  get nativeOutputActive(): boolean { return this._nativeOutputActive; }
  /** The shared ring buffer for native output (null when inactive). */
  get nativeOutputRing(): SharedArrayBuffer | null { return this._nativeOutputRing; }

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

  /** Port of DeckChannel.setColorFx → (freq Hz, Q) for the Wasm color filter.
   *  CRITICAL: colorFx===0 must map to 20000 Hz (open), NOT 0 — the Rust engine
   *  only (re)applies the lowpass when freq>20, so writing 0 would leave a stale
   *  narrow filter engaged and muffle/kill the signal. */
  private colorFxToFilter(cf: number): { freq: number; q: number } {
    if (cf === 0) return { freq: 20000, q: 0.707 };
    const t = cf < 0 ? 1 + cf : cf;
    const freq = 20 * Math.pow(1000, t);
    const norm = Math.log(Math.max(20, freq) / 20) / Math.log(1000);
    const taper = 1 - 0.6 * Math.pow(2 * Math.abs(norm - 0.5), 2);
    return { freq, q: 1.5 * Math.max(0.3, taper) };
  }

  /**
   * Write the ENTIRE current mixer state into the DSP param bus via the param
   * writer. The Wasm worklet reads this bus every quantum; without it every gain
   * is 0 and the Rust engine smooths to SILENCE (the param bus was never wired —
   * the DspParamWriter setters were dead code). Units are matched to the Rust
   * engine: FADER is RAW volume (Rust cubes it), EQ is in dB, COLOR_FREQ is Hz,
   * per-deck XFADER_GAIN is the crossfader gain. Called once when the Wasm
   * SharedParamBus is created, and on every store change for live updates.
   */
  private flushParamStateFromStore(): void {
    const w = this._paramWriter;
    if (!w) return;
    const s = useMixiStore.getState();

    // ── Master ──
    w.setMasterGain(s.master.volume);
    w.setMasterFilter(s.master.filter);
    w.setMasterDistortion(s.master.distortion, s.master.distortion > 0.01);
    w.setMasterPunch(s.master.punch, s.master.punch > 0.01);
    w.setMasterLimiter(true, -0.5);

    // ── Crossfader → per-deck gains (CRITICAL: 0 = silence) ──
    const curve = s.crossfaderCurve;
    const { gainA, gainB } = crossfaderGains(s.crossfader, curve);
    w.setCrossfader(s.crossfader);
    w.setCrossfaderCurve(curve === 'sharp' ? 1 : 0);
    w.setDeckXfaderGain('A', gainA);
    w.setDeckXfaderGain('B', gainB);

    // ── Per-deck ──
    for (const deck of ['A', 'B'] as const) {
      const d = s.decks[deck];
      w.setDeckFader(deck, d.volume);                                   // CRITICAL — Rust cubes it
      w.setDeckTrim(deck, this.autoGain[deck] * Math.pow(10, d.gain / 20));
      w.setDeckEq(deck, 'low', d.eq.low);                              // dB, NOT linear
      w.setDeckEq(deck, 'mid', d.eq.mid);
      w.setDeckEq(deck, 'high', d.eq.high);
      const { freq, q } = this.colorFxToFilter(d.colorFx);
      w.setDeckColorFreq(deck, freq);
      w.setDeckColorRes(deck, q);
      w.setDeckPlaybackRate(deck, d.playbackRate);
      w.setDeckCue(deck, d.cueActive);
      w.setDeckAutoGain(deck, this.autoGain[deck]);
    }

    // ── Headphones ──
    w.setHeadphoneMix(s.headphones.mix);
    w.setHeadphoneLevel(s.headphones.level);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    try {
      this.ctx = new AudioContext({ sampleRate: 44_100, latencyHint: 'interactive' });
    } catch (err) {
      log.error('Engine', 'AudioContext creation failed — browser may have denied audio access', err);
      throw new Error(`Audio not available: ${err instanceof Error ? err.message : err}`);
    }

    // Build channel strips with current EQ model.
    const eqModel = useSettingsStore.getState().eqModel;
    this._channels = {
      A: new DeckChannel(this.ctx, 'A', eqModel),
      B: new DeckChannel(this.ctx, 'B', eqModel),
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

    // Segment streaming look-ahead loop (1Hz)
    this._streamingLookAheadTimer = setInterval(() => {
      if (!this.initialized) return;
      for (const deck of ['A', 'B'] as const) {
        void this.checkSegmentTransition(deck).catch(() => {});
      }
    }, 1000);

    // ── DSP Param Bus (Phase 3) ────────────────────────────
    // Create the param bus and writer. In native mode the bus
    // is populated but not consumed. When Wasm DSP activates,
    // the AudioWorklet will read from the SharedArrayBuffer.
    const paramBus = new LocalParamBus(PARAM_BUS_SIZE);
    this._paramWriter = new DspParamWriter(paramBus);
    this._paramWriter.setSampleRate(this.ctx.sampleRate);
    this._paramWriter.setDspBackend(false); // native mode
    log.info('Engine', 'DSP param bus initialised (512 bytes)');

    // Keep the param bus in sync with the store so the Wasm worklet always
    // reads the current mixer state (live EQ/volume/crossfader/etc.). Cheap
    // (~30 float writes) and a no-op until the param writer exists. The initial
    // population for the Wasm SharedParamBus is done explicitly on activation.
    this.flushParamStateFromStore();
    this._paramFlushUnsub = useMixiStore.subscribe(() => this.flushParamStateFromStore());

    // ── Wasm DSP Bridge (conditional) ──────────────────────
    // When active, routes audio through Rust DSP engine in AudioWorklet:
    //   Source A → trimGain A → worklet input[0]
    //   Source B → trimGain B → worklet input[1]
    //   worklet output → master.output (analyser) → destination
    // WebAudio EQ/FX/MasterBus are bypassed (remain for fallback).
    const useWasm = useSettingsStore.getState().useWasmDsp;
    if (useWasm) {
      this._wasmBridge = new WasmDspBridge();
      this._wasmBridge.init(this.ctx).then((ok) => {
        if (ok && this._wasmBridge?.workletNode) {
          // Use SharedParamBus so worklet and paramWriter share the same memory.
          // The bridge's sharedBuffers.paramBus is a SharedArrayBuffer
          // created by createDspBuffers(). We create a SharedParamBus
          // of the same size — it allocates its own SAB which is sent to the worklet.
          // The DspParamWriter writes to this bus, and the worklet reads from it.
          if (this._wasmBridge.sharedBuffers) {
            const sharedBus = new SharedParamBus(PARAM_BUS_SIZE);
            this._paramWriter = new DspParamWriter(sharedBus);
            this._paramWriter.setSampleRate(this.ctx.sampleRate);
            // Re-send the param bus SAB to the worklet so it reads from the same memory
            this._wasmBridge.workletNode!.port.postMessage({
              type: 'init',
              paramBus: sharedBus.buffer,
            });
          }
          this._paramWriter?.setDspBackend(true);

          // CRITICAL: the SharedParamBus above is created asynchronously, AFTER
          // useMixiSync's initial full-state push ran against the previous
          // (native) bus. Without re-pushing, this fresh bus carries only the
          // layout version + sample rate — every gain/volume/EQ/crossfader param
          // is 0, so the Rust DSP applies zero gain and the master is SILENT.
          // Re-apply the full current mixer state so the worklet hears real values.
          this.flushParamStateFromStore();

          // Disconnect WebAudio deck→master chain (the worklet carries the audio now)
          this.channels.A.output.disconnect();
          this.channels.B.output.disconnect();

          // Keep the per-deck WebAudio chains RENDERING so their VU analysers
          // still produce data in Wasm mode. Web Audio only processes nodes with
          // a path to the destination; once the deck output is detached, the
          // analyser branch goes dead and the channel meters freeze at 0. Route
          // the (now silent) outputs through a gain-0 tap to the master so the
          // graph stays live without adding any audio.
          if (!this._meterKeepAlive) {
            this._meterKeepAlive = this.ctx.createGain();
            this._meterKeepAlive.gain.value = 0;
            this._meterKeepAlive.connect(this.master.output);
          }
          this.channels.A.output.connect(this._meterKeepAlive);
          this.channels.B.output.connect(this._meterKeepAlive);

          // Connect deck trims → worklet inputs (0=A, 1=B)
          this._wasmBridge.connectDeckA(this.channels.A.input);
          this._wasmBridge.connectDeckB(this.channels.B.input);

          // Connect worklet output → master analyser → headphone bus → destination
          this._wasmBridge.connectOutput(this.master.output);
          // Also keep CUE/PFL paths via WebAudio (pre-fader listen)
          // trimGain already fans out to cueGain via DeckChannel wiring

          log.success('Engine', 'Wasm DSP path ACTIVE — Rust processing audio');
        } else {
          log.warn('Engine', 'Wasm DSP init failed — using WebAudio path');
          this._paramWriter?.setDspBackend(false);
        }
      }).catch((err) => {
        log.error('Engine', `Wasm DSP error: ${err}`);
        this._paramWriter?.setDspBackend(false);
      });
    }

    // Load the pitch-shift AudioWorklet (non-blocking).
    this.loadPitchWorklet();

    // Boot SampleManager
    const sm = SampleManager.getInstance();
    sm.setContext(this.ctx);
    sm.boot().catch((err: unknown) => {
      log.warn('Engine', `SampleManager boot failed (non-fatal): ${err}`);
    });

    // Edge-case #21: Resume AudioContext when tab regains focus.
    this._visHandler = () => {
      if (!document.hidden && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {/* autoplay policy */});
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

    // Gate scheduling tick — 50ms interval, only reads store when gate is active
    this._gateTimer = setInterval(() => {
      // H4: Skip store read entirely if no gate is active on either deck
      const gateA = this.channels.A.fx.isGateActive;
      const gateB = this.channels.B.fx.isGateActive;
      if (!gateA && !gateB) return;

      const state = useMixiStore.getState();
      if (gateA) {
        const dA = state.decks.A;
        if (dA.isPlaying && dA.bpm > 0) {
          this.channels.A.updateGate(dA.bpm, this.getCurrentTime('A'), dA.firstBeatOffset);
        }
      }
      if (gateB) {
        const dB = state.decks.B;
        if (dB.isPlaying && dB.bpm > 0) {
          this.channels.B.updateGate(dB.bpm, this.getCurrentTime('B'), dB.firstBeatOffset);
        }
      }
    }, 50);
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Get the decoded AudioBuffer for a deck (for analysis). */
  getBuffer(deck: DeckId): AudioBuffer | null {
    if (!this.initialized) return null;
    return this.transports[deck].buffer;
  }

  /** Raw AudioContext.currentTime (for clock reconciliation). */
  getAudioContextTime(): number {
    return this.initialized ? this.ctx.currentTime : 0;
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

    if (this._paramFlushUnsub) {
      this._paramFlushUnsub();
      this._paramFlushUnsub = null;
    }

    if (this._meterKeepAlive) {
      try { this._meterKeepAlive.disconnect(); } catch { /* ok */ }
      this._meterKeepAlive = null;
    }

    if (this._gateTimer) {
      clearInterval(this._gateTimer);
      this._gateTimer = null;
    }

    if (this._streamingLookAheadTimer) {
      clearInterval(this._streamingLookAheadTimer);
      this._streamingLookAheadTimer = null;
    }

    // A1: Clear vinyl brake timers
    for (const d of ['A', 'B'] as const) {
      if (this._brakeTimers[d]) {
        clearTimeout(this._brakeTimers[d]!);
        this._brakeTimers[d] = null;
      }
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

    if (this._wasmBridge) {
      this._wasmBridge.destroy();
      this._wasmBridge = null;
    }

    // Cleanup native audio output
    if (this._nativeOutputActive) {
      await this.switchToWebOutput();
    }

    if (this.ctx.state !== 'closed') {
      await this.ctx.close();
    }
    this.initialized = false;
    MixiEngine.instance = null;
  }

  // ── Track Loading ──────────────────────────────────────────

  /** Maximum file size allowed for decoding (2 GB). */
  private static MAX_FILE_SIZE = 2000 * 1024 * 1024;

  async loadTrack(deck: DeckId, arrayBuffer: ArrayBuffer): Promise<void> {
    this.assertReady();
    this._loadInProgress[deck] = true;
    const wasPlaying = useMixiStore.getState().decks[deck].isPlaying;
    const setStage = (stage: string | null) => useMixiStore.getState().setDeckLoadingStage(deck, stage);

    // BUG-21: Increment load generation so stale async loads are discarded.
    const gen = ++this._loadGen[deck];

    // Edge-case #17: Reject huge files before decodeAudioData OOMs the tab.
    if (arrayBuffer.byteLength > MixiEngine.MAX_FILE_SIZE) {
      setStage(null);
      throw new Error(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB). Maximum is 2000MB.`);
    }

    setStage('parsing format');

    const streamingBuffer = new AudioStreamingBuffer(this.ctx, arrayBuffer);
    try {
      await streamingBuffer.initialize();
    } catch (err) {
      setStage(null);
      throw new Error(`Failed to parse track format: ${err}`);
    }

    if (this._loadGen[deck] !== gen) { this._loadInProgress[deck] = false; setStage(null); return; }

    setStage('decoding initial chunk');

    const SEGMENT_DURATION = 300; // 5 minutes
    const initialDuration = Math.min(streamingBuffer.duration, SEGMENT_DURATION);
    let buffer: AudioBuffer;
    try {
      buffer = await streamingBuffer.decodeSegment(0, initialDuration);
    } catch (err) {
      setStage(null);
      throw new Error(`Failed to decode initial chunk: ${err}`);
    }

    // BUG-21: If another load or eject happened while we were decoding, bail.
    if (this._loadGen[deck] !== gen) { this._loadInProgress[deck] = false; setStage(null); return; }

    const transport = this.transports[deck];
    this.stopSource(deck);

    // Edge-case #18: Explicitly release previous buffer for GC.
    transport.buffer = null;

    transport.streamingBuffer = streamingBuffer;
    transport.currentSegmentStart = 0;
    transport.currentSegmentDuration = initialDuration;
    transport.totalDuration = streamingBuffer.duration;
    transport.buffer = buffer;
    transport.offset = 0;
    transport.startedAt = 0;

    setStage('analyzing waveform');

    // Serialize analysis to avoid 6 concurrent OfflineAudioContext jobs
    // when two tracks load simultaneously. Each analysis uses 3 offline
    // renders, so running them in parallel saturates the CPU for 2+ seconds.
    // 15s timeout guards against a hung OfflineAudioContext or Wasm stall —
    // without it a deadlocked queue would block all subsequent track loads.
    let analysis!: Awaited<ReturnType<typeof analyzeWaveform>>;
    await (this._analysisQueue = this._analysisQueue.then(async () => {
      const ANALYSIS_TIMEOUT_MS = 15_000;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('analyzeWaveform timeout')), ANALYSIS_TIMEOUT_MS),
      );
      try {
        analysis = await Promise.race([analyzeWaveform(streamingBuffer), timeout]);
      } catch (err) {
        log.warn('Engine', 'Waveform analysis timed out or failed — using safe defaults', err);
        analysis = {
          waveform: [], bpm: 0, firstBeatOffset: 0, bpmConfidence: 0,
          dropBeats: [], musicalKey: '', musicalKeyName: '', peakLevel: 1,
        } as Awaited<ReturnType<typeof analyzeWaveform>>;
      }
    }));

    // BUG-21: Check generation again after second await.
    if (this._loadGen[deck] !== gen) { this._loadInProgress[deck] = false; setStage(null); return; }

    setStage('detecting BPM & key');

    const store = useMixiStore.getState();
    store.setDeckWaveform(deck, analysis.waveform, transport.totalDuration);
    store.setDeckBpm(deck, analysis.bpm, analysis.firstBeatOffset, analysis.bpmConfidence);
    store.setDeckAnalysis(deck, analysis.dropBeats, analysis.musicalKey);

    setStage('setting cue point');

    // ── Smart Auto-Cue: seek to first energetic downbeat ──
    const autoCue = findAutoCuePoint(buffer, analysis.bpm, analysis.firstBeatOffset);
    if (autoCue > 0.01) {
      transport.offset = autoCue;
    }

    // ── Auto-gain: normalise trim so all tracks peak at 0 dBFS ──
    this.autoGain[deck] = Math.min(2.0, Math.max(0.5, 1 / analysis.peakLevel));
    this.applyTrimGain(deck, useMixiStore.getState().decks[deck].gain);

    this._loadInProgress[deck] = false;
    setStage(null);

    // BUG-09: If the deck was playing before load, restart playback.
    if (wasPlaying) {
      this.play(deck);
    }
  }

  // ── Transport Controls ─────────────────────────────────────

  play(deck: DeckId): void {
    this.assertReady();
    // A4: Don't play while loadTrack is still decoding
    if (this._loadInProgress[deck]) return;
    const transport = this.transports[deck];
    if (!transport.buffer) return;
    if (transport.source) return;

    // Real-time phase alignment on Play
    const store = useMixiStore.getState();
    const thisDeck = store.decks[deck];
    const otherDeckId = deck === 'A' ? 'B' : 'A';
    const other = store.decks[otherDeckId];

    if (thisDeck.isSynced && other.isPlaying) {
      const masterBpm = other.bpm > 0 ? other.bpm : other.originalBpm;
      const effectiveBpm = thisDeck.bpm > 0 ? thisDeck.bpm : thisDeck.originalBpm;
      if (masterBpm > 0 && effectiveBpm > 0) {
        const masterTime = this.getCurrentTime(otherDeckId);
        const masterBeatPeriod = 60 / masterBpm;
        if (masterBeatPeriod > 0 && isFinite(masterBeatPeriod)) {
          // Master's fractional position within current beat (0-1)
          const masterFrac = (((masterTime - other.firstBeatOffset) / masterBeatPeriod) % 1 + 1) % 1;

          // This deck's current time (transport.offset because it's paused/starting) and beat period
          const thisTime = transport.offset;
          const thisBeatPeriod = 60 / effectiveBpm;
          const thisFrac = (((thisTime - thisDeck.firstBeatOffset) / thisBeatPeriod) % 1 + 1) % 1;

          // Phase delta
          let phaseDelta = masterFrac - thisFrac;
          if (phaseDelta > 0.5) phaseDelta -= 1;
          if (phaseDelta < -0.5) phaseDelta += 1;

          let seekOffset = phaseDelta * thisBeatPeriod;

          // Bar / phrase alignment if applicable
          const mode = thisDeck.syncMode;
          if (mode === 'bar' || mode === 'phrase') {
            const groupSize = mode === 'phrase' ? 16 : 4;
            const masterBeat = (masterTime - other.firstBeatOffset) / masterBeatPeriod;
            const thisBeat = (thisTime - thisDeck.firstBeatOffset) / thisBeatPeriod;
            const masterPos = ((masterBeat % groupSize) + groupSize) % groupSize;
            const thisPos = ((thisBeat % groupSize) + groupSize) % groupSize;

            let phraseOffset = Math.round(masterPos - thisPos);
            if (phraseOffset > groupSize / 2) phraseOffset -= groupSize;
            if (phraseOffset < -groupSize / 2) phraseOffset += groupSize;

            seekOffset += phraseOffset * thisBeatPeriod;
          }

          // Apply adjusted offset
          const targetTime = thisTime + seekOffset;
          transport.offset = Math.max(0, Math.min(targetTime, transport.buffer.duration));

          // Reset PLL and briefly freeze to avoid windup/fighting
          phaseLockLoop.reset(deck);
          phaseLockLoop.start();
          phaseLockLoop.freeze(deck);
          setTimeout(() => {
            phaseLockLoop.unfreeze(deck);
          }, 200);
        }
      }
    }

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

    const relativeOffset = Math.max(0, transport.offset - transport.currentSegmentStart);
    source.start(0, relativeOffset);
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

  /** Hot-swap EQ model on both channels. */
  setEqModel(model: import('../store/settingsStore').EqModel): void {
    if (!this.initialized) return;
    this.channels.A.setEqModel(model);
    this.channels.B.setEqModel(model);
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

  // ── Vinyl Brake / Backspin ─────────────────────────────────

  private _brakeTimers: Record<DeckId, ReturnType<typeof setTimeout> | null> = { A: null, B: null };
  // A4: Guard against play() during async loadTrack()
  private _loadInProgress: Record<DeckId, boolean> = { A: false, B: false };

  /**
   * Vinyl brake effect: ramp playbackRate down to 0 over `durationMs`,
   * then pause the deck. Simulates a turntable stopping.
   */
  vinylBrake(deck: DeckId, durationMs = 500): void {
    if (!this.initialized) return;
    const transport = this.transports[deck];
    if (!transport.source) return;

    // Cancel any pending brake
    if (this._brakeTimers[deck]) {
      clearTimeout(this._brakeTimers[deck]!);
      this._brakeTimers[deck] = null;
    }

    const startRate = transport.playbackRate;
    const now = this.ctx.currentTime;
    const durationSec = durationMs / 1000;

    const shifter = this.pitchShifters[deck];
    if (shifter) {
      shifter.port.postMessage({ type: 'brake', durationMs });
    } else {
      // Ramp playbackRate to near-zero using exponential curve (fallback)
      transport.source.playbackRate.cancelScheduledValues(now);
      transport.source.playbackRate.setValueAtTime(startRate, now);
      // exponentialRampToValueAtTime can't reach 0, so ramp to 0.001
      transport.source.playbackRate.exponentialRampToValueAtTime(0.001, now + durationSec);
    }

    // After the ramp completes, pause and restore original rate
    this._brakeTimers[deck] = setTimeout(() => {
      this._brakeTimers[deck] = null;
      this.pause(deck);
      // Restore original playback rate so next play is normal
      transport.playbackRate = startRate;
      if (shifter) {
        shifter.port.postMessage({ type: 'setBaseRate', value: startRate });
      } else if (transport.source) {
        transport.source.playbackRate.value = startRate;
      }
      useMixiStore.getState().setDeckPlaying(deck, false);
    }, durationMs + 20);
  }

  /** Cancel a vinyl brake in progress (e.g., if user presses play again). */
  cancelBrake(deck: DeckId): void {
    if (this._brakeTimers[deck]) {
      clearTimeout(this._brakeTimers[deck]!);
      this._brakeTimers[deck] = null;
      // Restore playback rate
      const transport = this.transports[deck];
      const shifter = this.pitchShifters[deck];
      if (shifter) {
        shifter.port.postMessage({ type: 'cancelBrake' });
      } else if (transport.source) {
        transport.source.playbackRate.cancelScheduledValues(this.ctx.currentTime);
        transport.source.playbackRate.value = transport.playbackRate;
      }
    }
  }

  // ── Slip Mode ──────────────────────────────────────────────

  /**
   * Enter slip mode: save the current "real" playback position.
   * While slipping, the user can seek/loop/jump freely.
   * Audio continues playing normally — only the "snap-back" position is tracked.
   */
  enterSlipMode(deck: DeckId): void {
    if (!this.initialized) return;
    const transport = this.transports[deck];
    if (transport.slipStartTime !== null) return; // already slipping

    transport.slipRealOffset = this.getCurrentTime(deck);
    transport.slipStartTime = this.ctx.currentTime;
  }

  /**
   * Exit slip mode: snap audio to where it "would have been" if
   * the user hadn't touched anything since entering slip.
   */
  exitSlipMode(deck: DeckId): void {
    if (!this.initialized) return;
    const transport = this.transports[deck];
    if (transport.slipStartTime === null) return; // not slipping

    const realTime = this.getSlipRealTime(deck);
    transport.slipStartTime = null;
    transport.slipRealOffset = 0;

    // Snap audio to the real position
    if (transport.source && realTime >= 0) {
      const duration = transport.buffer?.duration ?? 0;
      this.seek(deck, Math.min(realTime, duration));
    }
  }

  /**
   * Get the "real" background position during slip mode.
   * This is where audio would be if the user hadn't touched the deck.
   */
  getSlipRealTime(deck: DeckId): number {
    const transport = this.transports[deck];
    if (transport.slipStartTime === null) return -1;
    const elapsed = (this.ctx.currentTime - transport.slipStartTime) * transport.playbackRate;
    return transport.slipRealOffset + elapsed;
  }

  /** Is slip mode active on this deck? */
  isSlipActive(deck: DeckId): boolean {
    return this.transports[deck].slipStartTime !== null;
  }

  // ── Playback Rate (Pitch/Tempo) ────────────────────────────

  setPlaybackRate(deck: DeckId, rate: number): void {
    this.assertReady();
    const transport = this.transports[deck];

    // A3: Preserve position continuity — snapshot current position before rate change.
    // Without this, getCurrentTime() would use the new rate to calculate elapsed time
    // since startedAt, producing an incorrect position for the period before the change.
    if (transport.source) {
      transport.offset = this.getCurrentTime(deck);
      transport.startedAt = this.ctx.currentTime;
    }

    transport.playbackRate = rate;

    const shifter = this.pitchShifters[deck];
    if (shifter) {
      shifter.port.postMessage({ type: 'setBaseRate', value: rate });
    } else if (transport.source) {
      // Apply rate + any active nudge offset so nudge isn't lost on fader move
      const effectiveRate = rate + this._nudge[deck];
      smoothParam(transport.source.playbackRate, effectiveRate, this.ctx);
    }

    // When Key Lock is ON, update the pitch compensation ratio.
    if (shifter && useMixiStore.getState().decks[deck].keyLock) {
      shifter.port.postMessage({ type: 'setPitchRatio', value: 1 / rate });
    }
  }

  // ── Nudge (Temporary Pitch Bend) ─────────────────────────────

  /** Active nudge amounts per deck (0 = no nudge). */
  private _nudge: Record<DeckId, number> = { A: 0, B: 0 };

  /**
   * Per-deck serialization chain. seek / crossfadeSeek / segment-transition all
   * `await` a decode between reading and mutating `transport.source`; without a
   * mutex two of them can interleave and leave an orphan source playing (doubled
   * audio) or an offset that points at a different segment than the live buffer.
   * Every source-swapping async op runs through runDeckExclusive().
   */
  private _deckOpChain: Record<DeckId, Promise<unknown>> = {
    A: Promise.resolve(),
    B: Promise.resolve(),
  };

  /** Run `fn` after any in-flight source-swap on this deck completes. */
  private runDeckExclusive<T>(deck: DeckId, fn: () => Promise<T>): Promise<T> {
    const run = this._deckOpChain[deck].then(fn, fn);
    // Keep the chain alive but swallow errors so one failure can't poison it.
    this._deckOpChain[deck] = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Standard nudge: ±4 %. Fine nudge (Shift): ±1 %. */
  static readonly NUDGE_AMOUNT = 0.04;
  static readonly FINE_NUDGE = 0.01;

  /**
   * Start nudging a deck. Direction: +1 = speed up, -1 = slow down.
   * The nudge is purely temporary — it offsets the playbackRate on the
   * AudioBufferSourceNode without touching the store state, so releasing
   * the key restores the original rate.
   */
  nudgeStart(deck: DeckId, direction: 1 | -1, fine = false): void {
    if (!this.initialized) return;
    // Freeze PLL during manual nudge (anti-windup layer 1)
    phaseLockLoop.freeze(deck);
    const amount = fine ? MixiEngine.FINE_NUDGE : MixiEngine.NUDGE_AMOUNT;
    this._nudge[deck] = direction * amount;

    const transport = this.transports[deck];
    const shifter = this.pitchShifters[deck];
    if (shifter) {
      shifter.port.postMessage({ type: 'setNudge', value: this._nudge[deck] });
    } else if (transport.source) {
      const effectiveRate = transport.playbackRate + this._nudge[deck];
      // Fast attack: 8 ms for instant feel
      smoothParam(transport.source.playbackRate, effectiveRate, this.ctx, 0.008);
    }
  }

  /**
   * Stop nudging — restore the base playback rate.
   * Slower release (40 ms) for smooth return to original pitch.
   */
  nudgeStop(deck: DeckId): void {
    if (!this.initialized) return;
    this._nudge[deck] = 0;
    // Unfreeze PLL after manual nudge
    phaseLockLoop.unfreeze(deck);

    const transport = this.transports[deck];
    const shifter = this.pitchShifters[deck];
    if (shifter) {
      shifter.port.postMessage({ type: 'setNudge', value: 0 });
    } else if (transport.source) {
      // Smooth release back to base rate
      smoothParam(transport.source.playbackRate, transport.playbackRate, this.ctx, 0.040);
    }
  }

  /**
   * Apply a PLL-corrected rate directly to the AudioNode.
   * Does NOT touch the store — this is a micro-correction invisible to the UI.
   */
  applyPllRate(deck: DeckId, rate: number): void {
    if (!this.initialized) return;
    const transport = this.transports[deck];
    const shifter = this.pitchShifters[deck];
    if (shifter) {
      // With relocated PLL, micro-corrections are calculated inside the worklet itself.
      // We do not need to call applyPllRate for the worklet, as the worklet control signal handles it.
    } else if (transport.source) {
      // Very gentle smoothing for PLL: 20ms time constant
      smoothParam(transport.source.playbackRate, rate, this.ctx, 0.020);
    }
  }

  /** Returns the current nudge offset for a deck (used by phase meter). */
  getNudge(deck: DeckId): number {
    return this._nudge[deck];
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
  /** Per-deck level cache: avoid duplicate getFloatTimeDomainData per frame. */
  private _levelCache = { A: 0, B: 0, frameA: -1, frameB: -1 };

  /**
   * Read the current RMS level (0–1) from the post-fader
   * AnalyserNode for a deck.  Multiple callers per frame get the
   * cached value — only one getFloatTimeDomainData copy per frame.
   */
  getLevel(deck: DeckId): number {
    if (!this.initialized) return 0;

    // Frame-stamp cache: avoid redundant analyser reads within the same RAF frame
    const frameNow = (performance.now() | 0);  // ~1ms granularity is enough
    const cacheKey = deck === 'A' ? 'frameA' : 'frameB';
    if (Math.abs(frameNow - this._levelCache[cacheKey]) < 8) {
      return this._levelCache[deck];
    }

    const analyser = this.channels[deck].analyser;
    if (!this._vuBuf || this._vuBuf.length !== analyser.fftSize) {
      this._vuBuf = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(this._vuBuf);

    let sum = 0;
    for (let i = 0; i < this._vuBuf.length; i++) {
      const s = this._vuBuf[i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / this._vuBuf.length);
    const level = Math.min(1, rms * 1.414);

    this._levelCache[deck] = level;
    this._levelCache[cacheKey] = frameNow;
    return level;
  }

  /** Shared buffer for master analyser — reused to avoid GC. */
  private _masterBuf: Float32Array<ArrayBuffer> | null = null;
  /** Master level cache: avoid duplicate getFloatTimeDomainData per frame. */
  private _masterLevelCache = { value: 0, frame: -1 };

  /**
   * Read the current RMS level (0–1) from the post-limiter
   * master AnalyserNode. Multiple callers per frame (MiniVu,
   * MasterVuMeter, MasterLedScreen) get the cached value.
   */
  getMasterLevel(): number {
    if (!this.initialized) return 0;

    const frameNow = (performance.now() | 0);
    if (Math.abs(frameNow - this._masterLevelCache.frame) < 8) {
      return this._masterLevelCache.value;
    }

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
    const level = Math.min(1, rms * 1.414);

    this._masterLevelCache.value = level;
    this._masterLevelCache.frame = frameNow;
    return level;
  }

  /**
   * E2E diagnostic snapshot. Only reachable via the env-gated
   * `window.__MIXI_ENGINE__` (see main.tsx). A single call both asserts
   * non-silence (masterRms / levelL / levelR from the post-limiter analyser,
   * which both the WebAudio and Wasm-DSP paths feed) AND pinpoints the failure
   * mode: rateA===0 ⇒ the pitch-shifter never un-froze the source;
   * wasmActive≠expected ⇒ Wasm DSP path; ctxState!=='running' ⇒ suspended.
   */
  __e2eAudioProbe(): Record<string, unknown> {
    const tA = this.transports?.A;
    const tB = this.transports?.B;
    return {
      initialized: this.initialized,
      ctxState: this.initialized ? this.ctx.state : 'uninit',
      wasmActive: this.wasmDspActive,
      masterRms: this.getMasterLevel(),
      levelL: this.getMasterLevelL(),
      levelR: this.getMasterLevelR(),
      deckLevelA: this.getLevel('A'),
      deckLevelB: this.getLevel('B'),
      currentTimeA: this.getCurrentTime('A'),
      currentTimeB: this.getCurrentTime('B'),
      srcA: !!tA?.source,
      srcB: !!tB?.source,
      rateA: tA?.source?.playbackRate.value ?? null,
      rateB: tB?.source?.playbackRate.value ?? null,
      shifterA: !!this.pitchShifters.A,
      shifterB: !!this.pitchShifters.B,
    };
  }

  /** Read RMS level from the left master analyser (0–1). */
  getMasterLevelL(): number {
    if (!this.initialized) return 0;
    return this._readAnalyserRms(this.master.analyserL);
  }

  /** Read RMS level from the right master analyser (0–1). */
  getMasterLevelR(): number {
    if (!this.initialized) return 0;
    return this._readAnalyserRms(this.master.analyserR);
  }

  private _stereoLBuf: Float32Array<ArrayBuffer> | null = null;
  private _stereoRBuf: Float32Array<ArrayBuffer> | null = null;

  private _readAnalyserRms(analyser: AnalyserNode): number {
    const size = analyser.fftSize;
    let buf: Float32Array<ArrayBuffer>;
    if (analyser === this.master.analyserL) {
      if (!this._stereoLBuf || this._stereoLBuf.length !== size) this._stereoLBuf = new Float32Array(size);
      buf = this._stereoLBuf;
    } else {
      if (!this._stereoRBuf || this._stereoRBuf.length !== size) this._stereoRBuf = new Float32Array(size);
      buf = this._stereoRBuf;
    }
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < size; i++) { const s = buf[i]; sum += s * s; }
    return Math.min(1, Math.sqrt(sum / size) * 1.414);
  }

  /**
   * Read the current limiter gain reduction in dB (0 = no reduction,
   * negative = compressing). Used by MasterLedScreen.
   */
  getLimiterReduction(): number {
    if (!this.initialized) return 0;
    return this.master.limiter.reduction;
  }

  /**
   * Enable/disable the brick-wall limiter.
   * When disabled, threshold is set to 0 dBFS (effectively bypass).
   * Uses smoothParam for click-free transition.
   */
  setLimiterEnabled(enabled: boolean): void {
    if (!this.initialized) return;
    smoothParam(this.master.limiter.threshold, enabled ? -0.5 : 0, this.ctx);
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

  /** Set master EQ band in dB. */
  setMasterEq(band: 'low' | 'mid' | 'high', db: number): void {
    if (!this.initialized) return;
    this.master.setMasterEq(band, db, this.ctx);
  }

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
    const fx = fxId as import('./nodes/DeckFx').FxId;
    this.channels[deck].setFx(fx, amount, active, this.ctx);
    // FX state isn't in the store, so the flush can't carry it — write the bus
    // directly so the Wasm DSP path applies FX live too (no-op for WebAudio-only FX).
    this._paramWriter?.setDeckFx(deck, fx, amount, active);
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

  async seek(deck: DeckId, time: number): Promise<void> {
    this.assertReady();
    return this.runDeckExclusive(deck, () => this._seekLocked(deck, time));
  }

  private async _seekLocked(deck: DeckId, time: number): Promise<void> {
    // A2: Cancel vinyl brake if in progress (prevents delayed pause overwriting seek)
    this.cancelBrake(deck);
    // PLL: Reset on seek (discontinuity protection layer 3)
    phaseLockLoop.reset(deck);
    const transport = this.transports[deck];
    if (!transport.streamingBuffer) return;

    const clampedTime = Math.max(0, Math.min(time, transport.totalDuration));

    let buffer: AudioBuffer;
    try {
      buffer = await this.ensureSegment(deck, clampedTime);
    } catch (err) {
      log.error('Engine', 'Failed to seek (load segment):', err);
      return;
    }

    const relativeOffset = clampedTime - transport.currentSegmentStart;

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
    source.buffer = buffer;
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
    source.start(startAt, relativeOffset);
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

  /**
   * Cross-Sync Invisible: glitch-free seek via dual-node crossfade.
   *
   * Instead of stopping the old source and starting a new one (which
   * cuts vocals mid-syllable), this creates a SECOND source node and
   * crossfades over 50ms.  The ear hears a smooth "slide" to the new
   * position, even with tonal material (voices, pads, strings).
   *
   * Falls back to normal seek() if deck is not playing.
   */
  async crossfadeSeek(deck: DeckId, time: number): Promise<void> {
    this.assertReady();
    return this.runDeckExclusive(deck, () => this._crossfadeSeekLocked(deck, time));
  }

  private async _crossfadeSeekLocked(deck: DeckId, time: number): Promise<void> {
    const transport = this.transports[deck];

    // If not playing, just do a normal seek. Call the locked impl directly —
    // we already hold this deck's exclusive lock, so re-entering seek() would
    // deadlock on the chain.
    if (!transport.source || !transport.buffer || !transport.streamingBuffer) {
      await this._seekLocked(deck, time);
      return;
    }

    this.cancelBrake(deck);
    phaseLockLoop.reset(deck);

    const clampedTime = Math.max(0, Math.min(time, transport.totalDuration));

    let nextBuffer: AudioBuffer;
    try {
      nextBuffer = await this.ensureSegment(deck, clampedTime);
    } catch (err) {
      log.error('Engine', 'Failed to crossfadeSeek (load segment):', err);
      return;
    }

    if (!transport.source) {
      transport.offset = clampedTime;
      return;
    }

    const now = this.ctx.currentTime;
    const XFADE = 0.050; // 50ms crossfade

    const oldSource = transport.source;
    const oldGain = transport.gain;

    const newSource = this.ctx.createBufferSource();
    newSource.buffer = nextBuffer;
    newSource.playbackRate.value = transport.playbackRate + this._nudge[deck];

    const loopState = useMixiStore.getState().decks[deck].activeLoop;
    if (loopState) {
      newSource.loop = true;
      newSource.loopStart = loopState.start;
      newSource.loopEnd = loopState.end;
    }

    oldSource.onended = null;

    this.connectSource(deck, newSource);
    const newGain = transport.gain!;

    newGain.gain.setValueAtTime(0, now);
    newGain.gain.linearRampToValueAtTime(1.0, now + XFADE);

    if (oldGain) {
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0, now + XFADE);
    }

    const relativeOffset = clampedTime - transport.currentSegmentStart;
    newSource.start(now, relativeOffset);

    // ── Cleanup old source after crossfade ──────────────────
    setTimeout(() => {
      try {
        oldSource.stop();
        oldSource.disconnect();
        if (oldGain) {
          oldGain.disconnect();
        }
      } catch { /* already stopped */ }
    }, (XFADE + 0.010) * 1000);

    // Update transport to new source
    transport.source = newSource;
    transport.gain = newGain;
    transport.offset = clampedTime;
    transport.startedAt = now;

    newSource.onended = () => {
      if (transport.source === newSource) {
        transport.source = null;
        transport.offset = 0;
        transport.startedAt = 0;
      }
    };
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
    this.updateWorkletLoopState(deck);

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
    this.updateWorkletLoopState(deck);
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
        const wrapDur = transport.totalDuration > 0 ? transport.totalDuration : transport.buffer.duration;
        pos = pos % wrapDur;
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
    if (transport.gain) {
      try {
        transport.gain.disconnect();
      } catch {
        // ignore
      }
      transport.gain = null;
    }
  }

  // ── Pitch Shift / Key Lock ────────────────────────────────

  /**
   * Load the pitch-shift AudioWorklet and create per-deck nodes.
   * Called once from init(); failures are non-fatal (key lock
   * simply won't be available).
   */
  private async loadPitchWorklet(): Promise<void> {
    // Try Rust/Wasm pitch shift first (runs at native speed on audio thread)
    let useWasm = false;
    try {
      const wasmWorkletUrl = new URL('/worklets/pitch-shift-wasm-processor.js', import.meta.url);
      await this.ctx.audioWorklet.addModule(wasmWorkletUrl.href);

      // Compile the Wasm module
      const wasmUrl = new URL('../../mixi-core/pkg/mixi_core_bg.wasm', import.meta.url);
      const wasmResp = await fetch(wasmUrl.href);
      const wasmModule = await WebAssembly.compile(await wasmResp.arrayBuffer());

      for (const deck of ['A', 'B'] as const) {
        const node = new AudioWorkletNode(this.ctx, 'pitch-shift-wasm-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 2,
          outputChannelCount: [2, 1],
        });
        node.port.postMessage({ type: 'wasm-module', module: wasmModule });
        node.port.onmessage = (e) => {
          if (e.data && e.data.type === 'glitch') {
            telemetry.reportEvent({
              type: 'GLITCH',
              deck,
              details: {
                durationMs: e.data.durationMs,
                frames: e.data.frames,
                type: e.data.typeDetail || 'cpu_overload',
              },
            });
          }
        };
        node.connect(this.channels[deck].input, 0, 0);
        this.pitchShifters[deck] = node;
      }
      useWasm = true;
      log.info('Engine', 'Wasm pitch shift processor loaded');
    } catch {
      // Wasm pitch shift not available — fall back to JS
    }

    // Fallback: JavaScript pitch shift processor
    if (!useWasm) {
      try {
        await this.ctx.audioWorklet.addModule(
          new URL('./pitch-shift-processor.js', import.meta.url),
        );
        for (const deck of ['A', 'B'] as const) {
          const node = new AudioWorkletNode(this.ctx, 'pitch-shift-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 2,
            outputChannelCount: [2, 1],
          });
          node.port.onmessage = (e) => {
            if (e.data && e.data.type === 'glitch') {
              telemetry.reportEvent({
                type: 'GLITCH',
                deck,
                details: {
                  durationMs: e.data.durationMs,
                  frames: e.data.frames,
                  type: e.data.typeDetail || 'cpu_overload',
                },
              });
            }
          };
          node.connect(this.channels[deck].input, 0, 0);
          this.pitchShifters[deck] = node;
        }
        log.info('Engine', 'JS pitch shift processor loaded (fallback)');
      } catch (err) {
        log.warn('Engine', `Pitch-shift worklet failed to load: ${err}`);
      }
    }
  }

  /**
   * Connect a source to the deck's audio input, routing through
   * the pitch shifter when available.
   */
  private connectSource(deck: DeckId, source: AudioBufferSourceNode): void {
    const transport = this.transports[deck];

    // Clean up previous gain if any
    if (transport.gain) {
      try {
        transport.gain.disconnect();
      } catch {
        // ignore
      }
    }

    const gain = this.ctx.createGain();
    source.connect(gain);
    transport.gain = gain;

    const shifter = this.pitchShifters[deck];
    if (shifter) {
      gain.connect(shifter);
      shifter.connect(source.playbackRate, 1);
      source.playbackRate.value = 0;
      this.updateWorkletLoopState(deck);
    } else {
      gain.connect(this.channels[deck].input);
    }
  }

  private async ensureSegment(deck: DeckId, time: number): Promise<AudioBuffer> {
    const transport = this.transports[deck];
    if (!transport.streamingBuffer) {
      throw new Error("No streaming buffer initialized");
    }

    const segmentStart = transport.currentSegmentStart;
    const segmentEnd = segmentStart + transport.currentSegmentDuration;

    // If the time is within the loaded segment and at least 2 seconds before the end, use it
    if (time >= segmentStart && time < segmentEnd - 2 && transport.buffer) {
      return transport.buffer;
    }

    const startSec = Math.max(0, Math.floor(time));
    const SEGMENT_DURATION = 300; // 5 minutes
    const durationSec = Math.min(transport.totalDuration - startSec, SEGMENT_DURATION);

    const newBuffer = await transport.streamingBuffer.decodeSegment(startSec, durationSec);

    transport.buffer = newBuffer;
    transport.currentSegmentStart = startSec;
    transport.currentSegmentDuration = durationSec;

    return newBuffer;
  }

  private async checkSegmentTransition(deck: DeckId): Promise<void> {
    const transport = this.transports[deck];
    // Cheap pre-gate OUTSIDE the lock — most ticks bail here, so we never queue
    // a no-op behind an in-flight seek.
    if (!transport.streamingBuffer || !transport.source || !transport.buffer) return;
    if (transport.isTransitioning) return;
    const segmentEnd0 = transport.currentSegmentStart + transport.currentSegmentDuration;
    if (!(this.getCurrentTime(deck) > segmentEnd0 - 8 && segmentEnd0 < transport.totalDuration)) return;

    // Claim the transition slot before awaiting the lock so concurrent ticks
    // don't stack; the actual swap runs serialized against seek/crossfadeSeek.
    transport.isTransitioning = true;
    try {
      await this.runDeckExclusive(deck, () => this._segmentTransitionLocked(deck));
    } finally {
      transport.isTransitioning = false;
    }
  }

  private async _segmentTransitionLocked(deck: DeckId): Promise<void> {
    const transport = this.transports[deck];
    if (!transport.streamingBuffer || !transport.source || !transport.buffer) return;

    const currentTime = this.getCurrentTime(deck);
    const segmentEnd = transport.currentSegmentStart + transport.currentSegmentDuration;

    // Re-validate after acquiring the lock — a seek may have moved the playhead
    // out of the transition window while we waited.
    if (currentTime > segmentEnd - 8 && segmentEnd < transport.totalDuration) {
      try {
        const overlapSec = 1;
        const nextSegmentStart = segmentEnd - overlapSec;
        const nextSegmentDuration = Math.min(transport.totalDuration - nextSegmentStart, 300);

        const nextBuffer = await transport.streamingBuffer.decodeSegment(nextSegmentStart, nextSegmentDuration);

        // Double-check if we are still playing and playhead is in the expected range
        if (!transport.source || Math.abs(this.getCurrentTime(deck) - currentTime) > 5) {
          return;
        }

        const now = this.ctx.currentTime;
        const currentPlayhead = this.getCurrentTime(deck);
        const remainingTime = nextSegmentStart - currentPlayhead;
        const transitionContextTime = now + (remainingTime / transport.playbackRate);
        const startAt = Math.max(now, transitionContextTime);

        const newSource = this.ctx.createBufferSource();
        newSource.buffer = nextBuffer;
        newSource.playbackRate.value = transport.playbackRate + this._nudge[deck];

        const loopState = useMixiStore.getState().decks[deck].activeLoop;
        if (loopState) {
          newSource.loop = true;
          newSource.loopStart = loopState.start;
          newSource.loopEnd = loopState.end;
        }

        const oldSource = transport.source;
        const oldGain = transport.gain;

        oldSource.onended = null;

        this.connectSource(deck, newSource);
        const newGain = transport.gain!;

        newGain.gain.setValueAtTime(0, startAt);
        newGain.gain.linearRampToValueAtTime(1.0, startAt + 0.050);

        if (oldGain) {
          oldGain.gain.setValueAtTime(oldGain.gain.value, startAt);
          oldGain.gain.linearRampToValueAtTime(0, startAt + 0.050);
        }

        newSource.start(startAt, 0);

        setTimeout(() => {
          try {
            oldSource.stop();
            oldSource.disconnect();
            if (oldGain) {
              oldGain.disconnect();
            }
          } catch {
            // ignore
          }
        }, ((startAt - now) + 0.060) * 1000);

        transport.source = newSource;
        transport.gain = newGain;
        transport.buffer = nextBuffer;
        transport.currentSegmentStart = nextSegmentStart;
        transport.currentSegmentDuration = nextSegmentDuration;
        transport.startedAt = startAt;
        transport.offset = nextSegmentStart;

        newSource.onended = () => {
          if (transport.source === newSource) {
            transport.source = null;
            transport.offset = 0;
            transport.startedAt = 0;
          }
        };

        log.info('Engine', `Segment transition complete on deck ${deck}. New segment start: ${nextSegmentStart}`);
      } catch (err) {
        // Swallow here so the fire-and-forget caller never sees an unhandled
        // rejection; the transition slot is released by checkSegmentTransition.
        log.error('Engine', `Segment transition failed on deck ${deck}:`, err);
      }
    }
  }

  /**
   * Helper to send a message to a deck's worklet if loaded.
   */
  postWorkletMessage(deck: DeckId, message: any): void {
    const shifter = this.pitchShifters[deck];
    if (shifter) {
      shifter.port.postMessage(message);
    }
  }

  /**
   * Helper to synchronize loop parameters to the AudioWorklet.
   */
  private updateWorkletLoopState(deck: DeckId): void {
    const shifter = this.pitchShifters[deck];
    if (!shifter) return;
    const source = this.transports[deck].source;
    if (source) {
      shifter.port.postMessage({
        type: 'setLoop',
        enabled: source.loop,
        start: source.loopStart,
        end: source.loopEnd,
      });
    } else {
      shifter.port.postMessage({
        type: 'setLoop',
        enabled: false,
        start: 0,
        end: 0,
      });
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

  // ── Native Audio Output ─────────────────────────────────────

  /**
   * Switch audio output to native cpal (zero-copy via SharedArrayBuffer).
   *
   * Creates an AudioWorklet "tap" that captures the MasterBus output
   * and writes it into a SPSC ring buffer. The native cpal addon reads
   * from this ring buffer on its real-time audio thread.
   *
   * WebAudio destination continues to receive audio (the tap is
   * transparent — it passes samples through unchanged). To mute
   * WebAudio output, set the master volume to 0 separately.
   *
   * @param deviceIndex — device from NativeAudioBridge.getDevices()
   */
  async switchToNativeOutput(deviceIndex = 0): Promise<boolean> {
    this.assertReady();

    if (this._nativeOutputActive) {
      log.warn('Engine', 'Native output already active');
      return true;
    }

    const bridge = NativeAudioBridge.getInstance();
    if (!(await bridge.isAvailable())) {
      log.warn('Engine', 'Native audio not available — staying on WebAudio');
      return false;
    }

    try {
      // 1. Create SharedArrayBuffer ring buffer
      const channels = MixiEngine.NATIVE_RING_CHANNELS;
      const capacity = MixiEngine.NATIVE_RING_FRAMES;
      const headerBytes = 8; // write_head (u32) + read_head (u32)
      const dataBytes = capacity * channels * 4; // float32
      const ringBuffer = new SharedArrayBuffer(headerBytes + dataBytes);

      // Zero the header (write_head = 0, read_head = 0)
      new Uint32Array(ringBuffer, 0, 2).fill(0);

      // 2. Register AudioWorklet processor
      // C4 fix: relative worklet path
      const nativeTapUrl = new URL('/worklets/native-output-tap.js', import.meta.url);
      await this.ctx.audioWorklet.addModule(nativeTapUrl.href);

      // 3. Create AudioWorklet node (inserts as a tap in the audio graph)
      const tapNode = new AudioWorkletNode(this.ctx, 'native-output-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // 4. Send ring buffer to worklet
      tapNode.port.postMessage({
        type: 'init',
        ringBuffer,
        ringCapacityFrames: capacity,
      });

      // Wait for worklet ready signal
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          tapNode.port.onmessage = null;
          reject(new Error('Worklet init timeout'));
        }, 3000);
        tapNode.port.onmessage = (e) => {
          if (e.data.type === 'ready') {
            clearTimeout(timeout);
            tapNode.port.onmessage = null;
            resolve();
          }
        };
      });

      // 5. Insert tap between master output and destination
      //    master.output → tapNode → (continues to destination via HeadphoneBus wiring)
      //    The tap reads samples and writes to the ring buffer, passing audio through.
      this.master.output.connect(tapNode);
      tapNode.connect(this.ctx.destination);

      // 6. Open native cpal stream
      await bridge.openStream(
        deviceIndex,
        this.ctx.sampleRate,
        128, // buffer size (frames per callback)
        ringBuffer,
        capacity,
        channels,
      );

      this._nativeOutputTap = tapNode;
      this._nativeOutputRing = ringBuffer;
      this._nativeOutputActive = true;

      const hostName = await bridge.getHostName();
      log.success('Engine', `Native output ACTIVE → device ${deviceIndex} (${hostName})`);
      return true;
    } catch (err) {
      log.error('Engine', `Native output failed: ${err}`);
      // Cleanup partial state
      if (this._nativeOutputTap) {
        this._nativeOutputTap.disconnect();
        this._nativeOutputTap = null;
      }
      this._nativeOutputRing = null;
      this._nativeOutputActive = false;
      return false;
    }
  }

  /**
   * Switch back to standard WebAudio output.
   * Tears down the native cpal stream and removes the tap worklet.
   */
  async switchToWebOutput(): Promise<void> {
    if (!this._nativeOutputActive) return;

    const bridge = NativeAudioBridge.getInstance();

    // 1. Close the native cpal stream
    try {
      await bridge.closeStream();
    } catch (err) {
      log.warn('Engine', `Error closing native stream: ${err}`);
    }

    // 2. Remove the tap worklet from audio graph
    if (this._nativeOutputTap) {
      this._nativeOutputTap.port.postMessage({ type: 'stop' });
      this._nativeOutputTap.disconnect();
      this._nativeOutputTap = null;
    }

    this._nativeOutputRing = null;
    this._nativeOutputActive = false;

    log.info('Engine', 'Switched to WebAudio output');
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
