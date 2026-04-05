/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – JS303 Engine (Transport + Sequencer + Sync)
//
// 16-step acid sequencer with per-step note, gate, accent, slide.
// Syncs to master BPM. AudioContext look-ahead scheduling.
// ─────────────────────────────────────────────────────────────

import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { JS303Bus } from './JS303Bus';
import { JS303Synth } from './JS303Synth';
import {
  STEP_COUNT, defaultSteps, defaultFx, defaultSynth,
  type SynthParamId, type FxKnobId, type JS303Step,
} from './types';
import type { DeckId } from '../../types';

const LOOK_AHEAD_S = 0.05;
const TICK_MS = 25;

export class JS303Engine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  private bus!: JS303Bus;
  private synth!: JS303Synth;

  private _playing = false;
  private _currentStep = -1;
  private _bpm = 130;
  private _syncToMaster = true;
  private _swing = 0;
  private _masterVolume = 0.8;

  private _steps: JS303Step[] = defaultSteps();
  private _synthParams = defaultSynth();
  private _fxParams = defaultFx();

  private nextStepTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  onStepChange?: (step: number) => void;
  onTrigger?: (step: number) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(): void {
    const engine = MixiEngine.getInstance();
    this.ctx = engine.getAudioContext();
    this.bus = new JS303Bus(this.ctx);
    this.synth = new JS303Synth(this.ctx);
    this.synth.connect(this.bus.input);

    // Connect bus output → DeckChannel input (into mixer chain)
    const channel = engine.getChannel(this.deckId);
    if (channel) {
      this.bus.output.connect(channel.input);
    }

    // Apply initial params
    for (const k of Object.keys(this._synthParams) as SynthParamId[]) {
      this.synth.setParam(k, this._synthParams[k]);
    }
  }

  destroy(): void {
    this.stop();
    this.synth.destroy();
    this.bus.destroy();
  }

  /** The bus output GainNode — connect to DeckChannel.input. */
  get busOutput(): GainNode { return this.bus.output; }

  // ── Transport ─────────────────────────────────────────────

  engage(): void {
    if (this._playing) return;
    this._playing = true;
    this._currentStep = -1;

    // Quantize start to next downbeat if synced
    if (this._syncToMaster) {
      const state = useMixiStore.getState();
      const other = this.deckId === 'A' ? 'B' : 'A';
      const otherDeck = state.decks[other];
      if (otherDeck.isPlaying && otherDeck.bpm > 0) {
        const beatPeriod = 60 / otherDeck.bpm;
        const now = this.ctx.currentTime;
        const elapsed = now - otherDeck.firstBeatOffset;
        this.nextStepTime = otherDeck.firstBeatOffset +
          Math.ceil(elapsed / beatPeriod) * beatPeriod;
      } else {
        this.nextStepTime = this.ctx.currentTime;
      }
    } else {
      this.nextStepTime = this.ctx.currentTime;
    }

    this.synth.setDelayTime(this.getSyncBpm());
    this.timer = setInterval(this.tick, TICK_MS);
  }

  stop(): void {
    this._playing = false;
    this._currentStep = -1;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.onStepChange?.(-1);
  }

  get isPlaying(): boolean { return this._playing; }
  get currentStep(): number { return this._currentStep; }

  // ── BPM ───────────────────────────────────────────────────

  get bpm(): number { return this._syncToMaster ? this.getSyncBpm() : this._bpm; }
  set bpm(v: number) { this._bpm = v; }
  get syncToMaster(): boolean { return this._syncToMaster; }
  set syncToMaster(v: boolean) { this._syncToMaster = v; }
  get swing(): number { return this._swing; }
  set swing(v: number) { this._swing = Math.max(0, Math.min(0.5, v)); }

  get masterVolume(): number { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }

  // ── Pattern ───────────────────────────────────────────────

  get steps(): JS303Step[] { return this._steps; }

  updateStep(idx: number, data: Partial<JS303Step>): void {
    this._steps[idx] = { ...this._steps[idx], ...data };
  }

  clearPattern(): void {
    this._steps = this._steps.map(s => ({ ...s, gate: false }));
  }

  resetPattern(): void {
    this._steps = defaultSteps();
  }

  // ── Synth Params ──────────────────────────────────────────

  get synthParams(): Record<SynthParamId, number> { return { ...this._synthParams }; }

  setSynthParam(id: SynthParamId, value: number): void {
    this._synthParams[id] = value;
    this.synth.setParam(id, value);
  }

  get fxParams(): Record<FxKnobId, number> { return { ...this._fxParams }; }

  setFx(id: FxKnobId, value: number): void {
    this._fxParams[id] = value;
    switch (id) {
      case 'distShape':
      case 'distThreshold':
        this.synth.setDistortion(this._fxParams.distShape, this._fxParams.distThreshold);
        break;
      case 'delayFeedback':
      case 'delaySend':
        this.synth.setDelay(this._fxParams.delayFeedback, this._fxParams.delaySend);
        break;
    }
  }

  // ── Scheduling ────────────────────────────────────────────

  private tick = (): void => {
    if (!this._playing) return;
    const bpm = this.getSyncBpm();
    const stepDur = 60 / bpm / 4; // 16th note

    this.synth.setDelayTime(bpm);

    while (this.nextStepTime < this.ctx.currentTime + LOOK_AHEAD_S) {
      this._currentStep = (this._currentStep + 1) % STEP_COUNT;
      const step = this._steps[this._currentStep];
      const nextStep = this._steps[(this._currentStep + 1) % STEP_COUNT];

      if (step.gate) {
        // Convert MIDI note to frequency
        const semitones = step.note + (step.up ? 12 : 0) + (step.down ? -12 : 0);
        const tuningOffset = (this._synthParams.tuning - 0.5) * 24; // ±12 semitones
        const freq = 440 * Math.pow(2, (semitones - 69 + tuningOffset) / 12);

        this.synth.noteOn(freq, this.nextStepTime, step.accent, step.slide);

        // Note off at end of step (unless next step slides)
        const offTime = this.nextStepTime + stepDur * 0.8;
        if (!nextStep.slide || !nextStep.gate) {
          this.synth.noteOff(offTime, false);
        }

        this.onTrigger?.(this._currentStep);
      } else {
        // Gate off — silence
        this.synth.noteOff(this.nextStepTime, false);
      }

      // Notify UI
      const stepToNotify = this._currentStep;
      const delay = Math.max(0, (this.nextStepTime - this.ctx.currentTime) * 1000);
      setTimeout(() => this.onStepChange?.(stepToNotify), delay);

      // Swing: offset odd steps
      let swingOffset = 0;
      if (this._currentStep % 2 === 1) {
        swingOffset = this._swing * stepDur * 0.5;
      }
      this.nextStepTime += stepDur + swingOffset;
    }
  };

  private getSyncBpm(): number {
    if (!this._syncToMaster) return this._bpm;
    const state = useMixiStore.getState();
    const other = this.deckId === 'A' ? 'B' : 'A';
    return state.decks[other].bpm || this._bpm;
  }
}
