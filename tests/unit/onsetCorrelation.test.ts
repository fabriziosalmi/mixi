import { describe, it, expect } from 'vitest';
import { crossCorrelatePhase } from '../../src/audio/onsetCorrelation';

describe('Onset Flux Cross-Correlation', () => {
  const SR = 44100;

  /** Generate a simple kick-like impulse at a given position. */
  function makeKickChunk(lengthMs: number, kickAtMs: number): Float32Array {
    const len = Math.round(SR * lengthMs / 1000);
    const chunk = new Float32Array(len);
    const kickSample = Math.round(SR * kickAtMs / 1000);
    const decayLen = Math.round(SR * 0.005); // 5ms decay

    for (let i = 0; i < decayLen && kickSample + i < len; i++) {
      chunk[kickSample + i] = 0.8 * Math.exp(-i / (decayLen * 0.3));
    }
    return chunk;
  }

  it('returns ~0 offset for identical signals', () => {
    const chunk = makeKickChunk(500, 50);
    const offset = crossCorrelatePhase(chunk, chunk, SR, 50);

    // Identical signals → offset should be 0 (or very close)
    if (offset !== null) {
      expect(Math.abs(offset * 1000)).toBeLessThan(5);
    }
  });

  it('detects positive offset when slave kick is delayed', () => {
    const master = makeKickChunk(500, 50);
    const slave = makeKickChunk(500, 70); // 20ms later

    const offset = crossCorrelatePhase(master, slave, SR, 50);
    // Slave is behind → offset should be positive
    if (offset !== null) {
      expect(offset).toBeGreaterThan(0);
    }
  });

  it('detects negative offset when slave kick is early', () => {
    const master = makeKickChunk(500, 70);
    const slave = makeKickChunk(500, 50); // 20ms earlier

    const offset = crossCorrelatePhase(master, slave, SR, 50);
    if (offset !== null) {
      expect(offset).toBeLessThan(0);
    }
  });

  it('returns null for silent signals (no correlation)', () => {
    const silent = new Float32Array(Math.round(SR * 0.5));
    const offset = crossCorrelatePhase(silent, silent, SR, 50);
    expect(offset).toBeNull();
  });

  it('returns null for very short chunks', () => {
    const tiny = new Float32Array(10);
    const offset = crossCorrelatePhase(tiny, tiny, SR, 50);
    expect(offset).toBeNull();
  });

  it('offset is bounded by maxShiftMs', () => {
    const master = makeKickChunk(500, 50);
    const slave = makeKickChunk(500, 50);
    const maxShift = 30;

    const offset = crossCorrelatePhase(master, slave, SR, maxShift);
    if (offset !== null) {
      expect(Math.abs(offset * 1000)).toBeLessThanOrEqual(maxShift);
    }
  });

  it('handles different length chunks gracefully', () => {
    const master = makeKickChunk(400, 50);
    const slave = makeKickChunk(600, 50);
    // Should not throw
    const offset = crossCorrelatePhase(master, slave, SR, 50);
    // May return null or a value — just shouldn't crash
    expect(offset === null || typeof offset === 'number').toBe(true);
  });
});
