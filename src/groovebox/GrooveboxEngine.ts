/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Groovebox Audio Engine
//
// Self-contained step sequencer that connects to an existing
// DeckChannel via a GrooveboxBus.  Each voice has its own
// volume → pan → mute/solo chain before hitting the bus output.
// The bus output connects to DeckChannel.input so audio flows
// through EQ → ColorFX → Fader → Crossfader → Master.
//
// Scheduling uses the AudioContext-based look-ahead pattern
// (same as MasterClock) for sub-ms jitter-free timing.
// ─────────────────────────────────────────────────────────────

import { MixiEngine } from '../audio/MixiEngine';
import { useMixiStore } from '../store/mixiStore';
import { DrumSynth } from './drumSynth';
import { GrooveboxBus } from './GrooveboxBus';
import {
  STEP_COUNT, VOICES,
  defaultPattern, fourOnFloorPattern, defaultVoiceMixer,
  type Pattern, type VoiceId, type VoiceMixer,
} from './types';
import type { DeckId } from '../types';

/** How far ahead (seconds) we schedule drum hits. */
const LOOK_AHEAD_S = 0.05;
/** How often (ms) the scheduler wakes up. */
const TICK_MS = 25;

import { SampleManager } from '../audio/SampleManager';

export class GrooveboxEngine {
  private ctx!: AudioContext;
  private synth!: DrumSynth;
  private _bus!: GrooveboxBus;

  /** Which deck slot this groovebox occupies. */
  readonly deckId: DeckId;

  // ── Sequencer state ────────────────────────────────────────
  private _playing = false;
  private _bpm = 128;
  private _syncToMaster = true;
  private _swing = 0;
  private _masterVolume = 0.8;
  private _pattern: Pattern = fourOnFloorPattern();
  private _currentStep = -1;

  /** Next scheduled step time in AudioContext seconds. */
  private nextStepTime = 0;
  /** Scheduler interval handle. */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Callback for UI to receive step updates. */
  onStepChange?: (step: number) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  init(): void {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    this.ctx = engine.getAudioContext();
    this.synth = new DrumSynth(this.ctx);

    // Per-voice bus: gain → pan → mute/solo → busOutput
    this._bus = new GrooveboxBus(this.ctx);
    this._bus.output.gain.value = this._masterVolume;

    // Sync initial pattern volumes into bus
    for (const v of VOICES) {
      this._bus.setVoiceVolume(v, this._pattern[v].volume);
    }

    // Connect bus output to DeckChannel input (trimGain) so it
    // routes through EQ → Fader → Crossfader → Master.
    const channel = engine.getChannel(this.deckId);
    if (channel) {
      this._bus.output.connect(channel.input);
    }
  }

  destroy(): void {
    this.stop();
    this._bus?.destroy();
  }

  // ── Transport ──────────────────────────────────────────────

  play(): void {
    if (this._playing || !this.ctx) return;
    this._playing = true;
    this._currentStep = -1;
    this.nextStepTime = this.ctx.currentTime;
    this.startScheduler();
  }

  stop(): void {
    this._playing = false;
    this._currentStep = -1;
    this.stopScheduler();
    this.onStepChange?.(-1);
  }

  get isPlaying(): boolean { return this._playing; }

  // ── BPM ────────────────────────────────────────────────────

  get bpm(): number {
    if (this._syncToMaster) return this.getMasterBpm() || this._bpm;
    return this._bpm;
  }

  set bpm(v: number) { this._bpm = Math.max(60, Math.min(200, v)); }

  get syncToMaster(): boolean { return this._syncToMaster; }
  set syncToMaster(v: boolean) { this._syncToMaster = v; }

  // ── Pattern ────────────────────────────────────────────────

  get pattern(): Pattern { return this._pattern; }

  setStep(voice: VoiceId, step: number, on: boolean): void {
    this._pattern[voice].steps[step] = on;
  }

  toggleStep(voice: VoiceId, step: number): void {
    this._pattern[voice].steps[step] = !this._pattern[voice].steps[step];
  }

  setVoiceVolume(voice: VoiceId, vol: number): void {
    this._pattern[voice].volume = vol;
    this._bus?.setVoiceVolume(voice, vol);
  }

  clearPattern(): void {
    this._pattern = defaultPattern();
    this.syncVoiceGains();
  }

  resetPattern(): void {
    this._pattern = fourOnFloorPattern();
    this.syncVoiceGains();
  }

