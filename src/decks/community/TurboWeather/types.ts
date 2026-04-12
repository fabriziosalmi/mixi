export type FxKnobId = 'drywet';

export interface TurboWeatherSnapshot {
  isActive: boolean;
  latitude: number;
  longitude: number;
  isFetching: boolean;
  windSpeed: number; // Modulates cutoff & noise amplitude
  temperature: number; // Modulates noise pitch/color
  weatherCode: number; // General mood
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
