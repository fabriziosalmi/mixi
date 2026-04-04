/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Musical Key Detector
//
// Detects the musical key of a track using:
//   1. Goertzel algorithm to extract pitch-class energy
//   2. Krumhansl-Kessler key profiles for classification
//
// Output: Camelot notation (e.g. "8A" = A minor, "11B" = B major)
// which is the standard DJ format for harmonic mixing.
//
// ─── How it works ────────────────────────────────────────────
//
// 1. PITCH CLASS ENERGY (Chromagram)
//    For each of the 12 pitch classes (C, C#, D, ..., B) we
//    compute the total energy across 4 octaves (C2–B5) using
//    the Goertzel algorithm.
//
//    Goertzel is like a single-bin DFT: it computes the energy
//    at one specific frequency with O(N) operations and zero
//    memory allocation.  Much faster than FFT when you only
//    need 48 bins (12 pitches × 4 octaves).
//
// 2. KEY PROFILE MATCHING
//    We correlate the chromagram with 24 reference profiles
//    (12 major + 12 minor) from the Krumhansl-Kessler model
//    (1990).  The profile with the highest Pearson correlation
//    is the detected key.
//
// 3. CAMELOT CONVERSION
//    The detected key is converted to Camelot Wheel notation:
//      A minor = 8A, C major = 8B, etc.
//    Two tracks are harmonically compatible if their Camelot
//    codes differ by ≤1 (e.g. 8A can mix with 7A, 9A, or 8B).
//
// Performance:
//    Processes a 5-minute stereo track at 44.1 kHz in ~50–100 ms.
//    Only analyses the middle 60 seconds (where the main section
//    usually lives) to avoid intros/outros biasing the result.
// ─────────────────────────────────────────────────────────────

import { log } from '../utils/logger';
import { isWasmReady } from '../wasm/wasmBridge';

// Wasm module — imported dynamically
let wasmModule: typeof import('../../mixi-core/pkg/mixi_core') | null = null;
import('../../mixi-core/pkg/mixi_core').then((m) => { wasmModule = m; }).catch(() => {});

// ── Types ────────────────────────────────────────────────────

export interface KeyResult {
  /** Camelot code (e.g. "8A", "11B"). */
  camelot: string;
  /** Standard notation (e.g. "Am", "B"). */
  name: string;
  /** Confidence 0–1 (correlation coefficient of the best match). */
  confidence: number;
}

// ── Note frequencies ─────────────────────────────────────────

/** Names of the 12 pitch classes. */
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Frequency of each pitch class in octave 2 (C2 = 65.41 Hz).
 * Higher octaves = frequency × 2^octave.
 */
const C2_FREQ = 65.406;

function pitchFreq(pitchClass: number, octave: number): number {
  return C2_FREQ * Math.pow(2, pitchClass / 12 + octave);
}

// ── Goertzel algorithm ───────────────────────────────────────

/**
 * Compute the energy at a single frequency using the Goertzel
 * algorithm.  This is a targeted DFT bin — O(N) time, O(1) space.
 *
 *   coeff = 2 * cos(2π * targetFreq / sampleRate)
 *
 *   Iterate through all samples:
 *     s[n] = sample[n] + coeff * s[n-1] - s[n-2]
 *
 *   Energy = s1² + s2² - coeff * s1 * s2
 */
function goertzelEnergy(
  samples: Float32Array,
  start: number,
  end: number,
  targetFreq: number,
  sampleRate: number,
): number {
  const k = Math.round((end - start) * targetFreq / sampleRate);
  const omega = (2 * Math.PI * k) / (end - start);
  const coeff = 2 * Math.cos(omega);

  let s1 = 0;
  let s2 = 0;

  for (let i = start; i < end; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

// ── Krumhansl-Kessler key profiles ───────────────────────────
//
// These are empirically derived "ideal" distributions of pitch
// class energy for each key.  A C major piece has most energy
// on C, E, G (the triad) with specific weights.

/** Major key profile (starting from the tonic). */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];

/** Minor key profile (starting from the tonic). */
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Rotate an array by `n` positions (circular shift).
 * rotate([1,2,3,4], 1) → [4,1,2,3]
 */
function rotate(arr: number[], n: number): number[] {
  const len = arr.length;
  const shift = ((n % len) + len) % len;
  return [...arr.slice(len - shift), ...arr.slice(0, len - shift)];
}

/** Pearson correlation coefficient between two arrays. */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  return den === 0 ? 0 : num / den;
}

// ── Camelot Wheel mapping ────────────────────────────────────
//
// The Camelot Wheel arranges keys in a circle of fifths:
//   1A = Ab minor, 1B = B major, 2A = Eb minor, 2B = F# major, ...
//
// Mapping: pitchClass (0=C) → Camelot number.

const CAMELOT_MINOR: Record<number, string> = {
  0: '5A',   // C minor
  1: '12A',  // C# minor
  2: '7A',   // D minor
  3: '2A',   // D# minor
  4: '9A',   // E minor
  5: '4A',   // F minor
  6: '11A',  // F# minor
  7: '6A',   // G minor
  8: '1A',   // G# minor
  9: '8A',   // A minor
  10: '3A',  // A# minor
  11: '10A', // B minor
};

const CAMELOT_MAJOR: Record<number, string> = {
  0: '8B',   // C major
  1: '3B',   // C# major
  2: '10B',  // D major
  3: '5B',   // D# major
  4: '12B',  // E major
  5: '7B',   // F major
  6: '2B',   // F# major
  7: '9B',   // G major
  8: '4B',   // G# major
  9: '11B',  // A major
  10: '6B',  // A# major
  11: '1B',  // B major
};

