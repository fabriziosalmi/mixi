/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

export const STEP_COUNT = 16;
export const MAX_STEPS = 32;
export const BANK_COUNT = 4;
export const PATTERNS_PER_BANK = 8;

// ── Synth Params ────────────────────────────────────────────
// Iter 1: added drive, subLevel, drift
export type SynthParamId =
  | 'cutoff' | 'resonance' | 'envMod' | 'decay'
  | 'accent' | 'tuning' | 'waveform'
  | 'drive' | 'subLevel' | 'drift';

// ── FX Params ───────────────────────────────────────────────
// Iter 2: added reverb, chorus, autoPan, filterLfo
export type FxKnobId =
  | 'distShape' | 'distThreshold'
  | 'delayFeedback' | 'delaySend'
  | 'reverbSend' | 'reverbDecay'
  | 'chorusMix' | 'chorusRate'
  | 'autoPan'
  | 'filterLfoDepth' | 'filterLfoRate';

// ── Step ────────────────────────────────────────────────────
export interface JS303Step {
  note: number;
  accent: boolean;
  slide: boolean;
  gate: boolean;
  down: boolean;
  up: boolean;
}

// ── Pattern ─────────────────────────────────────────────────
export interface JS303Pattern {
  name: string;
  steps: JS303Step[];
  /** Root note offset for transpose display */
  rootNote?: number;
}

// ── Snapshot (full deck state for React) ────────────────────
export interface JS303Snapshot {
  isPlaying: boolean;
  currentStep: number;
  bpm: number;
  syncToMaster: boolean;
  steps: JS303Step[];
  synth: Record<SynthParamId, number>;
  fx: Record<FxKnobId, number>;
  masterVolume: number;
  swing: number;
  // Iter 3: usability
  patternLength: number;
  transpose: number;
  acidMacro: number;
  // Iter 5: pattern bank
  currentBank: number;
  currentPattern: number;
  crossfaderLink: boolean;
  ghostSequenceReady: boolean;
  engineReady: boolean;
  patternName: string;
}

// ── Defaults ────────────────────────────────────────────────

export function defaultSynth(): Record<SynthParamId, number> {
  return {
    cutoff: 0.5,
    resonance: 0.5,
    envMod: 0.5,
    decay: 0.5,
    accent: 0.5,
    tuning: 0.5,
    waveform: 0,    // 0 = saw, 1 = square
    drive: 0,       // pre-filter saturation
    subLevel: 0.3,  // sub-oscillator mix
    drift: 0.3,     // analog drift amount
  };
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    distShape: 0,
    distThreshold: 1,
    delayFeedback: 0.4,
    delaySend: 0,
    reverbSend: 0,
    reverbDecay: 0.4,
    chorusMix: 0,
    chorusRate: 0.3,
    autoPan: 0,
    filterLfoDepth: 0,
    filterLfoRate: 0.5,  // maps to BPM subdivision
  };
}

export function defaultSteps(): JS303Step[] {
  return Array.from({ length: MAX_STEPS }, (_, i) => ({
    note: 40 + [0, 3, 5, 7][i % 4],
    accent: i % 4 === 2,
    slide: i % 8 === 7,
    gate: i < STEP_COUNT ? i % 2 === 0 : false,
    down: false,
    up: false,
  }));
}

// ── Musical Scales ──────────────────────────────────────────
export const SCALES: Record<string, number[]> = {
  chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  minorPent:  [0, 3, 5, 7, 10],
  blues:      [0, 3, 5, 6, 7, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
};

export const SCALE_NAMES = Object.keys(SCALES);
