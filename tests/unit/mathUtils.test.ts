import { describe, it, expect } from 'vitest';
import { dbToGain, crossfaderGains, logFrequency, clamp } from '../../src/audio/utils/mathUtils';

describe('mathUtils', () => {
  // ── dbToGain ──────────────────────────────────────────────

  describe('dbToGain', () => {
    it('0 dB = unity gain (1.0)', () => {
      expect(dbToGain(0)).toBe(1);
    });

    it('-6 dB ≈ 0.5 (half amplitude)', () => {
      expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
    });

    it('+6 dB ≈ 2.0 (double amplitude)', () => {
      expect(dbToGain(6)).toBeCloseTo(1.9953, 3);
    });

    it('-40 dB ≈ 0.01 (near-silent)', () => {
      expect(dbToGain(-40)).toBeCloseTo(0.01, 3);
    });

    it('-∞ dB approaches 0', () => {
      expect(dbToGain(-96)).toBeCloseTo(0, 4);
    });
  });

  // ── crossfaderGains ───────────────────────────────────────

  describe('crossfaderGains (smooth)', () => {
    it('x=0 → A=1, B=0 (Deck A only)', () => {
      const { gainA, gainB } = crossfaderGains(0, 'smooth');
      expect(gainA).toBeCloseTo(1, 4);
      expect(gainB).toBeCloseTo(0, 4);
    });

    it('x=1 → A=0, B=1 (Deck B only)', () => {
      const { gainA, gainB } = crossfaderGains(1, 'smooth');
      expect(gainA).toBeCloseTo(0, 4);
      expect(gainB).toBeCloseTo(1, 4);
    });

    it('x=0.5 → equal power (both ≈ 0.707)', () => {
      const { gainA, gainB } = crossfaderGains(0.5, 'smooth');
      expect(gainA).toBeCloseTo(0.707, 2);
      expect(gainB).toBeCloseTo(0.707, 2);
    });

    it('constant power sum at mid-point', () => {
      const { gainA, gainB } = crossfaderGains(0.5, 'smooth');
      // Power sum should be ~1.0 for equal-power crossfade
      expect(gainA * gainA + gainB * gainB).toBeCloseTo(1, 2);
    });
  });

  describe('crossfaderGains (sharp)', () => {
    it('x=0 → A=1, B=0', () => {
      const { gainA, gainB } = crossfaderGains(0, 'sharp');
      expect(gainA).toBe(1);
      expect(gainB).toBe(0);
    });

    it('x=1 → A=0, B=1', () => {
      const { gainA, gainB } = crossfaderGains(1, 'sharp');
      expect(gainA).toBe(0);
      expect(gainB).toBe(1);
    });

    it('dead zone: x=0.01 → A still at full', () => {
      const { gainA } = crossfaderGains(0.01, 'sharp');
      expect(gainA).toBe(1);
    });

    it('dead zone: x=0.99 → B at full', () => {
      const { gainB } = crossfaderGains(0.99, 'sharp');
      expect(gainB).toBe(1);
    });
  });

  // ── logFrequency ──────────────────────────────────────────

  describe('logFrequency', () => {
    it('t=0 → 20 Hz', () => {
      expect(logFrequency(0)).toBe(20);
    });

    it('t=1 → 20000 Hz', () => {
      expect(logFrequency(1)).toBeCloseTo(20000, 0);
    });

    it('t=0.5 → geometric mean ≈ 632 Hz', () => {
      expect(logFrequency(0.5)).toBeCloseTo(632, 0);
    });

    it('monotonically increasing', () => {
      let prev = 0;
      for (let t = 0; t <= 1; t += 0.1) {
        const f = logFrequency(t);
        expect(f).toBeGreaterThan(prev);
        prev = f;
      }
    });
  });

  // ── clamp ─────────────────────────────────────────────────

  describe('clamp', () => {
    it('passes through values in range', () => {
      expect(clamp(0.5, 0, 1)).toBe(0.5);
    });

    it('clamps below min', () => {
      expect(clamp(-5, 0, 1)).toBe(0);
    });

    it('clamps above max', () => {
      expect(clamp(10, 0, 1)).toBe(1);
    });

    it('handles equal min/max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });
  });
});
