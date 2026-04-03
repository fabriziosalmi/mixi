/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Drop Detector
//
// Finds the "drop" positions in a track by analysing the
// energy profile of the waveform data.
//
// A "drop" in electronic music is defined as:
//   A sudden, large increase in low-frequency energy following
//   a period of reduced energy (breakdown/buildup).
//
// Algorithm:
//
//   1. Compute a smoothed energy envelope of the low band
//      using a sliding window (4 beats wide).
//
//   2. Compute the first derivative (rate of energy change).
//
//   3. Find positive peaks in the derivative that exceed a
//      threshold — these are "energy jumps".
//
//   4. Filter to phrase boundaries (beat mod 16 < 2) because
//      drops in techno always land on the 1 of a phrase.
//
//   5. Sort by magnitude — the biggest jump is the "main drop".
//
// Output:
//   An array of beat numbers where drops occur, sorted by
//   importance (biggest energy jump first).
// ─────────────────────────────────────────────────────────────

import { log } from '../utils/logger';
import type { WaveformPoint } from './WaveformAnalyzer';

/** A detected drop with its beat position and strength. */
export interface DropMarker {
  /** Beat number on the grid where the drop hits. */
  beat: number;
  /** Strength of the energy jump (0–1 normalised). */
  strength: number;
}

/** Points per second in the waveform data. */
const PPS = 100; // must match POINTS_PER_SECOND

/**
 * Detect drop positions from waveform + BPM data.
 *
 * @param waveform        – The RGB waveform points array.
 * @param bpm             – Detected BPM.
 * @param firstBeatOffset – Grid offset in seconds.
 * @param duration        – Track duration in seconds.
 * @returns               – Array of DropMarker sorted by strength (descending).
 */
export function detectDrops(
  waveform: WaveformPoint[],
  bpm: number,
  firstBeatOffset: number,
  _duration: number,
): DropMarker[] {
  if (bpm <= 0 || waveform.length < PPS * 4) return [];

  const t0 = performance.now();
  const beatPeriod = 60 / bpm;
  const samplesPerBeat = Math.round(beatPeriod * PPS);

  // ── 1. Extract low-band energy ─────────────────────────────

  const rawLow = new Float32Array(waveform.length);
  for (let i = 0; i < waveform.length; i++) {
    rawLow[i] = waveform[i].low;
  }

  // ── 2. Smooth with a 4-beat sliding window ─────────────────
  //
  // This removes micro-fluctuations within a bar and reveals
  // the macro energy contour (intro → buildup → drop → break).
  // Uses an O(n) running-sum approach.

  const windowSize = samplesPerBeat * 4;
  const halfWindow = Math.floor(windowSize / 2);
  const smoothed = new Float32Array(rawLow.length);

  // Seed running sum for position 0.
  let runningSum = 0;
  const wEnd0 = Math.min(rawLow.length - 1, halfWindow);
  for (let j = 0; j <= wEnd0; j++) runningSum += rawLow[j];
  let prevStart = 0;
  let prevEnd = wEnd0;
  smoothed[0] = runningSum / (prevEnd - prevStart + 1);

  // Slide the window: subtract the sample leaving, add the sample entering.
  for (let i = 1; i < rawLow.length; i++) {
    const wStart = Math.max(0, i - halfWindow);
    const wEnd = Math.min(rawLow.length - 1, i + halfWindow);

    // Add new sample entering on the right.
    if (wEnd > prevEnd) {
      runningSum += rawLow[wEnd];
    }
    // Remove sample leaving on the left.
    if (wStart > prevStart) {
      runningSum -= rawLow[prevStart];
    }

    const count = wEnd - wStart + 1;
    smoothed[i] = runningSum / count;
    prevStart = wStart;
    prevEnd = wEnd;
  }

  // ── 3. First derivative (energy change rate) ───────────────
  //
  //   derivative[i] = smoothed[i] - smoothed[i - samplesPerBeat]
  //
  // We compare across one beat, not adjacent samples, to catch
  // the "jump" rather than the "slope".

  const derivative = new Float32Array(smoothed.length);
  for (let i = samplesPerBeat; i < smoothed.length; i++) {
    derivative[i] = smoothed[i] - smoothed[i - samplesPerBeat];
  }

  // ── 4. Find peaks in the derivative ────────────────────────
  //
  // A peak must:
  //   - Be positive (energy increase, not decrease)
  //   - Exceed a threshold (mean + 1.5 × stddev)
  //   - Be a local maximum (higher than neighbours ± 1 beat)

  // Compute threshold.
  let sumDeriv = 0;
  let sumDerivSq = 0;
  let posCount = 0;
  for (let i = 0; i < derivative.length; i++) {
    if (derivative[i] > 0) {
      sumDeriv += derivative[i];
      sumDerivSq += derivative[i] * derivative[i];
      posCount++;
    }
  }
  const meanDeriv = posCount > 0 ? sumDeriv / posCount : 0;
  const variance = posCount > 0 ? sumDerivSq / posCount - meanDeriv * meanDeriv : 0;
  const stdDeriv = Math.sqrt(Math.max(0, variance));
  const threshold = meanDeriv + 1.5 * stdDeriv;

  const candidates: DropMarker[] = [];

  for (let i = samplesPerBeat * 2; i < derivative.length - samplesPerBeat; i++) {
    if (derivative[i] <= threshold) continue;

    // Local maximum check (± 1 beat).
    let isMax = true;
    for (let j = i - samplesPerBeat; j <= i + samplesPerBeat; j++) {
      if (j !== i && j >= 0 && j < derivative.length && derivative[j] > derivative[i]) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;

    // Convert sample index to time, then to beat.
    const timeSec = i / PPS;
    const beat = (timeSec - firstBeatOffset) / beatPeriod;

    // ── 5. Phrase boundary filter ────────────────────────────
    // Drops in techno land on beat 0 of a 16-beat phrase.
    const beatInPhrase = ((beat % 16) + 16) % 16;
    if (beatInPhrase > 2 && beatInPhrase < 14) continue;

    // Snap to nearest phrase boundary.
    const snappedBeat = Math.round(beat / 16) * 16;

    // Deduplicate: skip if too close to an existing candidate.
    const tooClose = candidates.some(
      (c) => Math.abs(c.beat - snappedBeat) < 16,
    );
    if (tooClose) continue;

    candidates.push({
      beat: snappedBeat,
      strength: derivative[i],
    });
  }

  // Normalise strengths to 0–1.
  const maxStrength = candidates.reduce((m, c) => Math.max(m, c.strength), 0);
  if (maxStrength > 0) {
    for (const c of candidates) c.strength /= maxStrength;
  }

  // Sort by strength descending (main drop first).
  candidates.sort((a, b) => b.strength - a.strength);

  const elapsed = (performance.now() - t0).toFixed(0);
  log.success(
    'DropDetector',
    `Found ${candidates.length} drops in ${elapsed} ms` +
    (candidates.length > 0 ? ` — main drop at beat ${candidates[0].beat}` : ''),
  );

  return candidates;
}
