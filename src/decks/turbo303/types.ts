export const STEP_COUNT = 16;

export type SynthParamId = 'cutoff' | 'resonance' | 'envMod' | 'decay' | 'accent' | 'tuning' | 'waveform';
export type FxKnobId = 'distShape' | 'distThreshold' | 'delayFeedback' | 'delaySend';

export interface JS303Step {
  note: number;
  accent: boolean;
  slide: boolean;
  gate: boolean;
  down: boolean;
  up: boolean;
}

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
}

export function defaultSynth(): Record<SynthParamId, number> {
  return {
    cutoff: 0.5,     // mapped to 200..20000
    resonance: 0.5,  // mapped to 0..1
    envMod: 0.5,     // mapped to 0..1
    decay: 0.5,      // mapped to 100..2000
    accent: 0.5,     // mapped to 0..1
    tuning: 0.5,     // mapped to -12..12
    waveform: 0.0,   // 0 for saw, 1 for square
  };
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    distShape: 0.0,      // mapped to 0..1
    distThreshold: 1.0,  // mapped to 0..1
    delayFeedback: 0.5,  // mapped to 0..1
    delaySend: 0.5,      // mapped to 0..1
  };
}

export function defaultSteps(): JS303Step[] {
  return Array.from({ length: STEP_COUNT }, (_, i) => ({
    note: 40 + [0, 3, 5, 7][i % 4], // basic acid riff
    accent: i % 4 === 2,
    slide: i % 8 === 7,
    gate: i % 2 === 0,
    down: false,
    up: false,
  }));
}
