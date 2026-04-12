// @ts-nocheck
export type FxKnobId = 'drywet';

export interface Boid {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface TurboBoidSnapshot {
  isActive: boolean;
  boidCount: number;
  maxSpeed: number;
  scale: number;
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