// ── Public API ───────────────────────────────────────────────

/**
 * Detect the musical key of an AudioBuffer.
 *
 * Analyses the middle 60 seconds of the track (or the full
 * track if shorter) to focus on the main section.
 */
export function detectKey(buffer: AudioBuffer): KeyResult {
  const t0 = performance.now();
  const { sampleRate } = buffer;

  // ── Rust fast path ──────────────────────────────────────
  if (isWasmReady() && wasmModule) {
    const numCh = buffer.numberOfChannels;
    const spc = buffer.length;
    let flat: Float32Array;
    if (numCh === 1) {
      flat = buffer.getChannelData(0);
    } else {
      flat = new Float32Array(spc * numCh);
      for (let ch = 0; ch < numCh; ch++) {
        flat.set(buffer.getChannelData(ch), ch * spc);
      }
    }
    const resultStr = wasmModule.detect_key(flat, numCh, spc, sampleRate);
    const [camelot, name, confStr] = resultStr.split('|');
    const confidence = parseFloat(confStr) || 0;

    const elapsed = (performance.now() - t0).toFixed(0);
    log.success(
      'KeyDetector',
      `[Rust] Detected key: ${name} (${camelot}) — confidence ${(confidence * 100).toFixed(0)}% — ${elapsed} ms`,
    );
    return { camelot, name, confidence };
  }

  // ── JS fallback ─────────────────────────────────────────

  // ── Mix to mono ────────────────────────────────────────────
  const ch0 = buffer.getChannelData(0);
  let mono: Float32Array;
  if (buffer.numberOfChannels > 1) {
    const ch1 = buffer.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
  } else {
    mono = ch0;
  }

  // ── Select analysis window (middle 60 seconds) ─────────────
  const totalSamples = mono.length;
  const windowSamples = Math.min(sampleRate * 60, totalSamples);
  const startSample = Math.floor((totalSamples - windowSamples) / 2);
  const endSample = startSample + windowSamples;

  // ── Build chromagram ───────────────────────────────────────
  //
  // For each pitch class, sum Goertzel energy across 4 octaves
  // (octave 0–3, i.e. C2–B5 = 65 Hz – 1976 Hz).

  const chroma = new Array<number>(12).fill(0);
  const OCTAVES = 4;

  for (let pc = 0; pc < 12; pc++) {
    for (let oct = 0; oct < OCTAVES; oct++) {
      const freq = pitchFreq(pc, oct);
      if (freq > sampleRate / 2) continue; // Nyquist limit.
      chroma[pc] += goertzelEnergy(mono, startSample, endSample, freq, sampleRate);
    }
  }

  // ── Normalise chromagram ───────────────────────────────────
  const maxChroma = Math.max(...chroma);
  if (maxChroma > 0) {
    for (let i = 0; i < 12; i++) chroma[i] /= maxChroma;
  }

  // ── Correlate with all 24 key profiles ─────────────────────
  let bestKey = 0;
  let bestCorr = -Infinity;
  let bestIsMinor = false;

  for (let root = 0; root < 12; root++) {
    // Major: rotate the major profile so `root` is index 0.
    const majorProfile = rotate(MAJOR_PROFILE, root);
    const corrMajor = pearsonCorrelation(chroma, majorProfile);
    if (corrMajor > bestCorr) {
      bestCorr = corrMajor;
      bestKey = root;
      bestIsMinor = false;
    }

    // Minor.
    const minorProfile = rotate(MINOR_PROFILE, root);
    const corrMinor = pearsonCorrelation(chroma, minorProfile);
    if (corrMinor > bestCorr) {
      bestCorr = corrMinor;
      bestKey = root;
      bestIsMinor = true;
    }
  }

  const camelot = bestIsMinor
    ? CAMELOT_MINOR[bestKey]
    : CAMELOT_MAJOR[bestKey];

  const name = PITCH_NAMES[bestKey] + (bestIsMinor ? 'm' : '');
  const confidence = Math.max(0, Math.min(1, (bestCorr + 1) / 2));

  const elapsed = (performance.now() - t0).toFixed(0);
  log.success(
    'KeyDetector',
    `Detected key: ${name} (${camelot}) — confidence ${(confidence * 100).toFixed(0)}% — ${elapsed} ms`,
  );

  return { camelot, name, confidence };
}

/**
 * Check if two Camelot codes are harmonically compatible.
 *
 * Compatible means: same number (e.g. 8A↔8B), or ±1 on the
 * same letter (e.g. 8A↔7A, 8A↔9A).
 *
 * This implements the "one-step" rule on the Camelot Wheel.
 */
export function isHarmonicMatch(camelotA: string, camelotB: string): boolean {
  if (!camelotA || !camelotB) return false;

  const numA = parseInt(camelotA);
  const numB = parseInt(camelotB);
  const letterA = camelotA.slice(-1);
  const letterB = camelotB.slice(-1);

  if (isNaN(numA) || isNaN(numB)) return false;

  // Same number, any letter → compatible (relative major/minor).
  if (numA === numB) return true;

  // Same letter, ±1 step (wrapping 12↔1).
  if (letterA === letterB) {
    const diff = Math.abs(numA - numB);
    return diff === 1 || diff === 11;
  }

  return false;
}
