// @ts-nocheck
export type FxKnobId = 'drywet';

export interface TurboBrainSnapshot {
  isActive: boolean;
  baseFreq: number; // e.g. 100-400Hz carrier
  beatFreq: number; // e.g. 0.5 - 40Hz (Delta to Gamma)
  waveType: 'sine' | 'triangle';
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
