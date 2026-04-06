import { describe, it, expect } from 'vitest';
import {
  createFixedGrid,
  getBeatAtTime,
  getTimeAtBeat,
  getBpmAtTime,
  type VariableBeatgrid,
} from '../../src/audio/variableBeatgrid';

describe('Variable Beatgrid — O(log n) Grid Engine', () => {
  // ── createFixedGrid ───────────────────────────────────────

  describe('createFixedGrid', () => {
    it('creates a single-marker grid', () => {
      const grid = createFixedGrid(128, 0.5);
      expect(grid.markers).toHaveLength(1);
      expect(grid.markers[0]).toEqual({ time: 0.5, beatNum: 0, bpm: 128 });
    });
  });

  // ── Fixed BPM grid (most electronic music) ────────────────

  describe('fixed BPM grid (128 BPM, offset 0.5s)', () => {
    const grid = createFixedGrid(128, 0.5);
    const beatPeriod = 60 / 128; // 0.46875s

    it('getBeatAtTime returns 0 at first beat offset', () => {
      expect(getBeatAtTime(grid, 0.5)).toBeCloseTo(0, 5);
    });

    it('getBeatAtTime returns correct beat after N beats', () => {
      expect(getBeatAtTime(grid, 0.5 + beatPeriod)).toBeCloseTo(1, 5);
      expect(getBeatAtTime(grid, 0.5 + 4 * beatPeriod)).toBeCloseTo(4, 5);
      expect(getBeatAtTime(grid, 0.5 + 16 * beatPeriod)).toBeCloseTo(16, 4);
    });

    it('getBeatAtTime handles time before grid origin (negative beats)', () => {
      const beat = getBeatAtTime(grid, 0.0);
      expect(beat).toBeLessThan(0);
    });

    it('getTimeAtBeat returns grid origin at beat 0', () => {
      expect(getTimeAtBeat(grid, 0)).toBeCloseTo(0.5, 5);
    });

    it('getTimeAtBeat is inverse of getBeatAtTime', () => {
      const t = 3.75;
      const beat = getBeatAtTime(grid, t);
      const tBack = getTimeAtBeat(grid, beat);
      expect(tBack).toBeCloseTo(t, 5);
    });

    it('getBpmAtTime returns constant BPM everywhere', () => {
      expect(getBpmAtTime(grid, 0.0)).toBe(128);
      expect(getBpmAtTime(grid, 5.0)).toBe(128);
      expect(getBpmAtTime(grid, 100.0)).toBe(128);
    });
  });

  // ── Variable BPM grid (live recording) ────────────────────

  describe('variable BPM grid (tempo change at beat 32)', () => {
    // Starts at 120 BPM, changes to 130 BPM at beat 32
    const beat32Time = 0.0 + 32 * (60 / 120); // 16s
    const grid: VariableBeatgrid = {
      markers: [
        { time: 0.0, beatNum: 0, bpm: 120 },
        { time: beat32Time, beatNum: 32, bpm: 130 },
      ],
    };

    it('getBpmAtTime returns 120 before the change point', () => {
      expect(getBpmAtTime(grid, 5.0)).toBe(120);
      expect(getBpmAtTime(grid, 15.0)).toBe(120);
    });

    it('getBpmAtTime returns 130 after the change point', () => {
      expect(getBpmAtTime(grid, beat32Time + 1)).toBe(130);
      expect(getBpmAtTime(grid, beat32Time + 10)).toBe(130);
    });

    it('getBeatAtTime is continuous across the tempo change', () => {
      // Just before the change point
      const beatBefore = getBeatAtTime(grid, beat32Time - 0.001);
      expect(beatBefore).toBeLessThan(32);
      expect(beatBefore).toBeCloseTo(32, 1);

      // At the change point
      const beatAt = getBeatAtTime(grid, beat32Time);
      expect(beatAt).toBeCloseTo(32, 5);

      // Just after: uses 130 BPM
      const beatAfter = getBeatAtTime(grid, beat32Time + 60 / 130);
      expect(beatAfter).toBeCloseTo(33, 4);
    });

    it('getTimeAtBeat is correct across tempo change', () => {
      expect(getTimeAtBeat(grid, 0)).toBeCloseTo(0.0, 5);
      expect(getTimeAtBeat(grid, 32)).toBeCloseTo(beat32Time, 5);
      // Beat 33 uses 130 BPM
      expect(getTimeAtBeat(grid, 33)).toBeCloseTo(beat32Time + 60 / 130, 4);
    });

    it('round-trip consistency across segments', () => {
      const testTimes = [0.5, 5.0, beat32Time - 0.1, beat32Time, beat32Time + 2];
      for (const t of testTimes) {
        const beat = getBeatAtTime(grid, t);
        const tBack = getTimeAtBeat(grid, beat);
        expect(tBack).toBeCloseTo(t, 4);
      }
    });
  });

  // ── Multi-segment grid (3+ tempo changes) ────────────────

  describe('multi-segment grid (4 sections)', () => {
    const grid: VariableBeatgrid = {
      markers: [
        { time: 0, beatNum: 0, bpm: 100 },
        { time: 9.6, beatNum: 16, bpm: 110 },   // beat 16 at 9.6s
        { time: 18.328, beatNum: 32, bpm: 120 }, // beat 32
        { time: 26.328, beatNum: 48, bpm: 130 }, // beat 48
      ],
    };

    it('getBpmAtTime returns correct BPM in each segment', () => {
      expect(getBpmAtTime(grid, 1.0)).toBe(100);
      expect(getBpmAtTime(grid, 10.0)).toBe(110);
      expect(getBpmAtTime(grid, 20.0)).toBe(120);
      expect(getBpmAtTime(grid, 30.0)).toBe(130);
    });

    it('binary search is correct at segment boundaries', () => {
      expect(getBeatAtTime(grid, 0)).toBeCloseTo(0, 5);
      expect(getBeatAtTime(grid, 9.6)).toBeCloseTo(16, 4);
    });
  });

  // ── Edge cases ────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty grid returns 0 for all lookups', () => {
      const grid: VariableBeatgrid = { markers: [] };
      expect(getBeatAtTime(grid, 5.0)).toBe(0);
      expect(getTimeAtBeat(grid, 5)).toBe(0);
      expect(getBpmAtTime(grid, 5.0)).toBe(0);
    });

    it('handles zero BPM marker gracefully', () => {
      const grid = createFixedGrid(0, 0);
      expect(getBeatAtTime(grid, 5.0)).toBe(0);
      expect(getTimeAtBeat(grid, 5)).toBe(0);
    });
  });
});
