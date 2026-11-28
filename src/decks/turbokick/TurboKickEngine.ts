/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – TurboKick Audio Engine  (v2 — single synth kick)
//
// Real-time kick synthesizer + 16-step sequencer.
// Kick sound is generated on-the-fly with tweakable params
// (pitch, decay, click, drive).  Audio chain:
//
//   KickSynth → TurboKickBus (valves + FX + LFO) → DeckChannel
//
// Scheduling uses AudioContext look-ahead for jitter-free timing.
// ─────────────────────────────────────────────────────────────

import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { KickSynth } from './kickSynth';
import { TurboKickBus } from './TurboKickBus';
import {
  STEP_COUNT,
  defaultSteps, defaultFx, defaultValves, defaultSynth,
  type SynthParamId, type FxKnobId, type ValveId,
} from './types';
import type { DeckId } from '../../types';

const LOOK_AHEAD_S = 0.05;
const TICK_MS = 25;

export class TurboKickEngine {
  private ctx!: AudioContext;
  private synth!: KickSynth;
  private _bus!: TurboKickBus;

  readonly deckId: DeckId;

  // ── Sequencer state ────────────────────────────────────────
  private _playing = false;
  private _engaged = false;   // waiting for downbeat to start
  private _bpm = 170;
  private _syncToMaster = true;
  private _swing = 0;
  private _masterVolume = 0.8;
  private _steps: boolean[] = defaultSteps();
  private _currentStep = -1;

  // ── Synth / FX / valve state ──────────────────────────────
  private _synth = defaultSynth();
  private _fx = defaultFx();
  private _valves = defaultValves();

  private nextStepTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  onStepChange?: (step: number) => void;
  /** Called on every kick trigger. step=0 means downbeat (first beat of bar). */
  onKickTrigger?: (step: number) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  init(): void {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    this.ctx = engine.getAudioContext();
    this.synth = new KickSynth(this.ctx);
    this._bus = new TurboKickBus(this.ctx);
    this._bus.output.gain.value = this._masterVolume;

    const channel = engine.getChannel(this.deckId);
    if (channel) {
      this._bus.output.connect(channel.input);
    }
  }

  destroy(): void {
    this.stop();
    this._bus?.destroy();
  }

  // ── Transport (ENGAGE / DISENGAGE) ─────────────────────────

  /** ENGAGE: start immediately or quantize to next downbeat if synced to a playing track. */
  engage(): void {
    if (this._playing || !this.ctx) return;

    const masterBpm = this.getMasterBpm();
    const hasRealMaster = this._syncToMaster && masterBpm > 0;

    if (hasRealMaster) {
      // AUD-08: Quantized start — snap to next bar boundary of the master deck's beatgrid
      this._engaged = true;
      this._playing = true;
      this._currentStep = -1;
      const state = useMixiStore.getState();
      const otherId: DeckId = this.deckId === 'A' ? 'B' : 'A';
      const masterDeck = state.decks[otherId].isPlaying ? state.decks[otherId] : state.decks[this.deckId];
      const masterDeckId: DeckId = state.decks[otherId].isPlaying ? otherId : this.deckId;
      const now = this.ctx.currentTime;
      const engine = MixiEngine.getInstance();
      const nativeBpm = masterDeck.originalBpm > 0 ? masterDeck.originalBpm : masterBpm;
      const trackTime = engine.isInitialized ? engine.getCurrentTime(masterDeckId) : 0;
      const nativeBeat = (trackTime - masterDeck.firstBeatOffset) * (nativeBpm / 60);
      const beatInBar = ((nativeBeat % 4) + 4) % 4;
      const beatsUntilBar = beatInBar < 0.02 ? 0 : 4 - beatInBar;
      const wallBeatDur = 60 / masterBpm;
      this.nextStepTime = now + beatsUntilBar * wallBeatDur;
      this.startScheduler();
    } else {
      // No master or free mode — start immediately
      this._playing = true;
      this._engaged = false;
      this._currentStep = -1;
      this.nextStepTime = this.ctx.currentTime;
      this.startScheduler();
    }
  }

  /** Alias for backward compat. */
  play(): void { this.engage(); }

  stop(): void {
    this._playing = false;
    this._engaged = false;
    this._currentStep = -1;
    this.stopScheduler();
    this.onStepChange?.(-1);
  }

