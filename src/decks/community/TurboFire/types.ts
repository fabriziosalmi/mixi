// @ts-nocheck
export type SynthParamId = 'warmth' | 'crackle' | 'wind';
export type FxKnobId = 'drywet';

export interface TurboFireSnapshot {
  isPlaying: boolean;
  masterVolume: number;
  synth: Record<SynthParamId, number>;
  fx: Record<FxKnobId, number>;
}

export function defaultSynth(): Record<SynthParamId, number> {
  return {
    warmth: 0.5, // 0..1 (lowpass filter cutoff on fire roar)
    crackle: 0.6, // 0..1 (density/volume of wood pops)
    wind: 0.2, // 0..1 (LFO modulated background air)
  };
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    drywet: 1.0,
  };
}
