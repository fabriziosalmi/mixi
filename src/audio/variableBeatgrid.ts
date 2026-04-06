/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Variable Beatgrid
//
// Supports tracks with tempo changes (live recordings, vinyl
// digitizations, organic music).  For constant-BPM tracks
// (most electronic music), the grid has a single marker and
// behaves identically to the fixed grid.
//
// Data structure:
//   markers[] sorted by time, each with local BPM.
//   Between marker[i] and marker[i+1], BPM is marker[i].bpm.
//
// Lookup: O(log n) via binary search.
// ─────────────────────────────────────────────────────────────

// ── Types ───────────────────────────────────────────────────

export interface BeatMarker {
  /** Position in seconds (absolute). */
  time: number;
  /** Progressive beat number at this marker. */
  beatNum: number;
  /** Local BPM from this marker until the next. */
  bpm: number;
}

export interface VariableBeatgrid {
  /** Sorted by time. For constant BPM: single marker. */
  markers: BeatMarker[];
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a constant-BPM beatgrid (single marker).
 * This is the default for most electronic tracks.
 */
export function createFixedGrid(bpm: number, firstBeatOffset: number): VariableBeatgrid {
  return {
    markers: [{ time: firstBeatOffset, beatNum: 0, bpm }],
  };
}

// ── Lookup ──────────────────────────────────────────────────

/**
 * Find the marker segment containing `time` via binary search.
 * Returns the index of the last marker with marker.time <= time.
 */
function findSegment(markers: BeatMarker[], time: number): number {
  let lo = 0;
  let hi = markers.length - 1;

  // Before the first marker
  if (time < markers[0].time) return 0;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (markers[mid].time <= time) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Find the marker segment containing `beat` via binary search on beatNum.
 */
function findSegmentByBeat(markers: BeatMarker[], beat: number): number {
  let lo = 0;
  let hi = markers.length - 1;

  if (beat < markers[0].beatNum) return 0;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (markers[mid].beatNum <= beat) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Get the fractional beat number at a given time.
 * O(log n) where n = number of markers.
 */
export function getBeatAtTime(grid: VariableBeatgrid, time: number): number {
  const { markers } = grid;
  if (markers.length === 0) return 0;

  const idx = findSegment(markers, time);
  const m = markers[idx];
  if (m.bpm <= 0) return m.beatNum;

  const localPeriod = 60 / m.bpm;
  const elapsed = time - m.time;
  return m.beatNum + elapsed / localPeriod;
}

/**
 * Get the time (in seconds) at a given fractional beat number.
 * O(log n) where n = number of markers.
 */
export function getTimeAtBeat(grid: VariableBeatgrid, beat: number): number {
  const { markers } = grid;
  if (markers.length === 0) return 0;

  const idx = findSegmentByBeat(markers, beat);
  const m = markers[idx];
  if (m.bpm <= 0) return m.time;

  const localPeriod = 60 / m.bpm;
  return m.time + (beat - m.beatNum) * localPeriod;
}

/**
 * Get the local BPM at a given time.
 */
export function getBpmAtTime(grid: VariableBeatgrid, time: number): number {
  const { markers } = grid;
  if (markers.length === 0) return 0;
  return markers[findSegment(markers, time)].bpm;
}

// ── Detection ───────────────────────────────────────────────

/**
 * Detect variable tempo in a track by analyzing local BPM in 16-beat chunks.
 * Returns null if BPM is constant (most electronic music).
 *
 * @param buffer          – Decoded AudioBuffer
 * @param initialBpm      – Detected global BPM
 * @param firstBeatOffset – Grid offset in seconds
 * @param threshold       – BPM variation threshold (default: 0.5 BPM)
 * @returns               – VariableBeatgrid or null if constant
 */
export function detectVariableTempo(
  buffer: AudioBuffer,
  initialBpm: number,
  firstBeatOffset: number,
  threshold = 0.5,
): VariableBeatgrid | null {
  if (initialBpm <= 0) return null;

  const beatPeriod = 60 / initialBpm;
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const markers: BeatMarker[] = [{ time: firstBeatOffset, beatNum: 0, bpm: initialBpm }];

  let hasVariation = false;

  // Analyze in 16-beat chunks
  for (let chunk = 16; ; chunk += 16) {
    const chunkStart = firstBeatOffset + chunk * beatPeriod;
    const chunkEnd = chunkStart + 16 * beatPeriod;
    if (chunkEnd > buffer.duration) break;

    const localBpm = estimateLocalBpm(data, sr, chunkStart, chunkEnd, initialBpm);
    if (localBpm <= 0) continue;

    if (Math.abs(localBpm - initialBpm) > threshold) {
      hasVariation = true;
      markers.push({ time: chunkStart, beatNum: chunk, bpm: localBpm });
    }
  }

  return hasVariation ? { markers } : null;
}

/**
 * Estimate local BPM in a time window using autocorrelation
 * of the onset envelope.
 */
function estimateLocalBpm(
  data: Float32Array,
  sr: number,
  startSec: number,
  endSec: number,
  expectedBpm: number,
): number {
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const i1 = Math.min(data.length, Math.ceil(endSec * sr));
  if (i1 - i0 < sr * 0.5) return 0;  // too short

  // Compute onset envelope (RMS in 10ms windows)
  const hopSamples = Math.round(sr * 0.01);
  const envelope: number[] = [];
  let prevRms = 0;

  for (let i = i0; i < i1; i += hopSamples) {
    const end = Math.min(i + hopSamples, i1);
    let sum = 0;
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / (end - i));
    const delta = rms - prevRms;
    envelope.push(delta > 0 ? delta : 0);
    prevRms = rms;
  }

  if (envelope.length < 20) return 0;

  // Autocorrelation around expected beat period
  const expectedLag = (60 / expectedBpm) / 0.01;  // in 10ms frames
  const searchMin = Math.max(1, Math.round(expectedLag * 0.85));
  const searchMax = Math.min(envelope.length / 2, Math.round(expectedLag * 1.15));

  let bestCorr = -Infinity;
  let bestLag = expectedLag;

  for (let lag = searchMin; lag <= searchMax; lag++) {
    let corr = 0;
    const n = envelope.length - lag;
    for (let i = 0; i < n; i++) {
      corr += envelope[i] * envelope[i + lag];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Convert lag (in 10ms frames) to BPM
  const periodMs = bestLag * 10;
  if (periodMs <= 0) return 0;
  return 60000 / periodMs;
}
