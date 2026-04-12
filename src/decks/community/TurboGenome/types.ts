export type FxKnobId = 'drywet';

export interface TurboGenomeSnapshot {
  isActive: boolean;
  sequenceStr: string;
  speedMs: number;
  mutationRate: number; // 0 to 1. Probability of substituting base randomly
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
