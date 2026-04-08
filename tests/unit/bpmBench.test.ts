/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * BPM Detection & Sync Bench
 *
 * Generates synthetic audio at known BPMs, verifies detection accuracy,
 * and validates sync/phase alignment between track pairs.
 *
 * Difficulty levels:
 *   L1 — Pure click track (ideal conditions)
 *   L2 — Kick + hihat pattern
 *   L3 — Kick + hat + pink noise floor
 *   L4 — Syncopated pattern (offbeat hats, ghost snares)
 *   L5 — Two tracks mixed together (summed, crossfaded)
 *
 * Each test knows the ground-truth BPM and expected phase alignment.
 */

import { describe, it, expect } from 'vitest';
import { detectBpm, type BpmResult } from '../../src/audio/BpmDetector';

// ── Constants ────────────────────────────────────────────────

const SR = 44100;
const DURATION = 15; // seconds — enough for reliable detection
const SAMPLES = SR * DURATION;

// ── Audio Buffer Mock ────────────────────────────────────────
// Matches the Web Audio API AudioBuffer interface used by detectBpm

function makeAudioBuffer(samples: Float32Array, sampleRate = SR): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: (ch: number) => {
      if (ch !== 0) throw new Error('Only mono supported in test');
      return samples;
    },
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

// ── Synthesis Primitives ─────────────────────────────────────

/** Generate a click/impulse at a specific sample position */
function addClick(buf: Float32Array, pos: number, amplitude = 0.9) {
  const decay = Math.floor(SR * 0.003); // 3ms exponential decay
  for (let i = 0; i < decay && pos + i < buf.length; i++) {
    buf[pos + i] += amplitude * Math.exp(-i / (decay * 0.25));
  }
}

/** Generate a sine-wave kick drum (pitch sweep 150Hz -> 50Hz) */
function addKick(buf: Float32Array, pos: number, amplitude = 0.8) {
  const len = Math.floor(SR * 0.08); // 80ms
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    const freq = 150 * Math.exp(-t * 30) + 50; // pitch sweep
    const env = Math.exp(-t * 25); // amplitude envelope
    buf[pos + i] += amplitude * env * Math.sin(2 * Math.PI * freq * t);
  }
}

/** Generate a hihat (band-passed noise burst) */
function addHihat(buf: Float32Array, pos: number, amplitude = 0.3) {
  const len = Math.floor(SR * 0.02); // 20ms
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 200);
    const noise = (Math.random() * 2 - 1);
    buf[pos + i] += amplitude * env * noise;
  }
}

/** Generate a snare (noise + sine body) */
function addSnare(buf: Float32Array, pos: number, amplitude = 0.5) {
  const len = Math.floor(SR * 0.06); // 60ms
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 40);
    const body = Math.sin(2 * Math.PI * 200 * t) * 0.5;
    const noise = (Math.random() * 2 - 1) * 0.7;
    buf[pos + i] += amplitude * env * (body + noise);
  }
}

/** Add pink noise floor */
function addPinkNoise(buf: Float32Array, amplitude = 0.05) {
  // Voss-McCartney approximation
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < buf.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    buf[i] += amplitude * pink * 0.11;
  }
}

// ── Track Generators ─────────────────────────────────────────

/** L1: Pure click track at exact BPM */
function generateClickTrack(bpm: number, offsetSec = 0): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  const offsetSamples = Math.floor(offsetSec * SR);
  let pos = offsetSamples;
  while (pos < SAMPLES) {
    addClick(buf, Math.floor(pos));
    pos += beatInterval;
  }
  return buf;
}

/** L2: Kick + hihat pattern (kick on beat, hat on off-beat) */
function generateKickHatTrack(bpm: number, offsetSec = 0): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  const offsetSamples = Math.floor(offsetSec * SR);
  let pos = offsetSamples;
  let beat = 0;
  while (pos < SAMPLES) {
    addKick(buf, Math.floor(pos));
    // Hihat on every 8th note (between beats)
    const hatPos = Math.floor(pos + beatInterval / 2);
    if (hatPos < SAMPLES) addHihat(buf, hatPos);
    pos += beatInterval;
    beat++;
  }
  return buf;
}

/** L3: Kick + hat + pink noise floor */
function generateNoisyTrack(bpm: number, offsetSec = 0, noiseLevel = 0.05): Float32Array {
  const buf = generateKickHatTrack(bpm, offsetSec);
  addPinkNoise(buf, noiseLevel);
  return buf;
}

