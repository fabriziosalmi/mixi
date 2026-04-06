/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Onset Flux Cross-Correlation
//
// Aligns the TRANSIENTS (kick click, snare attack) of two decks,
// not the raw waveform.  This is immune to:
//   - Different kick tunings (808 vs 909)
//   - Different bass shapes (sub vs mid-bass)
//   - Phase inversions in the low end
//
// Algorithm:
//   1. Compute onset flux: |delta RMS| in 10ms windows (positive only)
//   2. Cross-correlate the two flux envelopes
//   3. Parabolic interpolation for sub-sample precision
//   4. Return offset in seconds
//
// Cost: ~0.3ms per 2-beat chunk at 44.1kHz (JS).
// ─────────────────────────────────────────────────────────────

/** Hop size for onset flux computation: 10ms at any sample rate. */
const HOP_MS = 10;

/**
 * Compute onset flux envelope from a mono audio chunk.
 * Only positive deltas (onsets, not offsets) are kept.
 */
function computeOnsetFlux(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.round(sampleRate * HOP_MS / 1000);
  const numFrames = Math.floor(samples.length / hop);
  const flux = new Float32Array(numFrames);

  let prevRms = 0;
  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    const end = Math.min(start + hop, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / (end - start));
    const delta = rms - prevRms;
    flux[f] = delta > 0 ? delta : 0;  // only onsets
    prevRms = rms;
  }

  return flux;
}

/**
 * Cross-correlate two onset flux envelopes.
 * Returns the offset in seconds (positive = slave is behind master).
 *
 * @param masterChunk  – Mono audio from master deck (2 beats)
 * @param slaveChunk   – Mono audio from slave deck (2 beats)
 * @param sampleRate   – Audio sample rate
 * @param maxShiftMs   – Maximum search range in ms (default: 50ms)
 * @returns            – Offset in seconds, or null if correlation too weak
 */
export function crossCorrelatePhase(
  masterChunk: Float32Array,
  slaveChunk: Float32Array,
  sampleRate: number,
  maxShiftMs = 50,
): number | null {
  const masterFlux = computeOnsetFlux(masterChunk, sampleRate);
  const slaveFlux = computeOnsetFlux(masterChunk.length === 0 ? masterChunk : slaveChunk, sampleRate);

  if (masterFlux.length < 4 || slaveFlux.length < 4) return null;

  const hopSamples = Math.round(sampleRate * HOP_MS / 1000);
  const maxShiftFrames = Math.round(maxShiftMs / HOP_MS);
  const minLen = Math.min(masterFlux.length, slaveFlux.length);

  let bestCorr = -Infinity;
  let bestShift = 0;

  // Correlation at a given shift
  function correlateAt(shift: number): number {
    let sum = 0;
    for (let i = 0; i < minLen; i++) {
      const j = i + shift;
      if (j >= 0 && j < slaveFlux.length) {
        sum += masterFlux[i] * slaveFlux[j];
      }
    }
    return sum;
  }

  for (let shift = -maxShiftFrames; shift <= maxShiftFrames; shift++) {
    const corr = correlateAt(shift);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestShift = shift;
    }
  }

  // Reject weak correlations (noise floor)
  if (bestCorr < 1e-8) return null;

  // Parabolic interpolation for sub-frame precision
  const prev = correlateAt(bestShift - 1);
  const next = correlateAt(bestShift + 1);
  const denom = prev - 2 * bestCorr + next;
  let refined = bestShift;
  if (Math.abs(denom) > 1e-12) {
    refined = bestShift + 0.5 * (prev - next) / denom;
  }

  // Convert from flux frames to seconds
  const offsetSeconds = (refined * hopSamples) / sampleRate;

  // Reject offsets larger than maxShiftMs (likely false correlation)
  if (Math.abs(offsetSeconds * 1000) > maxShiftMs) return null;

  return offsetSeconds;
}

/**
 * Extract a mono audio chunk from a buffer at a given time.
 *
 * @param buffer   – Source AudioBuffer
 * @param startSec – Start time in seconds
 * @param durSec   – Duration in seconds
 * @returns        – Float32Array of mono samples
 */
export function extractChunk(
  buffer: AudioBuffer,
  startSec: number,
  durSec: number,
): Float32Array {
  const sr = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const numSamples = Math.min(
    Math.ceil(durSec * sr),
    buffer.length - startSample,
  );

  if (numSamples <= 0) return new Float32Array(0);

  const data = buffer.getChannelData(0);
  return data.subarray(startSample, startSample + numSamples);
}
