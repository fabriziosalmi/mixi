/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – BPM & Beatgrid Detection (v2)
//
// Detects the tempo (BPM) and grid offset of a track by
// analysing the energy envelope of the low-frequency band.
//
// ─── Algorithm Overview ──────────────────────────────────────
//
// 1. ONSET DETECTION (Adaptive Spectral Flux)
//    RMS energy computed in ~10 ms windows on the bass-filtered
//    signal. Peaks detected where energy exceeds α × localMean.
//    Onset strength (energy delta) is recorded for weighting.
//
// 2. TEMPO ESTIMATION (Multi-hop IOI Histogram)
//    For every onset pair (adjacent AND separated by 2,3,4 hops)
//    we compute candidate BPMs and vote into a histogram.
//    Votes are weighted by onset strength. Harmonics (×2, ÷2)
//    are also voted. Gaussian-smoothed histogram finds the peak.
//
// 3. OCTAVE RESOLUTION
//    After histogram peak, we check if the BPM should be
//    doubled or halved. For electronic music: if bpm ∈ [65,95]
//    we test doubling; if bpm ∈ [150,200] we test halving.
//    The decision uses grid alignment score on the actual onsets.
//
// 4. GRID OFFSET (First Downbeat)
//    Find the onset whose position aligns the most subsequent
//    onsets to the detected beat grid.
//
// Performance: ~10–30 ms for a 5-minute track at 44.1 kHz.
// ─────────────────────────────────────────────────────────────

import { log } from '../utils/logger';
import { isWasmReady } from '../wasm/wasmBridge';

// Wasm module — imported dynamically
let wasmModule: typeof import('../../mixi-core/pkg/mixi_core') | null = null;
import('../../mixi-core/pkg/mixi_core').then((m) => { wasmModule = m; }).catch(() => {});

// ── Types ────────────────────────────────────────────────────

export interface BpmResult {
  bpm: number;
  firstBeatOffset: number;
  confidence: number;
}

// ── Constants ────────────────────────────────────────────────

/** RMS window size in samples (~10 ms at 44.1 kHz). */
const ENERGY_WINDOW = 441;

/** Adaptive threshold multiplier. */
const THRESHOLD_ALPHA = 1.3;

/** Half-width of the sliding average window (in energy frames). */
const AVG_HALF_WINDOW = 10;

/** Minimum inter-onset interval in seconds. */
const MIN_IOI = 0.12;

/** BPM search range (wide — octave resolution narrows later). */
const DEFAULT_BPM_MIN = 65;
const DEFAULT_BPM_MAX = 200;

/** Histogram bin resolution (BPM per bin). */
const BIN_RESOLUTION = 0.25;

/** Max onset hops for multi-hop IOI (1=adjacent, 2=skip one, etc.). */
const MAX_HOPS = 4;

// ── Onset with strength ─────────────────────────────────────

interface Onset {
  time: number;
  strength: number;
}

// ── Helpers ─────────────────────────────────────────────────

function computeEnergy(samples: Float32Array, windowSize: number): Float32Array {
  const numFrames = Math.floor(samples.length / windowSize);
  const energy = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const offset = i * windowSize;
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const s = samples[offset + j];
      sum += s * s;
    }
    energy[i] = Math.sqrt(sum / windowSize);
  }

  return energy;
}

/**
 * Find onset positions with adaptive thresholding.
 * Returns onset times AND their strength (energy delta above threshold).
 */
function detectOnsets(
  energy: Float32Array,
  sampleRate: number,
  windowSize: number,
): Onset[] {
  const onsets: Onset[] = [];
  const minIoiFrames = Math.ceil((MIN_IOI * sampleRate) / windowSize);
  let lastOnsetFrame = -minIoiFrames - 1;

  for (let i = AVG_HALF_WINDOW; i < energy.length - AVG_HALF_WINDOW; i++) {
    let sum = 0;
    for (let j = i - AVG_HALF_WINDOW; j <= i + AVG_HALF_WINDOW; j++) {
      sum += energy[j];
    }
    const localMean = sum / (2 * AVG_HALF_WINDOW + 1);
    const threshold = localMean * THRESHOLD_ALPHA;

    if (energy[i] > threshold && i - lastOnsetFrame >= minIoiFrames) {
      const timeSec = (i * windowSize) / sampleRate;
      const strength = energy[i] - localMean; // how far above mean
      onsets.push({ time: timeSec, strength: Math.max(0.01, strength) });
      lastOnsetFrame = i;
    }
  }

  return onsets;
}

