export type FxKnobId = 'drywet';

export interface TurboMorseSnapshot {
  isActive: boolean;
  message: string;
  wpm: number; // Words per minute
  distortion: number;
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
