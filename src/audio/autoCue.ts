/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Smart Auto-Cue (Grid-Snapped)
//
// Finds the first musically significant downbeat in a track,
// immune to reverse cymbals, risers, and breath sounds that
// would fool a naive RMS threshold approach.
//
// Algorithm:  audio is a hint, beatgrid is the law.
//
//   1. Walk the beatgrid, check RMS at each beat position
//   2. Find the first beat above silence threshold (candidate)
//   3. Snap to the nearest downbeat (beat 1 of a 4-beat bar)
//   4. If candidate is far from a downbeat, search forward
//   5. Fallback: firstBeatOffset
// ─────────────────────────────────────────────────────────────

/** Silence threshold: -40 dBFS ≈ 0.01 in float amplitude. */
const SILENCE_THRESHOLD = 0.01;

/** Maximum beats to scan (avoid scanning entire 10-minute track). */
const MAX_SCAN_BEATS = 128;

/** Snap tolerance: if raw cue is within 100ms of a downbeat, snap to it. */
const SNAP_TOLERANCE_S = 0.100;

/**
 * Compute RMS energy of a mono buffer in a time window.
 * @param data  – Channel data (Float32Array)
 * @param sr    – Sample rate
 * @param start – Window start in seconds
 * @param end   – Window end in seconds
 */
function windowRMS(data: Float32Array, sr: number, start: number, end: number): number {
  const i0 = Math.max(0, Math.floor(start * sr));
  const i1 = Math.min(data.length, Math.ceil(end * sr));
  if (i1 <= i0) return 0;

  let sum = 0;
  for (let i = i0; i < i1; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / (i1 - i0));
}

/**
 * Find the optimal auto-cue point for a track.
 *
 * @param buffer          – Decoded AudioBuffer
 * @param bpm             – Detected BPM
 * @param firstBeatOffset – Grid offset in seconds
 * @returns               – Cue point time in seconds
 */
export function findAutoCuePoint(
  buffer: AudioBuffer,
  bpm: number,
  firstBeatOffset: number,
): number {
  if (bpm <= 0) return firstBeatOffset;

  const beatPeriod = 60 / bpm;
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;

  // STEP 1: Walk the beatgrid, find first beat with energy above threshold
  let rawCueBeat = -1;
  let rawCueTime = -1;

  for (let beatNum = 0; beatNum < MAX_SCAN_BEATS; beatNum++) {
    const beatTime = firstBeatOffset + beatNum * beatPeriod;
    if (beatTime >= buffer.duration) break;

    // Check a window around the beat: -5ms to +50ms
    // (transient onset is slightly before the grid point)
    const rms = windowRMS(data, sr, beatTime - 0.005, beatTime + 0.050);

    if (rms > SILENCE_THRESHOLD) {
      rawCueBeat = beatNum;
      rawCueTime = beatTime;
      break;
    }
  }

  // No energy found — fallback to grid origin
  if (rawCueTime < 0) return firstBeatOffset;

  // STEP 2: Find the nearest downbeat (beat 1 of a 4-beat bar)
  const nearestDownbeatNum = Math.round(rawCueBeat / 4) * 4;
  const snappedCueTime = firstBeatOffset + nearestDownbeatNum * beatPeriod;

  // STEP 3: If candidate is close to a downbeat, snap to it
  if (Math.abs(rawCueTime - snappedCueTime) < SNAP_TOLERANCE_S) {
    return Math.max(0, snappedCueTime);
  }

  // STEP 4: Candidate is far from a downbeat (riser / intro anomaly).
  // Search the next 3 downbeats for one with sufficient energy.
  const nextDown = Math.ceil(rawCueBeat / 4) * 4;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidateBeat = nextDown + attempt * 4;
    const candidateTime = firstBeatOffset + candidateBeat * beatPeriod;
    if (candidateTime >= buffer.duration) break;

    const rms = windowRMS(data, sr, candidateTime - 0.005, candidateTime + 0.050);
    if (rms > SILENCE_THRESHOLD) {
      return Math.max(0, candidateTime);
    }
  }

  // STEP 5: No energetic downbeat found — use the first audible beat
  return Math.max(0, rawCueTime);
}