/**
 * Build a weighted IOI histogram with multi-hop pairs.
 * Uses Gaussian smoothing instead of box filter.
 */
function estimateBpm(onsets: Onset[], bpmMin = DEFAULT_BPM_MIN, bpmMax = DEFAULT_BPM_MAX): { bpm: number; confidence: number } {
  if (onsets.length < 4) {
    return { bpm: 120, confidence: 0 };
  }

  const numBins = Math.ceil((bpmMax - bpmMin) / BIN_RESOLUTION);
  const histogram = new Float32Array(numBins);

  function voteBin(candidate: number, weight: number) {
    if (candidate >= bpmMin && candidate <= bpmMax) {
      const bin = Math.round((candidate - bpmMin) / BIN_RESOLUTION);
      if (bin >= 0 && bin < numBins) {
        histogram[bin] += weight;
      }
    }
  }

  // Multi-hop IOI: pairs separated by 1, 2, 3, 4 onsets
  for (let hop = 1; hop <= MAX_HOPS; hop++) {
    // Weight decreases for larger hops (less reliable)
    const hopWeight = 1 / hop;

    for (let i = hop; i < onsets.length; i++) {
      const ioi = onsets[i].time - onsets[i - hop].time;
      if (ioi <= 0) continue;

      // For multi-hop, divide by hop count to get single-beat interval
      const singleIoi = ioi / hop;
      const rawBpm = 60 / singleIoi;

      // Onset strength weighting: stronger onsets get more votes
      const strength = (onsets[i].strength + onsets[i - hop].strength) * 0.5;
      const weight = strength * hopWeight;

      // Vote for raw BPM and harmonic multiples
      voteBin(rawBpm, weight);
      voteBin(rawBpm * 2, weight * 0.7);
      voteBin(rawBpm / 2, weight * 0.7);
    }
  }

  // Gaussian smoothing (σ = 2 bins ≈ 0.5 BPM)
  const sigma = 2;
  const kernelRadius = 4;
  const smoothed = new Float32Array(numBins);

  for (let i = 0; i < numBins; i++) {
    let sum = 0;
    let wSum = 0;
    for (let k = -kernelRadius; k <= kernelRadius; k++) {
      const j = i + k;
      if (j >= 0 && j < numBins) {
        const g = Math.exp(-(k * k) / (2 * sigma * sigma));
        sum += histogram[j] * g;
        wSum += g;
      }
    }
    smoothed[i] = wSum > 0 ? sum / wSum : 0;
  }

  // Find the peak bin
  let peakBin = 0;
  let peakVal = 0;
  for (let i = 0; i < numBins; i++) {
    if (smoothed[i] > peakVal) {
      peakVal = smoothed[i];
      peakBin = i;
    }
  }

  // Parabolic interpolation for sub-bin precision
  let bpm = bpmMin + peakBin * BIN_RESOLUTION;
  if (peakBin > 0 && peakBin < numBins - 1) {
    const y0 = smoothed[peakBin - 1];
    const y1 = smoothed[peakBin];
    const y2 = smoothed[peakBin + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 0.001) {
      const delta = 0.5 * (y0 - y2) / denom;
      bpm += delta * BIN_RESOLUTION;
    }
  }

  // Confidence
  let totalVotes = 0;
  for (let i = 0; i < numBins; i++) totalVotes += smoothed[i];
  const confidence = totalVotes > 0 ? peakVal / totalVotes : 0;

  return { bpm, confidence };
}

/**
 * Octave resolution: decide if BPM should be doubled or halved.
 *
 * Strategy: compute grid alignment score for the candidate BPM
 * and its double/half. Pick the one with better alignment AND
 * that falls in a preferred range for electronic music.
 *
 * Electronic music conventions:
 *   - House / Techno: 120-150
 *   - Hard techno: 145-165
 *   - DnB / Jungle: 165-180
 *   - Rarely below 100 or above 185 for DJ music
 */
