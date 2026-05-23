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
import { getWasm } from '../wasm/wasmBridge';
import { AudioStreamingBuffer } from './AudioStreamingBuffer';

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
  const wasmModule = getWasm();
  if (wasmModule) {
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
  const wasmModule = getWasm();
  if (wasmModule) {
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

function getWavSample(
  view: DataView,
  frameIndex: number,
  channel: number,
  numChannels: number,
  bitsPerSample: number,
  dataOffset: number
): number {
  const bytesPerSample = bitsPerSample / 8;
  const sampleIndex = frameIndex * numChannels + channel;
  const byteOffset = dataOffset + sampleIndex * bytesPerSample;
  if (byteOffset + bytesPerSample > view.byteLength) return 0;
  if (bitsPerSample === 16) {
    return view.getInt16(byteOffset, true) / 32768;
  } else if (bitsPerSample === 24) {
    const b0 = view.getUint8(byteOffset);
    const b1 = view.getUint8(byteOffset + 1);
    const b2 = view.getUint8(byteOffset + 2);
    const val = (b2 << 16) | (b1 << 8) | b0;
    const signedVal = val & 0x800000 ? val | ~0xffffff : val;
    return signedVal / 8388608;
  } else if (bitsPerSample === 32) {
    return view.getFloat32(byteOffset, true);
  }
  return 0;
}

function generateWavWaveformDirect(streamingBuffer: AudioStreamingBuffer): WaveformPoint[] {
  const view = new DataView(streamingBuffer.rawData);
  const totalFrames = Math.floor(streamingBuffer.duration * streamingBuffer.sampleRate);
  const numPoints = Math.max(1, Math.floor(streamingBuffer.duration * POINTS_PER_SECOND));
  const framesPerPoint = Math.floor(totalFrames / numPoints);
  const waveform: WaveformPoint[] = [];
  const channels = streamingBuffer.channels;
  const bitsPerSample = streamingBuffer.bitsPerSample;
  const dataOffset = streamingBuffer.dataOffset;
  for (let p = 0; p < numPoints; p++) {
    const startFrame = p * framesPerPoint;
    const endFrame = Math.min(totalFrames, startFrame + framesPerPoint);
    let sumLow = 0;
    let sumMid = 0;
    let sumHigh = 0;
    let count = 0;
    const step = Math.max(1, Math.floor((endFrame - startFrame) / 100));
    for (let f = startFrame; f < endFrame - 1; f += step) {
      let s0 = 0;
      let s1 = 0;
      for (let ch = 0; ch < channels; ch++) {
        s0 += getWavSample(view, f, ch, channels, bitsPerSample, dataOffset);
        s1 += getWavSample(view, f + 1, ch, channels, bitsPerSample, dataOffset);
      }
      s0 /= channels;
      s1 /= channels;
      const low = (s0 + s1) * 0.5;
      const high = (s0 - s1) * 0.5;
      const mid = s0 - low - high;
      sumLow += low * low;
      sumHigh += high * high;
      sumMid += mid * mid;
      count++;
    }
    if (count > 0) {
      waveform.push({
        low: Math.sqrt(sumLow / count),
        mid: Math.sqrt(sumMid / count),
        high: Math.sqrt(sumHigh / count),
      });
    } else {
      waveform.push({ low: 0, mid: 0, high: 0 });
    }
  }
  return waveform;
}

async function analyzeWaveformSegment(segment: AudioBuffer): Promise<WaveformPoint[]> {
  const [lowBuf, midBuf, highBuf] = await Promise.all([
    renderBand(segment, 'lowpass', LOW_CUTOFF, 1),
    renderBand(segment, 'bandpass', Math.sqrt(LOW_CUTOFF * HIGH_CUTOFF), 0.8),
    renderBand(segment, 'highpass', HIGH_CUTOFF, 1),
  ]);
  const chunkSize = Math.floor(segment.sampleRate / POINTS_PER_SECOND);
  const lowRms = computeRms(lowBuf, chunkSize);
  const midRms = computeRms(midBuf, chunkSize);
  const highRms = computeRms(highBuf, chunkSize);
  normalise(lowRms);
  normalise(midRms);
  normalise(highRms);
  const points: WaveformPoint[] = [];
  const len = Math.min(lowRms.length, midRms.length, highRms.length);
  for (let i = 0; i < len; i++) {
    points.push({
      low: lowRms[i],
      mid: midRms[i],
      high: highRms[i],
    });
  }
  return points;
}

async function generateDecimatedWaveform(streamingBuffer: AudioStreamingBuffer): Promise<WaveformPoint[]> {
  const duration = streamingBuffer.duration;
  const numPoints = Math.max(1, Math.floor(duration * POINTS_PER_SECOND));
  const waveform: WaveformPoint[] = Array.from({ length: numPoints }, () => ({ low: 0, mid: 0, high: 0 }));
  const sampleDuration = 0.5;
  const sampleInterval = 15;
  const promises: Promise<void>[] = [];
  for (let t = 0; t < duration; t += sampleInterval) {
    const startSec = t;
    const pStart = Math.floor(startSec * POINTS_PER_SECOND);
    promises.push((async () => {
      try {
        const segment = await streamingBuffer.decodeSegment(startSec, sampleDuration);
        const segmentAnalysis = await analyzeWaveformSegment(segment);
        for (let i = 0; i < segmentAnalysis.length; i++) {
          const targetIdx = pStart + i;
          if (targetIdx < numPoints) {
            waveform[targetIdx] = segmentAnalysis[i];
          }
        }
      } catch {
        // ignore
      }
    })());
  }
  await Promise.all(promises);
  let lastVal: WaveformPoint = { low: 0.05, mid: 0.05, high: 0.05 };
  for (let i = 0; i < numPoints; i++) {
    if (waveform[i].low === 0 && waveform[i].mid === 0 && waveform[i].high === 0) {
      waveform[i] = { ...lastVal };
    } else {
      lastVal = waveform[i];
    }
  }
  return waveform;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Analyse an AudioBuffer or AudioStreamingBuffer: extract RGB waveform data
 * AND detect the BPM / beatgrid offset.
 *
 * @param buffer  – Decoded AudioBuffer or AudioStreamingBuffer.
 * @returns       – { waveform, bpm, firstBeatOffset, bpmConfidence }
 */
export async function analyzeWaveform(
  buffer: AudioBuffer | AudioStreamingBuffer,
): Promise<AnalysisResult> {
  const t0 = performance.now();

  let targetBuffer: AudioBuffer;
  let fullWaveform: WaveformPoint[] | null = null;
  let totalDuration: number;
  let sampleRate: number;

  if (buffer instanceof AudioStreamingBuffer) {
    totalDuration = buffer.duration;
    sampleRate = buffer.sampleRate;
    const analysisDuration = Math.min(buffer.duration, 180);
    targetBuffer = await buffer.decodeSegment(0, analysisDuration);

    if (buffer.isWav) {
      fullWaveform = generateWavWaveformDirect(buffer);
    } else {
      fullWaveform = await generateDecimatedWaveform(buffer);
    }
  } else {
    targetBuffer = buffer;
    totalDuration = buffer.duration;
    sampleRate = buffer.sampleRate;
  }

  const chunkSize = Math.floor(sampleRate / POINTS_PER_SECOND);

  // ── Peak level detection + band rendering in parallel ──────
  let peakLevelPromise: Promise<number>;
  const wasmModule = getWasm();
  if (wasmModule) {
    const flat = new Float32Array(targetBuffer.length * targetBuffer.numberOfChannels);
    for (let ch = 0; ch < targetBuffer.numberOfChannels; ch++) {
      flat.set(targetBuffer.getChannelData(ch), ch * targetBuffer.length);
    }
    const peak = wasmModule.peak_level(flat, targetBuffer.numberOfChannels, targetBuffer.length);
    peakLevelPromise = Promise.resolve(peak);
  } else {
    peakLevelPromise = new Promise<number>((resolve) => {
      setTimeout(() => {
        let peak = 0;
        for (let ch = 0; ch < targetBuffer.numberOfChannels; ch++) {
          const data = targetBuffer.getChannelData(ch);
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
    renderBand(targetBuffer, 'lowpass', LOW_CUTOFF, 1),
    renderBand(targetBuffer, 'bandpass', Math.sqrt(LOW_CUTOFF * HIGH_CUTOFF), 0.8),
    renderBand(targetBuffer, 'highpass', HIGH_CUTOFF, 1),
    peakLevelPromise,
  ]);

  // ── BPM detection (runs on the low-band buffer) ────────────
  // Safe mode: limit BPM/key analysis to first 3 min for long files
  const isLongFile = totalDuration > SAFE_MODE_THRESHOLD;
  if (isLongFile && !(buffer instanceof AudioStreamingBuffer)) {
    log.warn(
      'Analyzer',
      `Long file (${(totalDuration / 60).toFixed(
        0
      )} min) — BPM/key from first ${SAFE_MODE_ANALYSIS_SECONDS}s`
    );
  }

  const bpmSource = (isLongFile && !(buffer instanceof AudioStreamingBuffer))
    ? sliceBuffer(lowBuf, SAFE_MODE_ANALYSIS_SECONDS)
    : lowBuf;
  const keySource = (isLongFile && !(buffer instanceof AudioStreamingBuffer))
    ? sliceBuffer(targetBuffer, SAFE_MODE_ANALYSIS_SECONDS)
    : targetBuffer;

  const bpmPreset = BPM_RANGE_PRESETS[useSettingsStore.getState().bpmRange];
  const bpmResult: BpmResult = detectBpm(bpmSource, {
    bpmMin: bpmPreset.min,
    bpmMax: bpmPreset.max,
  });

  await new Promise<void>((r) => setTimeout(r, 0));

  // ── Key detection ──
  const keyResult: KeyResult = detectKey(keySource);

  await new Promise<void>((r) => setTimeout(r, 0));

  // ── RMS waveform ──
  const lowRms = computeRms(lowBuf, chunkSize);
  const midRms = computeRms(midBuf, chunkSize);
  const highRms = computeRms(highBuf, chunkSize);

  normalise(lowRms);
  normalise(midRms);
  normalise(highRms);

  const numPoints = lowRms.length;
  let waveform: WaveformPoint[];

  if (fullWaveform) {
    waveform = fullWaveform;
  } else {
    waveform = new Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      waveform[i] = {
        low: lowRms[i],
        mid: midRms[i],
        high: highRms[i],
      };
    }
  }

  // ── Drop detection ──
  const drops: DropMarker[] = detectDrops(
    waveform,
    bpmResult.bpm,
    bpmResult.firstBeatOffset,
    totalDuration
  );

  const elapsed = (performance.now() - t0).toFixed(0);
  log.success(
    'Analyzer',
    `Full analysis done in ${elapsed} ms — ${waveform.length} points, ` +
      `${bpmResult.bpm} BPM, key ${keyResult.camelot} (${keyResult.name}), ` +
      `${drops.length} drops (${totalDuration.toFixed(1)}s @ ${sampleRate} Hz)`
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
