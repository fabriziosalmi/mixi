export const STEP_COUNT = 32;

export type SynthParamId = 
  | 'algo' | 'feedback'
  | 'carAttack' | 'carDecay'
  | 'modAttack' | 'modDecay'
  | 'op1Ratio' | 'op1Level'
  | 'op2Ratio' | 'op2Level'
  | 'op3Ratio' | 'op3Level'
  | 'op4Ratio' | 'op4Level';

export type FxKnobId = 'drywet';

export interface TurboFMStep {
  note: number;
  gate: boolean;
}

export interface TurboFMSnapshot {
  isPlaying: boolean;
  currentStep: number;
  bpm: number;
  syncToMaster: boolean;
  steps: TurboFMStep[];
  synth: Record<SynthParamId, number>;
  fx: Record<FxKnobId, number>;
  masterVolume: number;
  swing: number;
}

export function defaultSynth(): Record<SynthParamId, number> {
  return {
    algo: 0.33, // 0..1 maps to 0..3 (algo 1 Stack)
    feedback: 0.5,
    carAttack: 0.0,
    carDecay: 0.3,
    modAttack: 0.0,
    modDecay: 0.1, // Snappy modulator
    op1Ratio: 0.0, // Maps to 1.0
    op1Level: 1.0, 
    op2Ratio: 0.1, // Maps to roughly 2.0
    op2Level: 1.0,
    op3Ratio: 0.2, // Maps to roughly 3.0
    op3Level: 1.0,
    op4Ratio: 0.3, // Maps to roughly 4.0
    op4Level: 1.0,
  };
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    drywet: 1.0,
  };
}

export function defaultSteps(): TurboFMStep[] {
  return Array.from({ length: STEP_COUNT }, (_, i) => ({
    note: 36 + [0, 3, 5, -2, 7, 0, 12, 10][i % 8],
    gate: i % 4 === 0,
  }));
}
