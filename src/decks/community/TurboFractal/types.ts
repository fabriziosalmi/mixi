export type FxKnobId = 'drywet';

export interface TurboFractalSnapshot {
  isActive: boolean;
  baseFreq: number;
  posX: number; // Mandelbrot X (Real)
  posY: number; // Mandelbrot Y (Imaginary)
  zoom: number; // For the wanderer
  masterVolume: number;
}

export function defaultFx(): Record<FxKnobId, number> {
  return { drywet: 1.0 };
}