  get isPlaying(): boolean { return this._playing; }
  get isEngaged(): boolean { return this._engaged; }

  // ── BPM ────────────────────────────────────────────────────

  get bpm(): number {
    if (this._syncToMaster) return this.getMasterBpm() || this._bpm;
    return this._bpm;
  }
  set bpm(v: number) { this._bpm = Math.max(60, Math.min(200, v)); }

  get syncToMaster(): boolean { return this._syncToMaster; }
  set syncToMaster(v: boolean) { this._syncToMaster = v; }

  // ── Pattern ────────────────────────────────────────────────

  get steps(): boolean[] { return this._steps; }

  toggleStep(step: number): void {
    this._steps[step] = !this._steps[step];
  }

  clearPattern(): void {
    this._steps = Array.from({ length: STEP_COUNT }, () => false);
  }

  resetPattern(): void {
    this._steps = defaultSteps();
  }

  // ── Pad trigger ────────────────────────────────────────────

  hitPad(velocity = 1.0): void {
    if (!this.ctx || !this._bus) return;
    this.synth.trigger(this._bus.input, this.ctx.currentTime, velocity);
    this._bus.duckRumble();
  }

  // ── Synth params ──────────────────────────────────────────

  get synthParams(): Record<SynthParamId, number> { return this.synth.params; }

  setSynthParam(id: SynthParamId, value: number): void {
    this.synth.setParam(id, value);
    this._synth[id] = value;
  }

  // ── FX ─────────────────────────────────────────────────────

  get fx(): Record<FxKnobId, number> { return { ...this._fx }; }

  setFx(id: FxKnobId, value: number): void {
    this._fx[id] = value;
    if (!this._bus) return;
    switch (id) {
      case 'filter':    this._bus.filter = value; break;
      case 'resonance': this._bus.resonance = value; break;
      case 'delay':     this._bus.delay = value; break;
      case 'lfoRate':   this._bus.lfoRate = value; break;
      case 'lfoDepth':  this._bus.lfoDepth = value; break;
      case 'thump':     this.synth.setThump(value); break;
      case 'rumble':    this._bus.rumble = value; break;
      case 'tune':      this.synth.setParam('pitch', value); break;
    }
  }

  // ── Valves ─────────────────────────────────────────────────

  get valves(): Record<ValveId, number> { return { ...this._valves }; }

  setValve(id: ValveId, value: number): void {
    this._valves[id] = value;
    if (!this._bus) return;
    if (id === 'tubeA') this._bus.valveA = value;
    if (id === 'punchB') this._bus.valveB = value;
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

  get currentStep(): number { return this._currentStep; }

  // ── Scheduler ──────────────────────────────────────────────

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

    const stepDur = 60 / bpm / 4;
    const now = this.ctx.currentTime;
    // AUD-09: Prevent kick burst storm after tab backgrounding or timer stall
    if (this.nextStepTime < now - stepDur * 2) {
      this.nextStepTime = now;
    }
    const deadline = now + LOOK_AHEAD_S;

    while (this.nextStepTime < deadline) {
      this._currentStep = (this._currentStep + 1) % STEP_COUNT;

      let swingOffset = 0;
      if (this._currentStep % 2 === 1 && this._swing > 0) {
        swingOffset = stepDur * this._swing;
      }

      const scheduleTime = this.nextStepTime + swingOffset;

      if (this._steps[this._currentStep]) {
        this.synth.trigger(this._bus.input, scheduleTime);
        this._bus.duckRumble();
        this.onKickTrigger?.(this._currentStep);
        // Clear engaged state after first kick fires
        if (this._engaged) this._engaged = false;
      }

      // Sync rumble delay to BPM
      this._bus.setRumbleBpm(bpm);

      this.onStepChange?.(this._currentStep);
      this.nextStepTime += stepDur;
    }
  }

  private getMasterBpm(): number {
    const state = useMixiStore.getState();
    const other = this.deckId === 'A' ? state.decks.B : state.decks.A;
    const self = this.deckId === 'A' ? state.decks.A : state.decks.B;
    if (other.bpm > 0) return other.bpm;
    if (self.bpm > 0) return self.bpm;
    return 0;
  }
}
