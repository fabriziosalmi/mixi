export const STEP_COUNT = 32;

export type SynthParamId = 'morph' | 'vibrato' | 'glide' | 'lfoRate' | 'attack' | 'decay';

export type FxKnobId = 'drywet';

export interface TurboVoxStep {
  note: number;
  gate: boolean;
}

export interface TurboVoxSnapshot {
  isPlaying: boolean;
  currentStep: number;
  bpm: number;
  syncToMaster: boolean;
  steps: TurboVoxStep[];
  synth: Record<SynthParamId, number>;
  fx: Record<FxKnobId, number>;
  masterVolume: number;
  swing: number;
}

export function defaultSynth(): Record<SynthParamId, number> {
  return {
    morph: 0.0, // 0..1 (A E I O U)
    vibrato: 0.2, // 0..1
    glide: 0.1, // 0..1
    lfoRate: 0.5, // 0..1 => maps to roughly 0..20Hz
    attack: 0.0, // 0..1
    decay: 0.3, // 0..1
  };
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    drywet: 1.0,
  };
}

export function defaultSteps(): TurboVoxStep[] {
  return Array.from({ length: STEP_COUNT }, (_, i) => ({
    note: 36 + [0, 2, 4, 0, 7, -5, 12, 5][i % 8],
    gate: i % 4 === 0,
  }));
}
