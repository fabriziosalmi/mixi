export const STEP_COUNT = 32;

export type SynthParamId = 'waveform' | 'cutoff' | 'resonance' | 'attack' | 'release';

// No internal FX natively in the WASM right now, let's keep the FX record empty or just one placeholder
export type FxKnobId = 'drywet';

export interface TurboSynthStep {
  note: number;
  gate: boolean;
}

export interface TurboSynthSnapshot {
  isPlaying: boolean;
  currentStep: number;
  bpm: number;
  syncToMaster: boolean;
  steps: TurboSynthStep[];
  synth: Record<SynthParamId, number>;
  fx: Record<FxKnobId, number>;
  masterVolume: number;
  swing: number;
}

export function defaultSynth(): Record<SynthParamId, number> {
  return {
    waveform: 2, // 0..3 maps to Sine, Tri, Saw, Sq
    cutoff: 0.5, // 0..1
    resonance: 0.2, // 0..1
    attack: 0.1, // 0..1
    release: 0.2, // 0..1
  };
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    drywet: 1.0,
  };
}

export function defaultSteps(): TurboSynthStep[] {
  return Array.from({ length: STEP_COUNT }, (_, i) => ({
    note: 60 + [0, 3, 5, -2, 7, 0, 12, 10][i % 8],
    gate: i % 4 === 0,
  }));
}
