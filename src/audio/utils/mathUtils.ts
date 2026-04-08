/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Audio Math Utilities
// Pure math functions used by the DSP engine.
// ─────────────────────────────────────────────────────────────

/**
 * Convert a decibel value to a linear gain multiplier.
 *
 *   gain = 10^(dB / 20)
 *
 * Examples:
 *    0 dB → 1.0     (unity)
 *   -6 dB → ~0.5    (half amplitude)
 *  -40 dB → 0.01    (near-silent ≈ kill)
 *   +6 dB → ~2.0    (double amplitude)
 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Crossfader curve type. */
export type CrossfaderCurve = 'smooth' | 'sharp';

/**
 * Crossfader gain calculation with selectable curve.
 *
 * SMOOTH (equal-power cosine):
 *   Gain_A = cos(x · π/2),  Gain_B = sin(x · π/2)
 *   At center: both ≈ 0.707 → constant power sum.
 *   Good for blending / long transitions.
 *
 * SHARP (hard cut):
 *   Near-instant cut with a tiny 5% dead zone.
 *   At center: both = 1.  Moving past 95% → the other side = 0.
 *   Good for scratch DJing / hip-hop cuts.
 */
export function crossfaderGains(
  x: number,
  curve: CrossfaderCurve = 'smooth',
): { gainA: number; gainB: number } {
  if (curve === 'sharp') {
    // Sharp: steep power curve cut with tiny dead zone.
    // 0–0.02 = A only, 0.98–1 = B only, in between = steep curve.
    const gainA = x >= 1 ? 0 : x > 0.02 ? Math.pow(1 - (x - 0.02) / 0.96, 3) : 1;
    const gainB = x <= 0 ? 0 : x < 0.98 ? Math.pow((x - 0.02) / 0.96, 3) : 1;
    // Clamp both to [0, 1] — the cubic curve can exceed 1.0 at extremes
    // (e.g. x=0 → gainA = (1 - (-0.02)/0.96)^3 ≈ 1.063 → clipping).
    return {
      gainA: Math.min(1, Math.max(0, gainA)),
      gainB: Math.min(1, Math.max(0, gainB)),
    };
  }

  // Smooth: equal-power cosine.
  const half_pi = Math.PI / 2;
  return {
    gainA: Math.cos(x * half_pi),
    gainB: Math.cos((1 - x) * half_pi),
  };
}

/**
 * Logarithmic frequency mapping for the Color FX knob.
 *
 * Human hearing is logarithmic: the interval 20 Hz → 200 Hz
 * and 2 000 Hz → 20 000 Hz both feel like "one octave span".
 * A linear mapping would bunch all the musical range into
 * a tiny sliver of the knob.  We map linearly in log-space
 * so equal knob travel = equal perceived frequency change.
 *
 * @param t  - Normalised knob position [0, 1].
 * @returns  - Frequency in Hz, mapped 20 → 20 000 logarithmically.
 */
export function logFrequency(t: number): number {
  const MIN_FREQ = 20;
  const MAX_FREQ = 20_000;
  //  f = MIN * (MAX/MIN)^t
  //  at t = 0 → 20 Hz,  t = 1 → 20 000 Hz
  return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, t);
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
