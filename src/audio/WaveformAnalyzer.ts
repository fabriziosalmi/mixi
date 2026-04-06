/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Offline Waveform Analyzer (RGB Multi-Band + BPM)
//
// Generates a Rekordbox-style 3-band energy profile AND detects
// the BPM / beatgrid from a decoded AudioBuffer.
//
// Pipeline (all offline, non-blocking):
//
//   1.  Three OfflineAudioContexts run in parallel, each with
//       a BiquadFilter isolating one frequency band:
//         LOW  → lowpass   250 Hz   (kick, bass)
//         MID  → bandpass  250–4 kHz (vocals, synths, snares)
//         HIGH → highpass  4 kHz    (hi-hats, cymbals, air)
//
//   2.  Each rendered buffer is sliced into windows and RMS
//       energy is computed per window (100 points per second).
//
//   3.  The LOW band buffer is also fed to the BPM detector
//       which runs peak detection + IOI histogram analysis.
//
//   4.  Output: waveform data + BPM + grid offset.
// ─────────────────────────────────────────────────────────────

import { log } from '../utils/logger';
import { detectBpm, type BpmResult } from './BpmDetector';
import { useSettingsStore, BPM_RANGE_PRESETS } from '../store/settingsStore';
import { detectDrops, type DropMarker } from './DropDetector';
import { detectKey, type KeyResult } from './KeyDetector';
import { isWasmReady } from '../wasm/wasmBridge';

// Wasm functions — imported dynamically at analysis time
let wasmModule: typeof import('../../mixi-core/pkg/mixi_core') | null = null;
import('../../mixi-core/pkg/mixi_core').then((m) => { wasmModule = m; }).catch(() => {});

// ── Types ────────────────────────────────────────────────────

/** One data point per "pixel column" of the waveform. */
export interface WaveformPoint {
  low: number;   // 0–1, energy in the bass band
  mid: number;   // 0–1, energy in the mid band
  high: number;  // 0–1, energy in the high band
}

/** Complete analysis result returned by analyzeWaveform(). */
export interface AnalysisResult {
  waveform: WaveformPoint[];
  bpm: number;
  firstBeatOffset: number;
  bpmConfidence: number;
  /** Beat numbers where drops occur, sorted by strength. */
  dropBeats: number[];
  /** Musical key in Camelot notation (e.g. "8A"). */
  musicalKey: string;
  /** Standard key name (e.g. "Am"). */
  musicalKeyName: string;
  /**
   * Peak sample level (0–1) of the original audio.
   * Used for auto-gain: trimGain = 1 / peakLevel
   * so all tracks play at the same perceived loudness.
   */
  peakLevel: number;
}

// ── Constants ────────────────────────────────────────────────

/** Waveform resolution: data points per second of audio. */
const POINTS_PER_SECOND = 100;

/** Filter crossover frequencies (Hz). */
const LOW_CUTOFF = 250;
const HIGH_CUTOFF = 4_000;

// ── Offline rendering helpers ────────────────────────────────

/**
 * Render an AudioBuffer through a BiquadFilter offline and
 * return the filtered output buffer.
 */
async function renderBand(
  source: AudioBuffer,
  filterType: BiquadFilterType,
  frequency: number,
  Q: number,
): Promise<AudioBuffer> {
  const { numberOfChannels, length, sampleRate } = source;
  const offCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

  const bufferSrc = offCtx.createBufferSource();
  bufferSrc.buffer = source;

  const filter = offCtx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = Q;

  bufferSrc.connect(filter).connect(offCtx.destination);
  bufferSrc.start(0);

  return offCtx.startRendering();
}

/**
 * Compute RMS energy for fixed-size windows across all channels.
 * Uses Rust/Wasm when available for 5–10× speedup.
 */
function computeRms(buffer: AudioBuffer, chunkSize: number): Float32Array {
  const channels = buffer.numberOfChannels;
  const spc = buffer.length; // samples per channel

  // ── Rust fast path ──────────────────────────────────────
  if (isWasmReady() && wasmModule) {
    if (channels === 1) {
      const data = buffer.getChannelData(0);
      const result = wasmModule.compute_rms(data, chunkSize);
      return new Float32Array(result);
    }
    // Multi-channel: concatenate into flat array for Wasm
    const flat = new Float32Array(spc * channels);
    for (let ch = 0; ch < channels; ch++) {
      flat.set(buffer.getChannelData(ch), ch * spc);
    }
    const result = wasmModule.compute_rms_multichannel(flat, channels, spc, chunkSize);
    return new Float32Array(result);
  }

  // ── JS fallback ─────────────────────────────────────────
  const numChunks = Math.ceil(spc / chunkSize);
  const rms = new Float32Array(numChunks);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, spc);
    let sumSq = 0;

    for (let ch = 0; ch < channels; ch++) {
      const data = channelData[ch];
      for (let s = start; s < end; s++) {
        const sample = data[s];
        sumSq += sample * sample;
      }
    }

    const count = (end - start) * channels;
    rms[i] = Math.sqrt(sumSq / count);
  }

  return rms;
}

/** Normalise a Float32Array in-place so peak = 1.0. Uses Wasm when available. */
function normalise(arr: Float32Array): number {
  if (isWasmReady() && wasmModule) {
    return wasmModule.normalise(arr);
  }
  // JS fallback
  let peak = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > peak) peak = arr[i];
  }
  if (peak > 0) {
    const inv = 1 / peak;
    for (let i = 0; i < arr.length; i++) {
      arr[i] *= inv;
    }
  }
  return peak;
}

// ── Safe mode for long files ────────────────────────────────

