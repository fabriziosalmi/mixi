/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Parameter Smoothing Utilities
//
// CRITICAL: Never assign `param.value = x` on a live AudioParam.
// That causes a discontinuity → audible click ("zipper noise").
//
// Instead we always use `setTargetAtTime` which exponentially
// approaches the target value with a given time-constant τ.
// After ~5τ the value is within 0.7 % of the target – for
// τ = 10 ms that's 50 ms, well within human perception.
// ─────────────────────────────────────────────────────────────

/**
 * Default smoothing time-constant in seconds.
 * 10–15 ms is the sweet spot:
 *   - Fast enough to feel responsive.
 *   - Slow enough to avoid zipper noise.
 */
export const SMOOTH_TIME_CONSTANT = 0.012; // 12 ms

/**
 * Smoothly ramp an AudioParam to `value` using `setTargetAtTime`.
 *
 * @param param  - The AudioParam to change (e.g. GainNode.gain).
 * @param value  - Target value.
 * @param ctx    - The AudioContext (needed for `currentTime`).
 * @param tau    - Time-constant override (seconds). Default 12 ms.
 */
export function smoothParam(
  param: AudioParam,
  value: number,
  ctx: AudioContext,
  tau: number = SMOOTH_TIME_CONSTANT,
): void {
  // Skip if already at (or very close to) the target value.
  // Avoids redundant cancel+schedule cycles during 60fps drags.
  if (Math.abs(param.value - value) < 1e-6) return;
  const now = ctx.currentTime;
  // Hold the current interpolated value before starting the new target ramp so
  // rapid drags never snap back to the pre-ramp intrinsic value (zipper noise).
  if (typeof param.cancelAndHoldAtTime === 'function') {
    try {
      param.cancelAndHoldAtTime(now);
    } catch {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.setTargetAtTime(value, now, tau);
}