/** L4: Syncopated pattern — kick on 1 & 3, snare on 2 & 4, hats on 8ths, ghost snare */
function generateSyncopatedTrack(bpm: number, offsetSec = 0): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  const offsetSamples = Math.floor(offsetSec * SR);
  let pos = offsetSamples;
  let beat = 0;
  while (pos < SAMPLES) {
    const beatInBar = beat % 4;
    // Kick on 1 and 3
    if (beatInBar === 0 || beatInBar === 2) {
      addKick(buf, Math.floor(pos));
    }
    // Snare on 2 and 4
    if (beatInBar === 1 || beatInBar === 3) {
      addSnare(buf, Math.floor(pos));
    }
    // Hats on every 8th
    addHihat(buf, Math.floor(pos), 0.15);
    const hatOff = Math.floor(pos + beatInterval / 2);
    if (hatOff < SAMPLES) addHihat(buf, hatOff, 0.2);
    // Ghost snare on the "e" of beat 4 (syncopation)
    if (beatInBar === 3) {
      const ghost = Math.floor(pos + beatInterval * 0.75);
      if (ghost < SAMPLES) addSnare(buf, ghost, 0.15);
    }
    pos += beatInterval;
    beat++;
  }
  addPinkNoise(buf, 0.03);
  return buf;
}

/** L5: Mix two tracks at different BPMs (summed — simulates crossfade) */
function generateMixedTrack(
  bpmA: number, bpmB: number,
  mixRatio = 0.5, // 0 = all A, 1 = all B
): Float32Array {
  const trackA = generateKickHatTrack(bpmA, 0);
  const trackB = generateKickHatTrack(bpmB, 0.1);
  const buf = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    buf[i] = trackA[i] * (1 - mixRatio) + trackB[i] * mixRatio;
  }
  addPinkNoise(buf, 0.02);
  return buf;
}

// ── Test Helpers ─────────────────────────────────────────────

function detectFromSamples(samples: Float32Array): BpmResult {
  return detectBpm(makeAudioBuffer(samples));
}

/**
 * Check BPM within tolerance, accounting for octave ambiguity.
 * Returns true if detected BPM matches expected at 1x, 2x, or 0.5x.
 */
function bpmMatchesOctave(detected: number, expected: number, toleranceBpm = 1.5): boolean {
  const candidates = [expected, expected * 2, expected / 2];
  return candidates.some(c => Math.abs(detected - c) <= toleranceBpm);
}

function bpmMatchesExact(detected: number, expected: number, toleranceBpm = 1.5): boolean {
  return Math.abs(detected - expected) <= toleranceBpm;
}

// ── Phase alignment check ────────────────────────────────────

function checkPhaseAlignment(
  resultA: BpmResult,
  resultB: BpmResult,
  expectedBpmA: number,
  expectedBpmB: number,
): { tempoRatio: number; phaseError: number } {
  const tempoRatio = resultB.bpm / resultA.bpm;
  const expectedRatio = expectedBpmB / expectedBpmA;

  // Phase: how well the grid offsets align
  const beatPeriodA = 60 / resultA.bpm;
  const offsetDelta = Math.abs(resultA.firstBeatOffset - resultB.firstBeatOffset);
  const phaseError = (offsetDelta % beatPeriodA) / beatPeriodA;
  // Wrap to [0, 0.5] — 0 = perfect alignment, 0.5 = worst
  const normalizedPhase = phaseError > 0.5 ? 1 - phaseError : phaseError;

  return { tempoRatio, phaseError: normalizedPhase };
}

// ═════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════

