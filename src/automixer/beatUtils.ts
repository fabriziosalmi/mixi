/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Beat Math Utilities for AutoMixer
//
// Pure functions for beat-time conversion and phrase alignment.
// ─────────────────────────────────────────────────────────────

/**
 * Convert a time position to a beat number relative to the grid.
 *
 *   beat = (time - gridOffset) / (60 / bpm)
 */
export function timeToBeat(time: number, bpm: number, gridOffset: number): number {
  if (bpm <= 0) return 0;
  const beatPeriod = 60 / bpm;
  return (time - gridOffset) / beatPeriod;
}

/**
 * Convert a beat number back to seconds.
 *
 *   time = gridOffset + beat * (60 / bpm)
 */
export function beatToTime(beat: number, bpm: number, gridOffset: number): number {
  const beatPeriod = 60 / bpm;
  return gridOffset + beat * beatPeriod;
}

/**
 * How many beats remain from `currentBeat` until `targetBeat`.
 */
export function beatsRemaining(currentBeat: number, targetBeat: number): number {
  return targetBeat - currentBeat;
}

/**
 * Snap a beat number to the nearest phrase boundary.
 * Phrases are 16 beats in techno (4 bars of 4/4).
 */
export function snapToPhrase(beat: number, phraseLength: number = 16): number {
  return Math.round(beat / phraseLength) * phraseLength;
}

/**
 * Find the mix-out beat: the last phrase boundary before the
 * track ends, minus a safety margin of 1 phrase.
 *
 * For a 5-minute track at 170 BPM:
 *   totalBeats = 300 * 170/60 = 850
 *   lastPhrase = floor(850 / 16) * 16 = 848
 *   mixOutBeat = 848 - 16 = 832  (one phrase before the end)
 */
export function calcMixOutBeat(
  duration: number,
  bpm: number,
  gridOffset: number,
  phraseLength: number = 16,
): number {
  if (bpm <= 0 || duration <= 0) return Infinity;
  const totalBeats = timeToBeat(duration, bpm, gridOffset);
  const lastPhrase = Math.floor(totalBeats / phraseLength) * phraseLength;
  // Mix out 1 phrase before the final phrase boundary.
  return Math.max(0, lastPhrase - phraseLength);
}

/**
 * Linear interpolation: returns a value between 0 and 1
 * representing how far `current` is between `start` and `end`.
 */
export function lerpProgress(current: number, start: number, end: number): number {
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (current - start) / (end - start)));
}
