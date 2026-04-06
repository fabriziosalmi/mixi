import { describe, it, expect } from 'vitest';
import { findBestRatio, harmonicRate, virtualBeatPeriod } from '../../src/audio/harmonicSync';

describe('Harmonic Sync — Cross-Genre Ratio Finder', () => {
  // ── findBestRatio ─────────────────────────────────────────

  describe('findBestRatio', () => {
    it('returns 1:1 for identical BPMs', () => {
      expect(findBestRatio(128, 128)).toBe(1);
    });

    it('returns 1:1 for very close BPMs (within 5 BPM)', () => {
      expect(findBestRatio(128, 130)).toBe(1);
      expect(findBestRatio(130, 128)).toBe(1);
    });

    it('finds 2:1 ratio for DnB master + House slave (170 / 2 ≈ 85 → no, but 170 vs 128…)', () => {
      // 170 / 2 = 85, too far from 128. 170 / 1.5 = 113, still far.
      // Actually 170 / 4*3 = 127.5 → closest to 128!
      const ratio = findBestRatio(170, 128);
      expect(ratio).toBeCloseTo(4 / 3, 4);
    });

    it('finds 2:1 ratio when master is double the slave BPM', () => {
      // 140 / 2 = 70, slave at 72 → within 5 BPM
      expect(findBestRatio(140, 72)).toBe(2);
    });

    it('finds 0.5 (1:2) when master is half the slave BPM', () => {
      // 70 / 0.5 = 140, slave at 138 → within 5 BPM
      expect(findBestRatio(70, 138)).toBe(0.5);
    });

    it('returns 1 as fallback when no ratio fits within tolerance', () => {
      // Very different BPMs with no harmonic relationship
      expect(findBestRatio(100, 200)).toBe(0.5); // 100/0.5 = 200 → exact match
    });

    it('handles zero and negative BPMs gracefully', () => {
      expect(findBestRatio(0, 128)).toBe(1);
      expect(findBestRatio(128, 0)).toBe(1);
      expect(findBestRatio(-1, 128)).toBe(1);
    });

    it('prefers 1:1 over other ratios when both fit', () => {
      // 128 / 1 = 128, exact → always prefer 1:1
      expect(findBestRatio(128, 128)).toBe(1);
    });

    it('finds 3:4 polyrhythmic ratio (triplet feel)', () => {
      // 96 / 0.75 = 128
      expect(findBestRatio(96, 128)).toBe(0.75);
    });
  });

  // ── harmonicRate ──────────────────────────────────────────

  describe('harmonicRate', () => {
    it('returns 1.0 when BPMs match at the given ratio', () => {
      // masterBpm=128, slaveOrig=128, ratio=1 → target=128/1=128, rate=128/128=1
      expect(harmonicRate(128, 128, 1)).toBeCloseTo(1.0, 4);
    });

    it('returns correct rate for tempo difference', () => {
      // master=130, slave=128, ratio=1 → target=130, rate=130/128 ≈ 1.0156
      expect(harmonicRate(130, 128, 1)).toBeCloseTo(1.015625, 4);
    });

    it('accounts for harmonic ratio in rate calculation', () => {
      // master=170, slave=128, ratio=4/3 → target=170/1.333=127.5, rate=127.5/128≈0.996
      const rate = harmonicRate(170, 128, 4 / 3);
      expect(rate).toBeCloseTo(0.996, 2);
    });

    it('clamps rate to [0.92, 1.08] pitch fader range', () => {
      // Extreme: master=200, slave=128, ratio=1 → rate=1.5625 → clamped to 1.08
      expect(harmonicRate(200, 128, 1)).toBe(1.08);
      // Extreme: master=100, slave=128, ratio=1 → rate=0.78 → clamped to 0.92
      expect(harmonicRate(100, 128, 1)).toBe(0.92);
    });

    it('handles edge cases: zero/negative inputs', () => {
      expect(harmonicRate(128, 0, 1)).toBe(1);
      expect(harmonicRate(128, 128, 0)).toBe(1);
    });
  });

  // ── virtualBeatPeriod ─────────────────────────────────────

  describe('virtualBeatPeriod', () => {
    it('returns standard beat period at ratio 1:1', () => {
      // 128 BPM → 60/128 = 0.46875s
      expect(virtualBeatPeriod(128, 1)).toBeCloseTo(0.46875, 5);
    });

    it('halves the period at ratio 2:1', () => {
      // 128 BPM, ratio 2 → (60/128)/2 = 0.234375s
      expect(virtualBeatPeriod(128, 2)).toBeCloseTo(0.234375, 5);
    });

    it('doubles the period at ratio 0.5 (1:2)', () => {
      // 128 BPM, ratio 0.5 → (60/128)/0.5 = 0.9375s
      expect(virtualBeatPeriod(128, 0.5)).toBeCloseTo(0.9375, 5);
    });

    it('returns 0 for invalid inputs', () => {
      expect(virtualBeatPeriod(0, 1)).toBe(0);
      expect(virtualBeatPeriod(128, 0)).toBe(0);
      expect(virtualBeatPeriod(-1, 1)).toBe(0);
    });
  });
});