  /** Trigger a one-shot hit on a voice immediately (for MPC pads). */
  hitVoiceNow(voice: VoiceId, velocity = 1.0): void {
    if (!this.ctx || !this._bus) return;
    
    // Attempt zero-latency lookup from SampleManager RAM cache first.
    // If not found, use built-in synthesize buffers.
    const buf = SampleManager.getInstance().getBuffer(voice) || this.synth.buffers[voice];
    if (!buf) return;
    
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const velGain = this.ctx.createGain();
    velGain.gain.value = Math.max(0, Math.min(1, velocity));
    src.connect(velGain);
    velGain.connect(this._bus.getVoiceInput(voice));
    src.start(this.ctx.currentTime);
    // M2: Cleanup nodes after playback to prevent GC pile-up
    src.onended = () => { src.disconnect(); velGain.disconnect(); };
  }

  /** Push pattern volume values into the bus gain nodes. */
  private syncVoiceGains(): void {
    if (!this._bus) return;
    for (const v of VOICES) {
      this._bus.setVoiceVolume(v, this._pattern[v].volume);
    }
  }

  // ── Voice mixer (pan / mute / solo) ────────────────────────

  setVoicePan(voice: VoiceId, pan: number): void {
    this._bus?.setVoicePan(voice, pan);
  }

  toggleVoiceMute(voice: VoiceId): void {
    if (!this._bus) return;
    this._bus.setVoiceMute(voice, !this._bus.isVoiceMuted(voice));
  }

  toggleVoiceSolo(voice: VoiceId): void {
    if (!this._bus) return;
    this._bus.setVoiceSolo(voice, !this._bus.isVoiceSoloed(voice));
  }

  /** Snapshot of per-voice pan / mute / solo state. */
  get mixer(): VoiceMixer {
    if (!this._bus) return defaultVoiceMixer();
    const m = {} as VoiceMixer;
    for (const v of VOICES) {
      m[v] = {
        pan: this._bus.getVoicePan(v),
        mute: this._bus.isVoiceMuted(v),
        solo: this._bus.isVoiceSoloed(v),
      };
    }
    return m;
  }

  // ── Master volume ──────────────────────────────────────────

  get masterVolume(): number { return this._masterVolume; }

  set masterVolume(v: number) {
    this._masterVolume = v;
    if (this._bus) this._bus.output.gain.value = v;
  }

  // ── Swing ──────────────────────────────────────────────────

  get swing(): number { return this._swing; }
  set swing(v: number) { this._swing = Math.max(0, Math.min(0.5, v)); }

  // ── Current step (for UI) ─────────────────────────────────

  get currentStep(): number { return this._currentStep; }

  // ── Internal: Scheduler ────────────────────────────────────

  private startScheduler(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scheduleTick(), TICK_MS);
  }

  private stopScheduler(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private scheduleTick(): void {
    if (!this._playing) return;

    const bpm = this.bpm;
    if (bpm <= 0) return;

    // Duration of one 16th-note step
    const stepDur = 60 / bpm / 4;
    const deadline = this.ctx.currentTime + LOOK_AHEAD_S;

    while (this.nextStepTime < deadline) {
      this._currentStep = (this._currentStep + 1) % STEP_COUNT;

      // Apply swing to even steps (0-indexed: steps 1,3,5… are the offbeats)
      let swingOffset = 0;
      if (this._currentStep % 2 === 1 && this._swing > 0) {
        swingOffset = stepDur * this._swing;
      }

      const scheduleTime = this.nextStepTime + swingOffset;

      // Trigger voices
      for (const v of VOICES) {
        if (this._pattern[v].steps[this._currentStep]) {
          this.triggerVoice(v, scheduleTime);
        }
      }

      // Notify UI — synchronous call; the look-ahead is only 50ms
      // so visual/audio drift is imperceptible.
      this.onStepChange?.(this._currentStep);

      this.nextStepTime += stepDur;
    }
  }

  private triggerVoice(voice: VoiceId, time: number): void {
    const buf = SampleManager.getInstance().getBuffer(voice) || this.synth.buffers[voice];
    if (!buf || !this._bus) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._bus.getVoiceInput(voice));
    src.start(time);
    src.onended = () => { src.disconnect(); };
  }

  // ── Helpers ────────────────────────────────────────────────

  private getMasterBpm(): number {
    const state = useMixiStore.getState();
    const deckA = state.decks.A;
    const deckB = state.decks.B;
    // Prefer the OTHER deck's BPM (the one that has a track loaded)
    const other = this.deckId === 'A' ? deckB : deckA;
    const self = this.deckId === 'A' ? deckA : deckB;
    if (other.bpm > 0) return other.bpm;
    if (self.bpm > 0) return self.bpm;
    return 0;
  }
}
