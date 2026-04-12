// @ts-nocheck
export type FxKnobId = 'drywet';

export interface TurboSonarSnapshot {
  isActive: boolean;
  depth: number; // Modulates reverb time / delay size
  pingRate: number; // Ping frequency (Hz)
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
