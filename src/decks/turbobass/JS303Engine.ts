/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – JS303 Engine (v2)
//
// 16-step acid sequencer with per-step note, gate, accent, slide.
// Syncs to master BPM. AudioContext look-ahead scheduling.
//
// Iter 3: Randomize, Mutate, Shift, Polyrhythmic Length,
//         Transpose, ACID Macro, Crossfader Link
// Iter 5: Pattern Banks (4×8), Ghost Sequence, Panic Reset
// ─────────────────────────────────────────────────────────────

import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { JS303Bus } from './JS303Bus';
import { JS303Synth } from './JS303Synth';
import {
  STEP_COUNT, MAX_STEPS, BANK_COUNT, PATTERNS_PER_BANK, SCALES, SCALE_NAMES,
  defaultSteps, defaultFx, defaultSynth,
  type SynthParamId, type FxKnobId, type JS303Step,
} from './types';
import { FACTORY_BANKS } from './JS303Patterns';
import type { DeckId } from '../../types';

const LOOK_AHEAD_S = 0.05;
const TICK_MS = 25;
const GHOST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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

  // Iter 3: Performance features
  private _patternLength = 16;
  private _transpose = 0;
  private _acidMacro = 0;

  // Iter 5: Pattern bank
  private _currentBank = 0;
  private _currentPattern = 0;
  private _patternSlots: JS303Step[][][] = []; // [bank][pattern][steps]
  private _crossfaderLink = false;

  // Iter 5: Ghost sequence
  private _ghostTimer: ReturnType<typeof setTimeout> | null = null;
  private _ghostSequenceReady = false;
  private _ghostPattern: JS303Step[] | null = null;
  private _lastInteraction = Date.now();

  private nextStepTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  onStepChange?: (step: number) => void;
  onTrigger?: (step: number) => void;
  onGhostReady?: (ready: boolean) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
    this.initPatternBank();
  }

  init(): void {
    const engine = MixiEngine.getInstance();
    this.ctx = engine.getAudioContext();
    this.bus = new JS303Bus(this.ctx);
    this.synth = new JS303Synth(this.ctx);
    this.synth.connect(this.bus.input);

    const channel = engine.getChannel(this.deckId);
    if (channel) {
      this.bus.output.connect(channel.input);
    }

    for (const k of Object.keys(this._synthParams) as SynthParamId[]) {
      this.synth.setParam(k, this._synthParams[k]);
    }

    this.startGhostTimer();
  }

  destroy(): void {
    this.stop();
    this.stopGhostTimer();
    this.synth.destroy();
    this.bus.destroy();
  }

  get busOutput(): GainNode { return this.bus.output; }

  // ── Transport ─────────────────────────────────────────────

  engage(): void {
    if (this._playing) return;
    this._playing = true;
    this._currentStep = -1;
    this.touchInteraction();

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
  set masterVolume(v: number) { this._masterVolume = v; this.bus.setVolume(v); }

  // ── Pattern ───────────────────────────────────────────────

  get steps(): JS303Step[] { return this._steps; }

  updateStep(idx: number, data: Partial<JS303Step>): void {
    this._steps[idx] = { ...this._steps[idx], ...data };
    this.touchInteraction();
  }

  clearPattern(): void {
    this._steps = this._steps.map(s => ({ ...s, gate: false }));
    this.touchInteraction();
  }

  resetPattern(): void {
    this._steps = defaultSteps();
    this.touchInteraction();
  }

  // ── Pattern Length (Polyrhythmic) ─────────────────────────

  get patternLength(): number { return this._patternLength; }
  set patternLength(v: number) {
    this._patternLength = Math.max(1, Math.min(MAX_STEPS, v));
    this.touchInteraction();
  }

  // ── Transpose ─────────────────────────────────────────────

  get transpose(): number { return this._transpose; }
  set transpose(v: number) {
    this._transpose = Math.max(-24, Math.min(24, v));
    this.touchInteraction();
  }

  // ── ACID Macro ────────────────────────────────────────────
  // Single knob controls: cutoff↑, envMod↑, resonance↑, decay↓

  get acidMacro(): number { return this._acidMacro; }
  set acidMacro(v: number) {
    this._acidMacro = Math.max(0, Math.min(1, v));
    this.applyAcidMacro(this._acidMacro);
    this.touchInteraction();
  }

  private applyAcidMacro(v: number): void {
    // Cutoff: 0.3 → 0.9 as macro goes 0 → 1
    this.setSynthParam('cutoff', 0.3 + v * 0.6);
    // EnvMod: 0.2 → 0.9
    this.setSynthParam('envMod', 0.2 + v * 0.7);
    // Resonance: 0.3 → 0.85
    this.setSynthParam('resonance', 0.3 + v * 0.55);
    // Decay: 0.6 → 0.15 (shorter = snappier)
    this.setSynthParam('decay', 0.6 - v * 0.45);
  }

  // ── Crossfader Link ───────────────────────────────────────

  get crossfaderLink(): boolean { return this._crossfaderLink; }
  set crossfaderLink(v: boolean) { this._crossfaderLink = v; }

  /** Called by external hook when crossfader moves */
  applyCrossfaderCutoff(crossfaderPosition: number): void {
    if (!this._crossfaderLink) return;
    // When crossfader moves away from this deck, close the filter
    const deckSide = this.deckId === 'A' ? 0 : 1;
    const distance = Math.abs(crossfaderPosition - deckSide);
    // 0 = full open (deck side), 1 = full opposite (filter closed)
    const cutoff = 1 - distance * 0.8;
    this.synth.setParam('cutoff', Math.max(0.05, cutoff));
  }

  // ── Synth Params ──────────────────────────────────────────

  get synthParams(): Record<SynthParamId, number> { return { ...this._synthParams }; }

  setSynthParam(id: SynthParamId, value: number): void {
    this._synthParams[id] = value;
    this.synth.setParam(id, value);
    this.touchInteraction();
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
      case 'reverbSend':
      case 'reverbDecay':
        this.bus.setReverb(this._fxParams.reverbSend, this._fxParams.reverbDecay);
        break;
      case 'chorusMix':
      case 'chorusRate':
        this.bus.setChorus(this._fxParams.chorusMix, this._fxParams.chorusRate);
        break;
      case 'autoPan':
        this.bus.setAutoPan(this._fxParams.autoPan);
        break;
      case 'filterLfoDepth':
      case 'filterLfoRate':
        this.synth.setFilterLfo(this._fxParams.filterLfoDepth, this._fxParams.filterLfoRate);
        break;
    }
    this.touchInteraction();
  }

  // ── Pattern Bank (Iter 5) ─────────────────────────────────

  get currentBank(): number { return this._currentBank; }
  get currentPattern(): number { return this._currentPattern; }

  private initPatternBank(): void {
    this._patternSlots = FACTORY_BANKS.map(bank =>
      bank.map(p => p.steps.map(s => ({ ...s }))),
    );
  }

  loadPattern(bank: number, pattern: number): void {
    if (bank < 0 || bank >= BANK_COUNT || pattern < 0 || pattern >= PATTERNS_PER_BANK) return;
    // Save current pattern to its slot first
    this._patternSlots[this._currentBank][this._currentPattern] =
      this._steps.map(s => ({ ...s }));
    // Load new
    this._currentBank = bank;
    this._currentPattern = pattern;
    this._steps = this._patternSlots[bank][pattern].map(s => ({ ...s }));
    this.touchInteraction();
  }

  getPatternName(): string {
    return FACTORY_BANKS[this._currentBank]?.[this._currentPattern]?.name ?? 'Custom';
  }

  // ── Randomize (Iter 3) ────────────────────────────────────
  // Musical randomizer: scale-aware, accent/slide probability

  randomize(scaleName = 'minorPent', rootNote = 36, density = 0.7): void {
    const scale = SCALES[scaleName] ?? SCALES.minorPent;
    const steps: JS303Step[] = [];

    for (let i = 0; i < MAX_STEPS; i++) {
      const gate = Math.random() < density;
      if (!gate) {
        steps.push({ note: rootNote, gate: false, accent: false, slide: false, down: false, up: false });
        continue;
      }
      // Pick note from scale within 2 octaves
      const octave = Math.floor(Math.random() * 2);
      const degree = scale[Math.floor(Math.random() * scale.length)];
      const note = rootNote + degree + octave * 12;

      // Accent: 25% probability, prefer off-beats (odd steps)
      const accentProb = i % 2 === 1 ? 0.35 : 0.15;
      const accent = Math.random() < accentProb;

      // Slide: 15% probability on consecutive gated steps
      const prevGated = i > 0 && steps[i - 1].gate;
      const slide = prevGated && Math.random() < 0.15;

      // Octave shifts: occasional
      const up = !slide && Math.random() < 0.1;
      const down = !up && !slide && Math.random() < 0.08;

      steps.push({ note, gate, accent, slide, down, up });
    }

    this._steps = steps;
    this.touchInteraction();
  }

  // ── Mutate (Iter 3) ──────────────────────────────────────
  // Progressively alter pattern: amount 0→no change, 1→total chaos

  mutate(amount: number): void {
    const mutations = Math.ceil(amount * STEP_COUNT * 0.4);
    const steps = this._steps.map(s => ({ ...s }));

    for (let m = 0; m < mutations; m++) {
      const idx = Math.floor(Math.random() * this._patternLength);
      const r = Math.random();
      if (r < 0.35) {
        // Shift note by ±1-5 semitones
        steps[idx].note += Math.floor(Math.random() * 10) - 5;
        steps[idx].note = Math.max(24, Math.min(72, steps[idx].note));
      } else if (r < 0.55) {
        // Toggle gate
        steps[idx].gate = !steps[idx].gate;
      } else if (r < 0.7) {
        // Toggle accent
        steps[idx].accent = !steps[idx].accent;
      } else if (r < 0.85) {
        // Toggle slide
        steps[idx].slide = !steps[idx].slide;
      } else {
        // Toggle octave
        if (Math.random() < 0.5) {
          steps[idx].up = !steps[idx].up;
          steps[idx].down = false;
        } else {
          steps[idx].down = !steps[idx].down;
          steps[idx].up = false;
        }
      }
    }

    this._steps = steps;
    this.touchInteraction();
  }

  // ── Shift Pattern (Iter 3) ────────────────────────────────

  shiftLeft(): void {
    const len = this._patternLength;
    const first = this._steps[0];
    for (let i = 0; i < len - 1; i++) this._steps[i] = this._steps[i + 1];
    this._steps[len - 1] = first;
    this.touchInteraction();
  }

  shiftRight(): void {
    const len = this._patternLength;
    const last = this._steps[len - 1];
    for (let i = len - 1; i > 0; i--) this._steps[i] = this._steps[i - 1];
    this._steps[0] = last;
    this.touchInteraction();
  }

  // ── Panic Reset (Iter 5) ──────────────────────────────────

  panic(): void {
    // Reset all synth + FX to safe defaults
    const synth = defaultSynth();
    for (const k of Object.keys(synth) as SynthParamId[]) {
      this.setSynthParam(k, synth[k]);
    }
    const fx = defaultFx();
    for (const k of Object.keys(fx) as FxKnobId[]) {
      this.setFx(k, fx[k]);
    }
    this._acidMacro = 0;
  }

  // ── Ghost Sequence (Iter 5) ───────────────────────────────

  get ghostSequenceReady(): boolean { return this._ghostSequenceReady; }

  /** Accept ghost pattern: replaces current steps */
  acceptGhostSequence(): void {
    if (this._ghostPattern) {
      this._steps = this._ghostPattern.map(s => ({ ...s }));
      this._ghostPattern = null;
      this._ghostSequenceReady = false;
      this.onGhostReady?.(false);
    }
  }

  private touchInteraction(): void {
    this._lastInteraction = Date.now();
    if (this._ghostSequenceReady) {
      this._ghostSequenceReady = false;
      this._ghostPattern = null;
      this.onGhostReady?.(false);
    }
    this.resetGhostTimer();
  }

  private startGhostTimer(): void {
    this._ghostTimer = setInterval(() => {
      if (Date.now() - this._lastInteraction >= GHOST_TIMEOUT_MS && !this._ghostSequenceReady) {
        this.generateGhostSequence();
      }
    }, 30_000);
  }

  private stopGhostTimer(): void {
    if (this._ghostTimer) { clearInterval(this._ghostTimer); this._ghostTimer = null; }
  }

  private resetGhostTimer(): void {
    this._lastInteraction = Date.now();
  }

  private generateGhostSequence(): void {
    // Use scale from current pattern's note distribution
    const rootNote = this.detectRoot();
    const scale = SCALES[SCALE_NAMES[Math.floor(Math.random() * 3)]]; // minor, phrygian, or minorPent
    const steps: JS303Step[] = [];

    for (let i = 0; i < MAX_STEPS; i++) {
      const gate = i < this._patternLength && Math.random() < 0.65;
      const degree = scale[Math.floor(Math.random() * scale.length)];
      const octave = Math.floor(Math.random() * 2);
      steps.push({
        note: rootNote + degree + octave * 12,
        gate,
        accent: gate && Math.random() < 0.25,
        slide: gate && i > 0 && steps[i - 1]?.gate && Math.random() < 0.2,
        down: false,
        up: gate && Math.random() < 0.08,
      });
    }

    this._ghostPattern = steps;
    this._ghostSequenceReady = true;
    this.onGhostReady?.(true);
  }

  private detectRoot(): number {
    // Find most common note class in current pattern
    const counts = new Array(12).fill(0);
    for (const s of this._steps) {
      if (s.gate) counts[s.note % 12]++;
    }
    const maxIdx = counts.indexOf(Math.max(...counts));
    return 36 + maxIdx; // C2 + offset
  }

  // ── Scheduling ────────────────────────────────────────────

  private tick = (): void => {
    if (!this._playing) return;
    const bpm = this.getSyncBpm();
    const stepDur = 60 / bpm / 4;

    this.synth.setDelayTime(bpm);
    this.synth.setBpm(bpm);

    while (this.nextStepTime < this.ctx.currentTime + LOOK_AHEAD_S) {
      // Polyrhythmic: wrap at patternLength instead of STEP_COUNT
      this._currentStep = (this._currentStep + 1) % this._patternLength;
      const step = this._steps[this._currentStep];
      const nextIdx = (this._currentStep + 1) % this._patternLength;
      const nextStep = this._steps[nextIdx];

      if (step.gate) {
        // Apply transpose + octave shifts
        const semitones = step.note + this._transpose
          + (step.up ? 12 : 0) + (step.down ? -12 : 0);
        const tuningOffset = (this._synthParams.tuning - 0.5) * 24;
        const freq = 440 * Math.pow(2, (semitones - 69 + tuningOffset) / 12);

        this.synth.noteOn(freq, this.nextStepTime, step.accent, step.slide);
        this.bus.duckReverb(true);

        // Note off
        const offTime = this.nextStepTime + stepDur * 0.8;
        if (!nextStep.slide || !nextStep.gate) {
          this.synth.noteOff(offTime, false);
          // Schedule reverb un-duck
          setTimeout(() => this.bus.duckReverb(false),
            Math.max(0, (offTime - this.ctx.currentTime) * 1000));
        }

        this.onTrigger?.(this._currentStep);
      } else {
        this.synth.noteOff(this.nextStepTime, false);
        this.bus.duckReverb(false);
      }

      const stepToNotify = this._currentStep;
      const delay = Math.max(0, (this.nextStepTime - this.ctx.currentTime) * 1000);
      setTimeout(() => this.onStepChange?.(stepToNotify), delay);

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
