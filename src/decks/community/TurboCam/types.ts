export type FxKnobId = 'drywet';

export interface TurboCamSnapshot {
  isActive: boolean;
  camWidth: number;
  camHeight: number;
  threshold: number;
  smoothing: number;
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return {
    drywet: 1.0,
  };
}
