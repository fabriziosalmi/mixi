import { describe, it, expect } from 'vitest';
import { crossfaderGains, dbToGain, logFrequency } from '../../src/audio/utils/mathUtils';

describe('Crossfader — Constant Power Verification', () => {
  const positions = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  describe('smooth curve', () => {
    it('produces constant power (gainA² + gainB² ≈ 1) at all positions', () => {
      for (const x of positions) {
        const { gainA, gainB } = crossfaderGains(x, 'smooth');
        const power = gainA * gainA + gainB * gainB;
        expect(power).toBeCloseTo(1.0, 1); // within 0.1
      }
    });

    it('A is full at position 0', () => {
      const { gainA, gainB } = crossfaderGains(0, 'smooth');
      expect(gainA).toBeCloseTo(1.0, 2);
      expect(gainB).toBeCloseTo(0.0, 2);
    });

    it('B is full at position 1', () => {
      const { gainA, gainB } = crossfaderGains(1, 'smooth');
      expect(gainA).toBeCloseTo(0.0, 2);
      expect(gainB).toBeCloseTo(1.0, 2);
    });

    it('equal mix at center (0.5)', () => {
      const { gainA, gainB } = crossfaderGains(0.5, 'smooth');
      expect(gainA).toBeCloseTo(gainB, 2);
      expect(gainA).toBeCloseTo(0.707, 1);
    });
  });

  describe('sharp curve', () => {
    it('A is full at position 0', () => {
      const { gainA, gainB } = crossfaderGains(0, 'sharp');
      expect(gainA).toBeCloseTo(1.0, 2);
      expect(gainB).toBeCloseTo(0.0, 2);
    });

    it('B is full at position 1', () => {
      const { gainA, gainB } = crossfaderGains(1, 'sharp');
      expect(gainA).toBeCloseTo(0.0, 2);
      expect(gainB).toBeCloseTo(1.0, 2);
    });

    it('gains are non-negative at all positions', () => {
      for (const x of positions) {
        const { gainA, gainB } = crossfaderGains(x, 'sharp');
        expect(gainA).toBeGreaterThanOrEqual(0);
        expect(gainB).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

describe('dbToGain', () => {
  it('0 dB = 1.0 linear', () => {
    expect(dbToGain(0)).toBeCloseTo(1.0, 5);
  });

  it('-6 dB ≈ 0.5 linear', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 2);
  });

  it('+6 dB ≈ 2.0 linear', () => {
    expect(dbToGain(6)).toBeCloseTo(1.9953, 2);
  });

  it('-96 dB ≈ 0 linear', () => {
    expect(dbToGain(-96)).toBeLessThan(0.00002);
  });
});

describe('logFrequency', () => {
  it('t=0 → 20 Hz', () => {
    expect(logFrequency(0)).toBeCloseTo(20, 0);
  });

  it('t=1 → 20000 Hz', () => {
    expect(logFrequency(1)).toBeCloseTo(20000, 0);
  });

  it('t=0.5 → geometric midpoint (~632 Hz)', () => {
    const f = logFrequency(0.5);
    expect(f).toBeGreaterThan(500);
    expect(f).toBeLessThan(800);
  });

  it('is monotonically increasing', () => {
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.1) {
      const f = logFrequency(t);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });
});
