/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Phase Cancellation Defense
//
// When two kicks hit at exactly 0ms offset and their fundamental
// frequencies are close (e.g. both at 50Hz), the bass can cancel
// out entirely.  The subwoofer cone is pushed out by one track
// and pulled in by the other.  The crowd hears no bass.
//
// This module detects it and applies a micro-nudge (2ms) that's
// inaudible but breaks the destructive interference.
//
// Detection: compare RMS of (A+B) sum vs expected sqrt(A²+B²).
// If sum < 60% of expected → phase cancellation detected.
// ─────────────────────────────────────────────────────────────

/**
 * Detect phase cancellation between two low-frequency chunks.
 *
 * @param masterLow – Low-pass filtered (<100Hz) mono samples from master
 * @param slaveLow  – Low-pass filtered (<100Hz) mono samples from slave
 * @returns true if destructive cancellation is detected
 */
export function detectPhaseCancellation(
  masterLow: Float32Array,
  slaveLow: Float32Array,
): boolean {
  const len = Math.min(masterLow.length, slaveLow.length);
  if (len < 64) return false;

  let sumMaster2 = 0;
  let sumSlave2 = 0;
  let sumCombined2 = 0;

  for (let i = 0; i < len; i++) {
    const m = masterLow[i];
    const s = slaveLow[i];
    sumMaster2 += m * m;
    sumSlave2 += s * s;
    const combined = m + s;
    sumCombined2 += combined * combined;
  }

  const rmsMaster = Math.sqrt(sumMaster2 / len);
  const rmsSlave = Math.sqrt(sumSlave2 / len);
  const rmsCombined = Math.sqrt(sumCombined2 / len);

  // Both need to have meaningful energy
  if (rmsMaster < 0.005 || rmsSlave < 0.005) return false;

  // Expected sum if signals are uncorrelated:
  // RMS_expected = sqrt(RMS_A² + RMS_B²)
  const expectedSum = Math.sqrt(rmsMaster * rmsMaster + rmsSlave * rmsSlave);

  // If combined RMS is less than 60% of expected → cancellation
  return rmsCombined < expectedSum * 0.6;
}

/**
 * Extract low-frequency content from a buffer chunk using a simple
 * moving average lowpass filter (~100Hz cutoff at 44.1kHz).
 *
 * This is a fast approximation — not a proper Butterworth, but
 * sufficient for phase cancellation detection where we only need
 * the fundamental kick energy.
 *
 * @param samples – Mono audio chunk
 * @param sr      – Sample rate
 * @returns       – Low-pass filtered chunk
 */
export function extractLowFreq(
  samples: Float32Array,
  sr: number,
): Float32Array {
  // Moving average window: sr / 100Hz = ~441 samples at 44.1kHz
  // Use two passes for a steeper rolloff (~-12dB/oct)
  const windowSize = Math.max(4, Math.round(sr / 100));
  const out = new Float32Array(samples.length);

  // Pass 1: forward moving average
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i];
    if (i >= windowSize) sum -= samples[i - windowSize];
    out[i] = sum / Math.min(i + 1, windowSize);
  }

  // Pass 2: backward moving average (zero-phase)
  const result = new Float32Array(samples.length);
  sum = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    sum += out[i];
    const idx = i + windowSize;
    if (idx < samples.length) sum -= out[idx];
    const count = Math.min(samples.length - i, windowSize);
    result[i] = sum / count;
  }

  return result;
}
