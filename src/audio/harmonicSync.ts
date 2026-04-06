/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Harmonic Sync (Logical Phase Multiplier)
//
// When mixing across genres (e.g. DnB 170 + House 128), standard
// 1:1 sync doesn't work.  This module finds the best harmonic
// ratio and applies a LOGICAL grid multiplication — the slave
// continues playing at its natural speed, only the sync math
// changes.  Zero time-stretch artifacts.
//
// Supported ratios:
//   1:1  = same tempo (standard)
//   2:1  = master double the slave (DnB on halftime)
//   1:2  = master half the slave
//   3:4  = polyrhythmic (triplet feel)
//   4:3  = inverse
// ─────────────────────────────────────────────────────────────

/** Candidate ratios ordered by musical likelihood. */
const RATIOS = [1, 2, 0.5, 1.5, 0.75, 4 / 3, 3 / 4] as const;

/** Maximum BPM error to accept a ratio (beyond this, try 1:1). */
const MAX_ERROR_BPM = 5;

/**
 * Find the best harmonic sync ratio between two BPM values.
 *
 * @param masterBpm – Current BPM of the master deck
 * @param slaveBpm  – Original BPM of the slave deck
 * @returns         – Best ratio (slave virtual grid = slave grid / ratio)
 */
export function findBestRatio(masterBpm: number, slaveBpm: number): number {
  if (masterBpm <= 0 || slaveBpm <= 0) return 1;

  let bestRatio = 1;
  let bestError = Infinity;

  for (const ratio of RATIOS) {
    const targetBpm = masterBpm / ratio;
    const error = Math.abs(slaveBpm - targetBpm);
    if (error < bestError && error < MAX_ERROR_BPM) {
      bestError = error;
      bestRatio = ratio;
    }
  }

  return bestRatio;
}

/**
 * Compute the fine playback rate adjustment for harmonic sync.
 * The slave stays near its natural speed — only micro-adjusts.
 *
 * @param masterBpm    – Master deck BPM
 * @param slaveOrigBpm – Slave deck original (unmodified) BPM
 * @param ratio        – Harmonic ratio from findBestRatio()
 * @returns            – Playback rate for the slave (close to 1.0)
 */
export function harmonicRate(
  masterBpm: number,
  slaveOrigBpm: number,
  ratio: number,
): number {
  if (slaveOrigBpm <= 0 || ratio <= 0) return 1;
  const targetBpm = masterBpm / ratio;
  const rate = targetBpm / slaveOrigBpm;
  // Clamp to pitch fader range
  return Math.max(0.92, Math.min(1.08, rate));
}

/**
 * Compute the virtual beat period for the slave deck.
 * The PLL and phase meter use this instead of the raw beat period.
 *
 * @param slaveBpm – Current (effective) BPM of the slave
 * @param ratio    – Harmonic ratio
 * @returns        – Virtual beat period in seconds
 */
export function virtualBeatPeriod(slaveBpm: number, ratio: number): number {
  if (slaveBpm <= 0 || ratio <= 0) return 0;
  return (60 / slaveBpm) / ratio;
}
