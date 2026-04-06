import { describe, it, expect } from 'vitest';
import { detectPhaseCancellation, extractLowFreq } from '../../src/audio/phaseCancellation';

describe('Phase Cancellation Defense', () => {
  // ── detectPhaseCancellation ───────────────────────────────

  describe('detectPhaseCancellation', () => {
    it('detects cancellation when signals are perfectly inverted', () => {
      const len = 512;
      const master = new Float32Array(len);
      const slave = new Float32Array(len);

      // 50Hz sine wave, inverted in slave
      for (let i = 0; i < len; i++) {
        master[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / 44100);
        slave[i] = -master[i]; // perfect inversion
      }

      expect(detectPhaseCancellation(master, slave)).toBe(true);
    });

    it('does NOT detect cancellation when signals are in phase', () => {
      const len = 512;
      const master = new Float32Array(len);
      const slave = new Float32Array(len);

      for (let i = 0; i < len; i++) {
        master[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / 44100);
        slave[i] = master[i]; // identical = constructive
      }

      expect(detectPhaseCancellation(master, slave)).toBe(false);
    });

    it('does NOT detect cancellation for uncorrelated signals', () => {
      const len = 512;
      const master = new Float32Array(len);
      const slave = new Float32Array(len);

      // Two different frequencies → uncorrelated
      for (let i = 0; i < len; i++) {
        master[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / 44100);
        slave[i] = 0.5 * Math.sin(2 * Math.PI * 73 * i / 44100);
      }

      expect(detectPhaseCancellation(master, slave)).toBe(false);
    });

    it('returns false when one signal is silent', () => {
      const len = 512;
      const master = new Float32Array(len);
      const slave = new Float32Array(len); // all zeros

      for (let i = 0; i < len; i++) {
        master[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / 44100);
      }

      expect(detectPhaseCancellation(master, slave)).toBe(false);
    });

    it('returns false when both signals are silent', () => {
      const master = new Float32Array(512);
      const slave = new Float32Array(512);
      expect(detectPhaseCancellation(master, slave)).toBe(false);
    });

    it('returns false for very short buffers (< 64 samples)', () => {
      const master = new Float32Array(32).fill(0.5);
      const slave = new Float32Array(32).fill(-0.5);
      expect(detectPhaseCancellation(master, slave)).toBe(false);
    });

    it('handles mismatched buffer lengths (uses shorter)', () => {
      const len1 = 256;
      const len2 = 512;
      const master = new Float32Array(len1);
      const slave = new Float32Array(len2);

      for (let i = 0; i < len2; i++) {
        const s = 0.5 * Math.sin(2 * Math.PI * 50 * i / 44100);
        if (i < len1) master[i] = s;
        slave[i] = -s;
      }

      // Should still detect cancellation in the overlapping region
      expect(detectPhaseCancellation(master, slave)).toBe(true);
    });

    it('detects partial cancellation (90° phase shift)', () => {
      const len = 2048;
      const master = new Float32Array(len);
      const slave = new Float32Array(len);

      // 90° phase shift → partial cancellation (RMS sum = sqrt(2) * individual,
      // expected = same → ratio ~ 1.0, so NO cancellation)
      for (let i = 0; i < len; i++) {
        master[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / 44100);
        slave[i] = 0.5 * Math.cos(2 * Math.PI * 50 * i / 44100);
      }

      // 90° offset: sum RMS ≈ expected → no cancellation
      expect(detectPhaseCancellation(master, slave)).toBe(false);
    });
  });

  // ── extractLowFreq ───────────────────────────────────────

  describe('extractLowFreq', () => {
    it('preserves DC / low frequency content', () => {
      const len = 4410; // 100ms at 44100Hz
      const samples = new Float32Array(len).fill(0.5); // DC signal
      const filtered = extractLowFreq(samples, 44100);

      // DC should pass through (after settling)
      expect(filtered.length).toBe(len);
      // Middle of buffer should be close to 0.5
      const mid = Math.floor(len / 2);
      expect(filtered[mid]).toBeCloseTo(0.5, 1);
    });

    it('attenuates high frequency content', () => {
      const sr = 44100;
      const len = 4410;
      const samples = new Float32Array(len);

      // 5kHz signal — way above 100Hz cutoff
      for (let i = 0; i < len; i++) {
        samples[i] = Math.sin(2 * Math.PI * 5000 * i / sr);
      }

      const filtered = extractLowFreq(samples, sr);

      // RMS of filtered should be much lower than input
      let rmsIn = 0, rmsOut = 0;
      const start = Math.floor(len * 0.3); // skip transient
      for (let i = start; i < len; i++) {
        rmsIn += samples[i] * samples[i];
        rmsOut += filtered[i] * filtered[i];
      }
      rmsIn = Math.sqrt(rmsIn / (len - start));
      rmsOut = Math.sqrt(rmsOut / (len - start));

      // High freq should be attenuated by at least 10x
      expect(rmsOut).toBeLessThan(rmsIn * 0.1);
    });

    it('returns array of same length as input', () => {
      const samples = new Float32Array(1000);
      const filtered = extractLowFreq(samples, 44100);
      expect(filtered.length).toBe(1000);
    });
  });
});
