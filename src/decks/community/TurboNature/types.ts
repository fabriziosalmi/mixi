// @ts-nocheck
export type SynthParamId = 'birds' | 'wind' | 'rain' | 'magic';
export type EnvironmentId = 'forest' | 'fireplace' | 'ocean' | 'rain';

export interface EnvironmentInfo {
  id: EnvironmentId;
  name: string;
  videoId: string;
}

export const ENVIRONMENTS: EnvironmentInfo[] = [
  { id: 'forest', name: 'Forest', videoId: '2jIMBAcrXPg' },
  { id: 'ocean', name: 'Ocean', videoId: 'wqH_2z21zEc' },
  { id: 'fireplace', name: 'Fire', videoId: 'mSX3OyW9Rao' },
  { id: 'rain', name: 'Rain', videoId: '7kN_DF_NJGQ' },
];

export interface TurboNatureSnapshot {
  isPlaying: boolean;
  masterVolume: number;
  environment: EnvironmentId;
  synth: Record<SynthParamId, number>;
}

export function defaultSynth(): Record<SynthParamId, number> {
  return {
    birds: 0.0,
    wind: 0.0,
    rain: 0.0,
    magic: 0.0,
  };
}
