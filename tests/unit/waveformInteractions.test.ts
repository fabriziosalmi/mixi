import { describe, it, expect } from 'vitest';
import {
  BAR_STEP,
  screenXToTime,
  timeToScreenX,
  snapToBeat,
  hitTest,
  zoomAtPoint,
  resizeLoop,
  clampMenuPosition,
  HIT_RADIUS,
} from '../../src/components/deck/waveformInteractions';
import { POINTS_PER_SECOND } from '../../src/audio/WaveformAnalyzer';

// ─────────────────────────────────────────────────────────────
// screenXToTime / timeToScreenX (coordinate round-trip)
// ─────────────────────────────────────────────────────────────

describe('screenXToTime', () => {
  it('returns 0 for clickX=0 when startIndex=0', () => {
    expect(screenXToTime(0, 0, 1)).toBe(0);
  });

  it('maps clickX at BAR_STEP to 1/POINTS_PER_SECOND', () => {
    // At zoom 1, one bar = one data point = 1/100 sec
    const time = screenXToTime(BAR_STEP, 0, 1);
    expect(time).toBeCloseTo(1 / POINTS_PER_SECOND, 6);
  });

  it('clamps negative results to 0', () => {
    // startIndex = 500, clickX = 0 → dataIndex = 500, positive
    // startIndex = -500, clickX = 0 → dataIndex = -500 → clamped to 0
    expect(screenXToTime(0, -500, 1)).toBe(0);
  });

  it('accounts for zoom', () => {
    // At zoom 2, each bar covers 2 data points
    const time = screenXToTime(BAR_STEP, 0, 2);
    expect(time).toBeCloseTo(2 / POINTS_PER_SECOND, 6);
  });

  it('accounts for startIndex offset', () => {
    // startIndex = 1000 (= 10 seconds), clickX = 0
    const time = screenXToTime(0, 1000, 1);
    expect(time).toBeCloseTo(10, 6);
  });
});

