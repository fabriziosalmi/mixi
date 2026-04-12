// @ts-nocheck
export type FxKnobId = 'drywet';

export interface TurboGeigerSnapshot {
  isPlaying: boolean;
  halfLife: number; // Modulates lambda density (0.0 to 1.0)
  radiationType: 'alpha' | 'beta' | 'gamma';
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