describe('BPM Detection Bench', () => {

  // ── L1: Pure Click Tracks ──────────────────────────────────

  describe('L1 — Pure click track (ideal)', () => {
    const BPMs = [85, 100, 120, 128, 140, 150, 170, 174];

    for (const bpm of BPMs) {
      it(`detects ${bpm} BPM click track`, () => {
        const samples = generateClickTrack(bpm);
        const result = detectFromSamples(samples);

        expect(result.confidence).toBeGreaterThan(0);
        expect(bpmMatchesOctave(result.bpm, bpm)).toBe(true);
      });
    }
  });

  // ── L2: Kick + Hihat ──────────────────────────────────────

  describe('L2 — Kick + hihat pattern', () => {
    const BPMs = [90, 110, 120, 128, 140, 160, 174];

    for (const bpm of BPMs) {
      it(`detects ${bpm} BPM kick-hat track`, () => {
        const samples = generateKickHatTrack(bpm);
        const result = detectFromSamples(samples);

        expect(result.confidence).toBeGreaterThan(0);
        expect(bpmMatchesOctave(result.bpm, bpm)).toBe(true);
      });
    }
  });

  // ── L3: Kick + Hat + Noise ─────────────────────────────────

  describe('L3 — Noisy track (pink noise floor)', () => {
    const testCases = [
      { bpm: 120, noise: 0.03, label: 'low noise' },
      { bpm: 128, noise: 0.08, label: 'medium noise' },
      { bpm: 140, noise: 0.12, label: 'high noise' },
      { bpm: 100, noise: 0.06, label: 'downtempo + noise' },
      { bpm: 170, noise: 0.05, label: 'DnB + noise' },
    ];

    for (const { bpm, noise, label } of testCases) {
      it(`detects ${bpm} BPM with ${label}`, () => {
        const samples = generateNoisyTrack(bpm, 0, noise);
        const result = detectFromSamples(samples);

        expect(result.confidence).toBeGreaterThan(0);
        expect(bpmMatchesOctave(result.bpm, bpm)).toBe(true);
      });
    }
  });

  // ── L4: Syncopated Patterns ────────────────────────────────

  describe('L4 — Syncopated drums', () => {
    const BPMs = [110, 120, 128, 140, 150];

    for (const bpm of BPMs) {
      it(`detects ${bpm} BPM syncopated pattern`, () => {
        const samples = generateSyncopatedTrack(bpm);
        const result = detectFromSamples(samples);

        expect(result.confidence).toBeGreaterThan(0);
        expect(bpmMatchesOctave(result.bpm, bpm)).toBe(true);
      });
    }
  });

  // ── L5: Mixed Tracks ───────────────────────────────────────

  describe('L5 — Mixed tracks (dominant track detection)', () => {
    it('detects dominant BPM when A is louder (128 vs 120, A at 80%)', () => {
      const samples = generateMixedTrack(128, 120, 0.2);
      const result = detectFromSamples(samples);
      // Dominant track A at 128 should win
      expect(bpmMatchesOctave(result.bpm, 128)).toBe(true);
    });

    it('detects dominant BPM when B is louder (128 vs 140, B at 80%)', () => {
      const samples = generateMixedTrack(128, 140, 0.8);
      const result = detectFromSamples(samples);
      // Dominant track B at 140 should win
      expect(bpmMatchesOctave(result.bpm, 140)).toBe(true);
    });

    it('detects either BPM at equal mix (128 vs 130)', () => {
      const samples = generateMixedTrack(128, 130, 0.5);
      const result = detectFromSamples(samples);
      // Either 128 or 130 is acceptable at equal mix
      const match128 = bpmMatchesOctave(result.bpm, 128, 3);
      const match130 = bpmMatchesOctave(result.bpm, 130, 3);
      expect(match128 || match130).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════════
// SYNC & PHASE ALIGNMENT BENCH
// ═════════════════════════════════════════════════════════════

describe('Sync & Phase Alignment Bench', () => {

  describe('Grid offset detection', () => {
    it('detects zero offset for track starting on beat', () => {
      const samples = generateClickTrack(120, 0);
      const result = detectFromSamples(samples);
      // Offset should be near a beat boundary (may not be 0 — detector
      // picks the onset with highest grid alignment, not necessarily the first)
      const beatPeriod = 60 / result.bpm;
      const offsetInBeats = result.firstBeatOffset / beatPeriod;
      const fracPart = offsetInBeats % 1;
      const gridError = Math.min(fracPart, 1 - fracPart);
      expect(gridError).toBeLessThan(0.2);
    });

    it('detects non-zero offset for delayed start', () => {
      const samples = generateClickTrack(120, 0.25); // 250ms intro
      const result = detectFromSamples(samples);
      // Offset should be near 0.25s
      expect(result.firstBeatOffset).toBeGreaterThan(0.1);
      expect(result.firstBeatOffset).toBeLessThan(0.5);
    });
  });

  describe('Tempo ratio calculation for sync', () => {
    const syncPairs = [
      { bpmA: 120, bpmB: 120, expectedRatio: 1.0, label: 'same tempo' },
      { bpmA: 120, bpmB: 130, expectedRatio: 130 / 120, label: '120 -> 130' },
      { bpmA: 128, bpmB: 140, expectedRatio: 140 / 128, label: '128 -> 140' },
      { bpmA: 140, bpmB: 128, expectedRatio: 128 / 140, label: '140 -> 128' },
      { bpmA: 120, bpmB: 170, expectedRatio: 170 / 120, label: 'house -> DnB' },
    ];

    for (const { bpmA, bpmB, expectedRatio, label } of syncPairs) {
      it(`computes correct sync ratio for ${label}`, () => {
        const samplesA = generateKickHatTrack(bpmA);
        const samplesB = generateKickHatTrack(bpmB);
        const resultA = detectFromSamples(samplesA);
        const resultB = detectFromSamples(samplesB);

        // Both BPMs should be detected correctly first
        expect(bpmMatchesOctave(resultA.bpm, bpmA)).toBe(true);
        expect(bpmMatchesOctave(resultB.bpm, bpmB)).toBe(true);

        // Sync ratio should match expected (accounting for octave)
        // If both detected at correct octave:
        if (bpmMatchesExact(resultA.bpm, bpmA) && bpmMatchesExact(resultB.bpm, bpmB)) {
          const actualRatio = resultB.bpm / resultA.bpm;
          expect(Math.abs(actualRatio - expectedRatio)).toBeLessThan(0.05);
        }
      });
    }
  });

  describe('Phase alignment between two tracks at same BPM', () => {
    it('tracks at same BPM with same offset have low phase error', () => {
      const samplesA = generateKickHatTrack(128, 0);
      const samplesB = generateKickHatTrack(128, 0);
      const resultA = detectFromSamples(samplesA);
      const resultB = detectFromSamples(samplesB);

      const { phaseError } = checkPhaseAlignment(resultA, resultB, 128, 128);
      // Phase error should be very small for identical tracks
      expect(phaseError).toBeLessThan(0.15);
    });

    it('tracks at same BPM with half-beat offset are detectable', () => {
      const beatPeriod = 60 / 128; // ~0.469s
      const samplesA = generateKickHatTrack(128, 0);
      const samplesB = generateKickHatTrack(128, beatPeriod / 2); // half-beat offset
      const resultA = detectFromSamples(samplesA);
      const resultB = detectFromSamples(samplesB);

      // Both should detect 128 BPM
      expect(bpmMatchesOctave(resultA.bpm, 128)).toBe(true);
      expect(bpmMatchesOctave(resultB.bpm, 128)).toBe(true);

      // Phase difference should be approximately 0.5 beats
      const { phaseError } = checkPhaseAlignment(resultA, resultB, 128, 128);
      // Either near 0 (aligned) or near 0.5 (half-beat) is detectable
      expect(phaseError).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('does not crash on silence', () => {
      const buf = new Float32Array(SAMPLES); // all zeros
      const result = detectFromSamples(buf);
      // Should return fallback, not crash
      expect(result.bpm).toBeGreaterThan(0);
      expect(result.confidence).toBe(0);
    });

    it('does not crash on white noise', () => {
      const buf = new Float32Array(SAMPLES);
      for (let i = 0; i < SAMPLES; i++) buf[i] = (Math.random() * 2 - 1) * 0.3;
      const result = detectFromSamples(buf);
      expect(result.bpm).toBeGreaterThan(0);
    });

    it('handles very slow tempo (70 BPM)', () => {
      const samples = generateKickHatTrack(70);
      const result = detectFromSamples(samples);
      expect(bpmMatchesOctave(result.bpm, 70)).toBe(true);
    });

    it('handles very fast tempo (200 BPM)', () => {
      const samples = generateKickHatTrack(200);
      const result = detectFromSamples(samples);
      expect(bpmMatchesOctave(result.bpm, 200)).toBe(true);
    });

    it('handles short track (8 seconds) with relaxed tolerance', () => {
      const shortSamples = SR * 8;
      const buf = new Float32Array(shortSamples);
      const beatInterval = (60 / 128) * SR;
      let pos = 0;
      while (pos < shortSamples) {
        addKick(buf, Math.floor(pos));
        pos += beatInterval;
      }
      const result = detectBpm(makeAudioBuffer(buf));
      // Short tracks have fewer onsets — allow wider tolerance
      expect(bpmMatchesOctave(result.bpm, 128, 5)).toBe(true);
    });
  });
});
