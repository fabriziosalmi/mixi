// @ts-nocheck
export type FxKnobId = 'drywet';

export interface TurboPulsarSnapshot {
  isActive: boolean;
  periodMs: number; // Pulsar rotational period in milliseconds (1.5ms to 8000ms)
  dispersion: number; // Interstellar dispersion measure (affects transient sharpness)
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