function resolveOctave(bpm: number, onsets: Onset[], bpmMin = DEFAULT_BPM_MIN, bpmMax = DEFAULT_BPM_MAX): number {
  // Generate candidates: bpm, bpm×2, bpm÷2
  const candidates: number[] = [bpm];
  if (bpm * 2 <= bpmMax) candidates.push(bpm * 2);
  if (bpm / 2 >= bpmMin) candidates.push(bpm / 2);

  let bestBpm = bpm;
  let bestScore = -1;

  for (const candidate of candidates) {
    const score = gridAlignmentScore(candidate, onsets);

    // Prefer BPM in "DJ range" (100-185) with a small bonus
    const inDjRange = candidate >= 100 && candidate <= 185;
    const adjustedScore = score * (inDjRange ? 1.15 : 1.0);

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestBpm = candidate;
    }
  }

  return bestBpm;
}

/**
 * Score how well onsets align to a beat grid at the given BPM.
 * Higher = better alignment.
 */
function gridAlignmentScore(bpm: number, onsets: Onset[]): number {
  if (onsets.length < 4) return 0;

  const beatPeriod = 60 / bpm;
  const tolerance = beatPeriod * 0.12;
  const searchCount = Math.min(onsets.length, 80);

  // Try multiple grid phases (first N onsets as candidates)
  let bestPhaseScore = 0;

  for (let c = 0; c < Math.min(12, searchCount); c++) {
    const phase = onsets[c].time;
    let score = 0;
    let weightSum = 0;

    for (let j = 0; j < searchCount; j++) {
      const delta = onsets[j].time - phase;
      const beatFrac = (delta / beatPeriod) % 1;
      const dist = Math.min(beatFrac, 1 - beatFrac) * beatPeriod;

      const w = onsets[j].strength;
      weightSum += w;
      if (dist < tolerance) {
        score += w;
      }
    }

    const normalizedScore = weightSum > 0 ? score / weightSum : 0;
    if (normalizedScore > bestPhaseScore) {
      bestPhaseScore = normalizedScore;
    }
  }

  return bestPhaseScore;
}

/**
 * Find the grid offset (first downbeat position).
 */
function findGridOffset(onsets: Onset[], bpm: number): number {
  if (onsets.length === 0) return 0;

  const beatPeriod = 60 / bpm;
  const tolerance = beatPeriod * 0.12;
  const searchWindow = Math.min(onsets.length, 80);

  let bestOffset = onsets[0].time;
  let bestScore = 0;

  for (let c = 0; c < Math.min(searchWindow, 20); c++) {
    const candidate = onsets[c].time;
    let score = 0;

    for (let j = c; j < searchWindow; j++) {
      const delta = onsets[j].time - candidate;
      const beatFrac = (delta / beatPeriod) % 1;
      const dist = Math.min(beatFrac, 1 - beatFrac) * beatPeriod;
      if (dist < tolerance) {
        score += onsets[j].strength; // weight by onset strength
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestOffset = candidate;
    }
  }

  return bestOffset;
}

// ── Autocorrelation refinement ──────────────────────────────
//
// The IOI histogram gives ~1 BPM precision. We refine by testing
// a narrow range around the candidate with fine steps and picking
// the BPM that maximizes grid alignment score.

function refineBpm(coarseBpm: number, onsets: Onset[]): number {
  if (onsets.length < 8) return coarseBpm;

  const searchRadius = 2.5; // ±2.5 BPM around candidate
  const step = 0.1;         // 0.1 BPM precision
  let bestBpm = coarseBpm;
  let bestScore = -1;

  for (let candidate = coarseBpm - searchRadius; candidate <= coarseBpm + searchRadius; candidate += step) {
    if (candidate < DEFAULT_BPM_MIN || candidate > DEFAULT_BPM_MAX) continue;
    const score = gridAlignmentScore(candidate, onsets);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = candidate;
    }
  }

  return bestBpm;
}

// ── Snap to common electronic BPMs ─────────────────────────
//
// Electronic music is almost always produced at integer BPMs.
// If we're within 0.5 BPM of a round number, snap to it —
// but only if the grid alignment doesn't get worse.

