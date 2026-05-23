/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * Audio Loopback Regression Fuzzing Harness
 *
 * Verifies that the BPM detection, WAV stream parsing, and PLL sync loops
 * decay gracefully rather than panicking or throwing unhandled exceptions
 * when fed random, malformed, or highly corrupted signals.
 */

import { describe, it, expect } from 'vitest';
import { detectBpm } from '../../src/audio/BpmDetector';
import { AudioStreamingBuffer } from '../../src/audio/AudioStreamingBuffer';
import { createDeck, createSyncSim, computePhaseError } from '../helpers/pllSim';
import { findBestRatio } from '../../src/audio/harmonicSync';

// Mock AudioContext for AudioStreamingBuffer
const mockAudioContext = {
  createBuffer: (channels: number, length: number, sampleRate: number) => {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  },
  decodeAudioData: async (_buf: ArrayBuffer) => {
    // Return mock buffer
    return {
      numberOfChannels: 2,
      length: 1024,
      sampleRate: 44100,
      duration: 1024 / 44100,
      getChannelData: () => new Float32Array(1024),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  }
} as unknown as AudioContext;

function makeMockAudioBuffer(samples: Float32Array, sampleRate = 44100): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: (ch: number) => {
      if (ch !== 0) throw new Error('Mono only');
      return samples;
    },
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

describe('BPM Detector Fuzzing', () => {
  it('handles extremely short buffers (1 sample) without throwing', async () => {
    const samples = new Float32Array([0.5]);
    const result = await detectBpm(makeMockAudioBuffer(samples));
    expect(result.bpm).toBe(120); // Fallback BPM
    expect(result.confidence).toBe(0);
  });

  it('handles empty/zero-length buffers without throwing', async () => {
    const samples = new Float32Array(0);
    const result = await detectBpm(makeMockAudioBuffer(samples));
    expect(result.bpm).toBe(120);
    expect(result.confidence).toBe(0);
  });

  it('handles constant values (DC offset) without throwing', async () => {
    const samples = new Float32Array(1024).fill(0.8);
    const result = await detectBpm(makeMockAudioBuffer(samples));
    expect(result.bpm).toBe(120);
    expect(result.confidence).toBe(0);
  });

  it('handles NaN values in buffer safely', async () => {
    const samples = new Float32Array(4096).map((_, idx) => (idx % 10 === 0 ? NaN : Math.random() * 2 - 1));
    const result = await detectBpm(makeMockAudioBuffer(samples));
    expect(result.bpm).toBeDefined();
    expect(result.confidence).toBe(0);
  });

  it('handles Infinity values in buffer safely', async () => {
    const samples = new Float32Array(4096).map((_, idx) => (idx % 15 === 0 ? Infinity : Math.random() * 2 - 1));
    const result = await detectBpm(makeMockAudioBuffer(samples));
    expect(result.bpm).toBeDefined();
    expect(result.confidence).toBe(0);
  });

  it('handles extreme sample rates gracefully', async () => {
    const samples = new Float32Array(4096).map(() => Math.random() * 2 - 1);
    
    // Very low sample rate
    const resultLow = await detectBpm(makeMockAudioBuffer(samples, 1));
    expect(resultLow.bpm).toBe(120);

    // Very high sample rate
    const resultHigh = await detectBpm(makeMockAudioBuffer(samples, 9999999));
    expect(resultHigh.bpm).toBe(120);
  });
});

describe('AudioStreamingBuffer Malformed Input Fuzzing', () => {
  it('handles completely random headers and corrupted bytes without crashing', async () => {
    const randomBytes = new Uint8Array(100).map(() => Math.floor(Math.random() * 256));
    const streamingBuffer = new AudioStreamingBuffer(mockAudioContext, randomBytes.buffer);
    
    // Should initialize successfully (using fallback defaults or graceful fail)
    await expect(streamingBuffer.initialize()).resolves.toBeUndefined();
    expect(streamingBuffer.duration).toBeGreaterThanOrEqual(0);
  });

  it('handles tiny bytes (less than wav header size) safely', async () => {
    const tinyBytes = new Uint8Array([1, 2, 3]);
    const streamingBuffer = new AudioStreamingBuffer(mockAudioContext, tinyBytes.buffer);
    await expect(streamingBuffer.initialize()).resolves.toBeUndefined();
    expect(streamingBuffer.isWav).toBe(false);
  });
});

describe('PLL Simulator & Sync Fuzzing', () => {
  it('handles NaN/Infinity in position and BPM values safely without looping infinitely or crashing', () => {
    const deckA = createDeck(NaN, 0, 0);
    const deckB = createDeck(120, NaN, Infinity);
    deckA.isPlaying = true;
    deckB.isPlaying = true;

    const sim = createSyncSim(deckA, deckB);
    
    // Verify sync and tick don't crash
    expect(() => sim.sync()).not.toThrow();
    expect(() => sim.tick(20)).not.toThrow();
  });

  it('handles division-by-zero scenarios (BPM = 0) safely', () => {
    const deckA = createDeck(0, 0, 1.0);
    const deckB = createDeck(120, 0, 1.0);
    deckA.isPlaying = true;
    deckB.isPlaying = true;

    const error = computePhaseError(deckA, deckB);
    expect(error).toBe(0); // Should fail to compute and return safe default

    const sim = createSyncSim(deckA, deckB);
    expect(() => sim.sync()).not.toThrow();
    expect(() => sim.tick(10)).not.toThrow();
  });

  it('handles negative playhead parameters gracefully', () => {
    const deckA = createDeck(120, -5.0, -10.0);
    const deckB = createDeck(120, 0.5, 2.0);
    deckA.isPlaying = true;
    deckB.isPlaying = true;

    const sim = createSyncSim(deckA, deckB);
    expect(() => sim.sync()).not.toThrow();
    expect(() => sim.tick(50)).not.toThrow();
    expect(sim.slave.position).toBeGreaterThanOrEqual(0);
  });

  it('verifies that harmonic sync findBestRatio does not loop on extreme values', () => {
    const ratio1 = findBestRatio(Infinity, 120);
    expect(ratio1).toBe(1);

    const ratio2 = findBestRatio(120, NaN);
    expect(ratio2).toBe(1);

    const ratio3 = findBestRatio(-120, -120);
    expect(ratio3).toBe(1);
  });
});