describe('timeToScreenX', () => {
  it('returns 0 for time=0 when startIndex=0', () => {
    expect(timeToScreenX(0, 0, 1)).toBe(0);
  });

  it('is inverse of screenXToTime', () => {
    const startIndex = 500;
    const zoom = 1.5;
    const originalX = 120;
    const time = screenXToTime(originalX, startIndex, zoom);
    const recoveredX = timeToScreenX(time, startIndex, zoom);
    expect(recoveredX).toBeCloseTo(originalX, 4);
  });

  it('round-trips across various zoom levels', () => {
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const startIndex = 300;
      const x = 200;
      const time = screenXToTime(x, startIndex, zoom);
      const back = timeToScreenX(time, startIndex, zoom);
      expect(back).toBeCloseTo(x, 4);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// snapToBeat
// ─────────────────────────────────────────────────────────────

describe('snapToBeat', () => {
  const bpm = 120; // beat period = 0.5s
  const offset = 0.1; // first beat at 0.1s

  it('snaps to nearest beat when quantize=true', () => {
    // Beat 2 is at 0.1 + 1*0.5 = 0.6s. Input near 0.62 should snap to 0.6
    const result = snapToBeat(0.62, bpm, offset, true, false);
    expect(result).toBeCloseTo(0.6, 4);
  });

  it('returns original time when quantize=false and forceSnap=false', () => {
    const result = snapToBeat(0.62, bpm, offset, false, false);
    expect(result).toBe(0.62);
  });

  it('snaps when forceSnap=true even if quantize=false', () => {
    const result = snapToBeat(0.62, bpm, offset, false, true);
    expect(result).toBeCloseTo(0.6, 4);
  });

  it('returns original time when bpm <= 0', () => {
    expect(snapToBeat(0.62, 0, offset, true, true)).toBe(0.62);
    expect(snapToBeat(0.62, -1, offset, true, true)).toBe(0.62);
  });

  it('does not snap when too far from nearest beat (>40% of beat period)', () => {
    // Beat period = 0.5s. 40% = 0.2s. Beat at 0.6s.
    // 0.62 is 0.02 from beat → snaps
    // 0.85 is 0.25 from beat 0.6 and 0.25 from beat 1.1 → 0.25 > 0.2 → no snap
    const result = snapToBeat(0.85, bpm, offset, true, false);
    expect(result).toBe(0.85);
  });

  it('snaps to beat 0 correctly', () => {
    const result = snapToBeat(0.12, bpm, offset, true, false);
    expect(result).toBeCloseTo(0.1, 4);
  });

  it('handles high BPM (170)', () => {
    const bp = 60 / 170; // ~0.353s
    const result = snapToBeat(0.1 + bp * 5 + 0.02, 170, 0.1, true, false);
    expect(result).toBeCloseTo(0.1 + bp * 5, 3);
  });
});

// ─────────────────────────────────────────────────────────────
// hitTest
// ─────────────────────────────────────────────────────────────

describe('hitTest', () => {
  const startIndex = 0;
  const zoom = 1;

  // Helper: place a cue at 1.0s and compute its screen X
  const cueTime = 1.0;
  const cueScreenX = timeToScreenX(cueTime, startIndex, zoom);

  it('returns none when no markers exist', () => {
    const result = hitTest(100, [null, null, null, null, null, null, null, null], null, startIndex, zoom);
    expect(result.type).toBe('none');
  });

  it('detects hot cue hit within radius', () => {
    const cues: (number | null)[] = [null, cueTime, null, null, null, null, null, null];
    const result = hitTest(cueScreenX + 3, cues, null, startIndex, zoom);
    expect(result.type).toBe('cue');
    expect(result.index).toBe(1);
  });

  it('misses hot cue outside radius', () => {
    const cues: (number | null)[] = [cueTime, null, null, null, null, null, null, null];
    const result = hitTest(cueScreenX + HIT_RADIUS + 1, cues, null, startIndex, zoom);
    expect(result.type).toBe('none');
  });

  it('detects loop start border hit', () => {
    const loop = { start: 2.0, end: 4.0 };
    const loopStartX = timeToScreenX(2.0, startIndex, zoom);
    const result = hitTest(loopStartX + 2, [null, null, null, null, null, null, null, null], loop, startIndex, zoom);
    expect(result.type).toBe('loop-start');
  });

  it('detects loop end border hit', () => {
    const loop = { start: 2.0, end: 4.0 };
    const loopEndX = timeToScreenX(4.0, startIndex, zoom);
    const result = hitTest(loopEndX - 3, [null, null, null, null, null, null, null, null], loop, startIndex, zoom);
    expect(result.type).toBe('loop-end');
  });

  it('prioritises cue over loop when both are at same position', () => {
    const cues: (number | null)[] = [2.0, null, null, null, null, null, null, null];
    const loop = { start: 2.0, end: 4.0 };
    const cx = timeToScreenX(2.0, startIndex, zoom);
    const result = hitTest(cx, cues, loop, startIndex, zoom);
    expect(result.type).toBe('cue');
    expect(result.index).toBe(0);
  });

  it('works with non-default zoom', () => {
    const z = 2;
    const cues: (number | null)[] = [1.0, null, null, null, null, null, null, null];
    const cx = timeToScreenX(1.0, 0, z);
    const result = hitTest(cx + 1, cues, null, 0, z);
    expect(result.type).toBe('cue');
  });
});

// ─────────────────────────────────────────────────────────────
// zoomAtPoint
// ─────────────────────────────────────────────────────────────

describe('zoomAtPoint', () => {
  it('keeps data point under mouse fixed', () => {
    const mouseX = 200;
    const oldStart = 500;
    const oldZoom = 1;
    const newZoom = 2;

    const newStart = zoomAtPoint(mouseX, oldStart, oldZoom, newZoom);

    // The data index under the mouse should be the same before and after
    const mouseBarIndex = mouseX / BAR_STEP;
    const dataBefore = oldStart + mouseBarIndex * oldZoom;
    const dataAfter = newStart + mouseBarIndex * newZoom;
    expect(dataAfter).toBeCloseTo(dataBefore, 6);
  });

  it('returns same startIndex when zoom does not change', () => {
    const result = zoomAtPoint(150, 300, 1.5, 1.5);
    expect(result).toBeCloseTo(300, 6);
  });

  it('zooming in (larger zoom) shifts startIndex forward', () => {
    // When zooming in, fewer data points are visible, so startIndex
    // moves toward the mouse point
    const mouseX = 200;
    const oldStart = 0;
    const newStart = zoomAtPoint(mouseX, oldStart, 1, 2);
    // startIndex should increase (or stay same if mouse is at left edge)
    const mouseBarIndex = mouseX / BAR_STEP;
    // newStart = dataUnderMouse - mouseBarIndex * newZoom
    // = mouseBarIndex * 1 - mouseBarIndex * 2 = -mouseBarIndex
    expect(newStart).toBeCloseTo(-mouseBarIndex, 4);
  });

  it('zooming out (smaller zoom) increases startIndex relative to zooming in', () => {
    const mouseX = 200;
    const oldStart = 100;
    const newStartOut = zoomAtPoint(mouseX, oldStart, 2, 1);
    const newStartIn = zoomAtPoint(mouseX, oldStart, 2, 4);
    // Zooming out → more data visible left of mouse → startIndex is larger
    // (or equal) compared to zooming in where fewer data points are shown
    expect(newStartOut).toBeGreaterThan(newStartIn);
  });
});

// ─────────────────────────────────────────────────────────────
// resizeLoop
// ─────────────────────────────────────────────────────────────

describe('resizeLoop', () => {
  it('resizes start border', () => {
    const result = resizeLoop('start', 1.5, 2.0, 4.0);
    expect(result).toEqual({ start: 1.5, end: 4.0 });
  });

  it('resizes end border', () => {
    const result = resizeLoop('end', 5.0, 2.0, 4.0);
    expect(result).toEqual({ start: 2.0, end: 5.0 });
  });

  it('returns null if start would cross end', () => {
    const result = resizeLoop('start', 3.98, 2.0, 4.0);
    expect(result).toBeNull();
  });

  it('returns null if end would cross start', () => {
    const result = resizeLoop('end', 2.04, 2.0, 4.0);
    expect(result).toBeNull();
  });

  it('allows exactly 50ms gap', () => {
    const result = resizeLoop('start', 3.949, 2.0, 4.0);
    expect(result).not.toBeNull();
    expect(result!.start).toBe(3.949);
  });

  it('preserves untouched border', () => {
    const r1 = resizeLoop('start', 1.0, 2.0, 6.0);
    expect(r1!.end).toBe(6.0);

    const r2 = resizeLoop('end', 8.0, 2.0, 6.0);
    expect(r2!.start).toBe(2.0);
  });
});

// ─────────────────────────────────────────────────────────────
// clampMenuPosition
// ─────────────────────────────────────────────────────────────

describe('clampMenuPosition', () => {
  it('does not change position when menu fits', () => {
    const result = clampMenuPosition(10, 10, 160, 140, 800, 400);
    expect(result).toEqual({ x: 10, y: 10 });
  });

  it('clamps X when menu would overflow right edge', () => {
    const result = clampMenuPosition(700, 10, 160, 140, 800, 400);
    expect(result.x).toBe(640); // 800 - 160
    expect(result.y).toBe(10);
  });

  it('clamps Y when menu would overflow bottom edge', () => {
    const result = clampMenuPosition(10, 300, 160, 140, 800, 400);
    expect(result.x).toBe(10);
    expect(result.y).toBe(260); // 400 - 140
  });

  it('clamps both X and Y', () => {
    const result = clampMenuPosition(750, 350, 160, 140, 800, 400);
    expect(result.x).toBe(640);
    expect(result.y).toBe(260);
  });

  it('handles edge case where menu is larger than canvas', () => {
    const result = clampMenuPosition(0, 0, 200, 200, 100, 100);
    expect(result.x).toBe(-100); // 100 - 200
    expect(result.y).toBe(-100);
  });
});