function snapToCommonBpm(bpm: number, onsets: Onset[]): number {
  const rounded = Math.round(bpm);
  if (Math.abs(bpm - rounded) > 0.5) return bpm;

  const scoreOriginal = gridAlignmentScore(bpm, onsets);
  const scoreRounded = gridAlignmentScore(rounded, onsets);

  // Snap if rounded score is at least 95% as good
  if (scoreRounded >= scoreOriginal * 0.95) {
    return rounded;
  }

  return bpm;
}

// ── Public API ──────────────────────────────────────────────

export interface BpmDetectOptions {
  bpmMin?: number;
  bpmMax?: number;
}

export function detectBpm(lowBandBuffer: AudioBuffer, opts?: BpmDetectOptions): BpmResult {
  const bpmMin = opts?.bpmMin ?? DEFAULT_BPM_MIN;
  const bpmMax = opts?.bpmMax ?? DEFAULT_BPM_MAX;
  const t0 = performance.now();
  const { sampleRate } = lowBandBuffer;

  // ── Rust fast path ──────────────────────────────────────
  if (isWasmReady() && wasmModule) {
    const ch0 = lowBandBuffer.getChannelData(0);
    const numCh = lowBandBuffer.numberOfChannels;
    const spc = lowBandBuffer.length;
    let flat: Float32Array;
    if (numCh === 1) {
      flat = ch0;
    } else {
      flat = new Float32Array(spc * numCh);
      for (let ch = 0; ch < numCh; ch++) {
        flat.set(lowBandBuffer.getChannelData(ch), ch * spc);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = wasmModule.detect_bpm(flat, numCh, spc, sampleRate, bpmMin, bpmMax);
    // v3: detect_bpm returns BpmResult struct { bpm, offset, confidence }
    // Legacy fallback: if result is a Vec/Float32Array (old wasm), access by index
    const bpm = result.bpm ?? result[0];
    const firstBeatOffset = result.offset ?? result[1];
    const confidence = result.confidence ?? result[2];

    const elapsed = (performance.now() - t0).toFixed(0);
    log.success(
      'BPM',
      `[Rust] Detected ${bpm} BPM (confidence ${(confidence * 100).toFixed(0)}%) ` +
      `— grid offset ${firstBeatOffset.toFixed(3)}s — ${elapsed} ms`,
    );
    return { bpm, firstBeatOffset, confidence };
  }

  // ── JS fallback ─────────────────────────────────────────

  // Mix to mono
  const ch0 = lowBandBuffer.getChannelData(0);
  let mono: Float32Array;
  if (lowBandBuffer.numberOfChannels > 1) {
    const ch1 = lowBandBuffer.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
  } else {
    mono = ch0;
  }

  // Step 1: Energy envelope
  const energy = computeEnergy(mono, ENERGY_WINDOW);

  // Step 2: Onset detection (with strength)
  const onsets = detectOnsets(energy, sampleRate, ENERGY_WINDOW);

  // Step 3: BPM estimation (multi-hop IOI histogram)
  const est = estimateBpm(onsets, bpmMin, bpmMax);
  let bpm = est.bpm;
  const confidence = est.confidence;

  // Step 4: Octave resolution (85 vs 170, etc.)
  bpm = resolveOctave(bpm, onsets, bpmMin, bpmMax);

  // Step 5: Fine refinement (±2.5 BPM sweep at 0.1 BPM steps)
  bpm = refineBpm(bpm, onsets);

  // Step 6: Snap to integer BPM if close enough
  bpm = snapToCommonBpm(bpm, onsets);

  // Round to 1 decimal place
  bpm = Math.round(bpm * 10) / 10;

  // Step 7: Grid offset
  const firstBeatOffset = findGridOffset(onsets, bpm);

  const elapsed = (performance.now() - t0).toFixed(0);
  log.success(
    'BPM',
    `Detected ${bpm} BPM (confidence ${(confidence * 100).toFixed(0)}%) ` +
    `— grid offset ${firstBeatOffset.toFixed(3)}s — ${onsets.length} onsets — ${elapsed} ms`,
  );

  return { bpm, firstBeatOffset, confidence };
}