const SAFE_MODE_THRESHOLD = 600;          // 10 minutes
const SAFE_MODE_ANALYSIS_SECONDS = 180;   // analyse first 3 min for BPM/key

/** Slice an AudioBuffer to the first N seconds. */
function sliceBuffer(buf: AudioBuffer, maxSeconds: number): AudioBuffer {
  const maxSamples = Math.min(buf.length, Math.floor(maxSeconds * buf.sampleRate));
  const OfflineCtx = globalThis.OfflineAudioContext || (globalThis as unknown as Record<string, unknown>).webkitOfflineAudioContext as typeof OfflineAudioContext;
  const sliced = new OfflineCtx(
    buf.numberOfChannels, maxSamples, buf.sampleRate,
  ).createBuffer(buf.numberOfChannels, maxSamples, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    sliced.copyToChannel(buf.getChannelData(ch).subarray(0, maxSamples), ch);
  }
  return sliced;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Analyse an AudioBuffer: extract RGB waveform data AND detect
 * the BPM / beatgrid offset.
 *
 * @param buffer  – Decoded AudioBuffer from MixiEngine.loadTrack.
 * @returns       – { waveform, bpm, firstBeatOffset, bpmConfidence }
 */
export async function analyzeWaveform(
  buffer: AudioBuffer,
): Promise<AnalysisResult> {
  const t0 = performance.now();

  const chunkSize = Math.floor(buffer.sampleRate / POINTS_PER_SECOND);

  // ── Peak level detection + band rendering in parallel ──────
  let peakLevelPromise: Promise<number>;
  if (isWasmReady() && wasmModule) {
    // Rust fast path: scan all channels in one call
    const flat = new Float32Array(buffer.length * buffer.numberOfChannels);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      flat.set(buffer.getChannelData(ch), ch * buffer.length);
    }
    const peak = wasmModule.peak_level(flat, buffer.numberOfChannels, buffer.length);
    peakLevelPromise = Promise.resolve(peak);
  } else {
    // JS fallback (deferred to avoid blocking before Promise.all)
    peakLevelPromise = new Promise<number>((resolve) => {
      setTimeout(() => {
        let peak = 0;
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const data = buffer.getChannelData(ch);
          for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
          }
        }
        resolve(peak || 1);
      }, 0);
    });
  }

  // Run all 3 band filters + peak scan in parallel.
  const [lowBuf, midBuf, highBuf, peakLevel] = await Promise.all([
    renderBand(buffer, 'lowpass', LOW_CUTOFF, 1),
    renderBand(buffer, 'bandpass', Math.sqrt(LOW_CUTOFF * HIGH_CUTOFF), 0.8),
    renderBand(buffer, 'highpass', HIGH_CUTOFF, 1),
    peakLevelPromise,
  ]);

  // ── BPM detection (runs on the low-band buffer) ────────────
  // Safe mode: limit BPM/key analysis to first 3 min for long files
  const isLongFile = buffer.duration > SAFE_MODE_THRESHOLD;
  if (isLongFile) {
    log.warn('Analyzer', `Long file (${(buffer.duration / 60).toFixed(0)} min) — BPM/key from first ${SAFE_MODE_ANALYSIS_SECONDS}s`);
  }
  const bpmSource = isLongFile ? sliceBuffer(lowBuf, SAFE_MODE_ANALYSIS_SECONDS) : lowBuf;
  const keySource = isLongFile ? sliceBuffer(buffer, SAFE_MODE_ANALYSIS_SECONDS) : buffer;

  const bpmPreset = BPM_RANGE_PRESETS[useSettingsStore.getState().bpmRange];
  const bpmResult: BpmResult = detectBpm(bpmSource, { bpmMin: bpmPreset.min, bpmMax: bpmPreset.max });

  // Yield to main thread between heavy sync operations to avoid
  // 500ms+ continuous main-thread block (detectBpm + detectKey + 3x computeRms).
  await new Promise<void>((r) => setTimeout(r, 0));

  // ── Key detection (runs on the original or sliced buffer) ──
  const keyResult: KeyResult = detectKey(keySource);

  await new Promise<void>((r) => setTimeout(r, 0));

  // ── RMS waveform ───────────────────────────────────────────
  const lowRms = computeRms(lowBuf, chunkSize);
  const midRms = computeRms(midBuf, chunkSize);
  const highRms = computeRms(highBuf, chunkSize);

  normalise(lowRms);
  normalise(midRms);
  normalise(highRms);

  const numPoints = lowRms.length;
  const waveform: WaveformPoint[] = new Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    waveform[i] = {
      low: lowRms[i],
      mid: midRms[i],
      high: highRms[i],
    };
  }

  // ── Drop detection (runs on the waveform + BPM data) ───────
  const drops: DropMarker[] = detectDrops(
    waveform,
    bpmResult.bpm,
    bpmResult.firstBeatOffset,
    buffer.duration,
  );

  const elapsed = (performance.now() - t0).toFixed(0);
  log.success(
    'Analyzer',
    `Full analysis done in ${elapsed} ms — ${numPoints} points, ` +
    `${bpmResult.bpm} BPM, key ${keyResult.camelot} (${keyResult.name}), ` +
    `${drops.length} drops (${buffer.duration.toFixed(1)}s @ ${buffer.sampleRate} Hz)`,
  );

  return {
    waveform,
    bpm: bpmResult.bpm,
    firstBeatOffset: bpmResult.firstBeatOffset,
    bpmConfidence: bpmResult.confidence,
    dropBeats: drops.map((d) => d.beat),
    musicalKey: keyResult.camelot,
    musicalKeyName: keyResult.name,
    peakLevel,
  };
}

export { POINTS_PER_SECOND };
