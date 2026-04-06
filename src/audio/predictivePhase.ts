/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Predictive Phase Alignment
//
// Instead of correcting drift after it occurs, predict it.
//
// The Web Audio clock has recognizable jitter patterns:
//   - GC pauses (periodic, ~10-50ms)
//   - Tab throttling (when browser loses focus)
//   - CPU thermal throttling (gradual, detectable)
//
// This module maintains a sliding window of phase error samples,
// computes a linear trend, and returns a pre-compensation value
// that the PLL applies proactively.
//
// Conservative: applies only 50% of the predicted correction
// to avoid over-correction (which would create oscillation).
// ─────────────────────────────────────────────────────────────

/** Sliding window size (last 20 samples × 50ms = 1s of history). */
const WINDOW_SIZE = 20;

/** Prediction horizon: how far ahead to predict (in ticks). */
const PREDICTION_HORIZON = 2;  // 2 ticks = 100ms

/** Damping: apply only 50% of predicted correction. */
const DAMPING = 0.5;

/**
 * Predictive phase compensator.
 * Maintains a per-deck sliding window of phase deltas
 * and extrapolates the trend.
 */
export class PhasePredictor {
  private windows: Record<string, number[]> = {};

  /**
   * Add a new phase delta sample and return the predicted correction.
   *
   * @param deckId – Deck identifier
   * @param delta  – Current phase delta (fraction of beat)
   * @returns      – Pre-compensation value (fraction of beat, negative = counteract predicted drift)
   */
  update(deckId: string, delta: number): number {
    if (!this.windows[deckId]) this.windows[deckId] = [];
    const w = this.windows[deckId];

    w.push(delta);
    if (w.length > WINDOW_SIZE) w.shift();
    if (w.length < 5) return 0;  // insufficient data

    // Linear regression: compute slope
    const n = w.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += w[i];
      sumXY += i * w[i];
      sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return 0;

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // Predict phase delta N ticks ahead
    const predictedDelta = intercept + slope * (n + PREDICTION_HORIZON);

    // Pre-compensation: counteract the predicted drift
    // Apply only DAMPING fraction to avoid oscillation
    return -predictedDelta * DAMPING;
  }

  /** Reset predictor for a deck. */
  reset(deckId: string): void {
    delete this.windows[deckId];
  }

  /** Reset all state. */
  resetAll(): void {
    this.windows = {};
  }
}

/** Singleton predictor. */
export const phasePredictor = new PhasePredictor();
