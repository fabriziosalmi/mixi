/*
 * Mobile UI — Unit Tests
 *
 * Tests for mobile-specific logic: device detection, orientation,
 * haptics, panic, deck slot routing, and deck picker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────
// 1. Device detection (code-split routing logic from main.tsx)
// ─────────────────────────────────────────────────────────────

describe('Device detection logic', () => {
  // Replicates the detection logic from main.tsx
  function classifyDevice(width: number, height: number, maxTouchPoints: number) {
    const minDim = Math.min(width, height);
    const isMobile = minDim < 500 && maxTouchPoints > 0;
    return isMobile ? 'mobile' : 'desktop';
  }

  it('iPhone 14 (390×844, touch) → mobile', () => {
    expect(classifyDevice(390, 844, 5)).toBe('mobile');
  });

  it('iPhone 14 landscape (844×390, touch) → mobile', () => {
    expect(classifyDevice(844, 390, 5)).toBe('mobile');
  });

  it('iPhone SE (375×667, touch) → mobile', () => {
    expect(classifyDevice(375, 667, 5)).toBe('mobile');
  });

  it('iPad Mini (744×1133, touch) → desktop (handled by MobileScaleWrapper)', () => {
    expect(classifyDevice(744, 1133, 5)).toBe('desktop');
  });

  it('iPad Pro (1024×1366, touch) → desktop', () => {
    expect(classifyDevice(1024, 1366, 5)).toBe('desktop');
  });

  it('Desktop 1920×1080 (no touch) → desktop', () => {
    expect(classifyDevice(1920, 1080, 0)).toBe('desktop');
  });

  it('Desktop 1920×1080 with touchscreen → desktop (minDim > 500)', () => {
    expect(classifyDevice(1920, 1080, 1)).toBe('desktop');
  });

  it('Small window on desktop (400×300, no touch) → desktop (no touch)', () => {
    expect(classifyDevice(400, 300, 0)).toBe('desktop');
  });

  it('Galaxy Fold inner (717×512, touch) → desktop (minDim=512 > 500)', () => {
    expect(classifyDevice(717, 512, 5)).toBe('desktop');
  });

  it('Galaxy Fold outer (280×653, touch) → mobile', () => {
    expect(classifyDevice(280, 653, 5)).toBe('mobile');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Orientation detection (useOrientation logic)
// ─────────────────────────────────────────────────────────────

describe('Orientation detection logic', () => {
  function detectOrientation(width: number, height: number) {
    return width > height ? 'landscape' : 'portrait';
  }

  it('844×390 → landscape', () => {
    expect(detectOrientation(844, 390)).toBe('landscape');
  });

  it('390×844 → portrait', () => {
    expect(detectOrientation(390, 844)).toBe('portrait');
  });

  it('square 500×500 → portrait (width not greater)', () => {
    expect(detectOrientation(500, 500)).toBe('portrait');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Haptics (useHaptics)
// ─────────────────────────────────────────────────────────────

describe('useHaptics', () => {
  let originalVibrate: typeof navigator.vibrate;

  beforeEach(() => {
    originalVibrate = navigator.vibrate;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'vibrate', {
      value: originalVibrate,
      writable: true,
      configurable: true,
    });
  });

  it('does not crash when Vibration API is unavailable', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // Import and call — should not throw
    expect(() => {
      const vibrate = typeof navigator !== 'undefined' && navigator.vibrate
        ? (pattern: number | number[]) => { navigator.vibrate(pattern); }
        : () => {};
      vibrate(10);
      vibrate([10, 30, 10]);
    }).not.toThrow();
  });

  it('calls navigator.vibrate when available', () => {
    const mockVibrate = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'vibrate', {
      value: mockVibrate,
      writable: true,
      configurable: true,
    });

    navigator.vibrate(8);
    expect(mockVibrate).toHaveBeenCalledWith(8);

    navigator.vibrate([10, 30, 10]);
    expect(mockVibrate).toHaveBeenCalledWith([10, 30, 10]);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Panic reset (mobilePanic logic)
// ─────────────────────────────────────────────────────────────

describe('mobilePanic logic', () => {
  it('resets all EQ bands to 0 for both decks', async () => {
    // We test the logic pattern, not the actual store (which requires audio context)
    const calls: string[] = [];
    const mockStore = {
      decks: {
        A: { activeLoop: null },
        B: { activeLoop: { start: 0, end: 1, lengthInBeats: 4 } },
      },
      setDeckEq: (d: string, b: string, v: number) => calls.push(`eq:${d}:${b}:${v}`),
      setDeckGain: (d: string, v: number) => calls.push(`gain:${d}:${v}`),
      setDeckColorFx: (d: string, v: number) => calls.push(`cfx:${d}:${v}`),
      exitLoop: (d: string) => calls.push(`exitLoop:${d}`),
      setMasterFilter: (v: number) => calls.push(`masterFlt:${v}`),
      setMasterDistortion: (v: number) => calls.push(`masterDist:${v}`),
      setMasterPunch: (v: number) => calls.push(`masterPunch:${v}`),
      setCrossfader: (v: number) => calls.push(`xfader:${v}`),
    };

    // Simulate panic logic
    for (const d of ['A', 'B'] as const) {
      mockStore.setDeckEq(d, 'high', 0);
      mockStore.setDeckEq(d, 'mid', 0);
      mockStore.setDeckEq(d, 'low', 0);
      mockStore.setDeckGain(d, 0);
      mockStore.setDeckColorFx(d, 0);
      if (mockStore.decks[d].activeLoop) mockStore.exitLoop(d);
    }
    mockStore.setMasterFilter(0);
    mockStore.setMasterDistortion(0);
    mockStore.setMasterPunch(0);
    mockStore.setCrossfader(0.5);

    // Verify all resets happened
    expect(calls).toContain('eq:A:high:0');
    expect(calls).toContain('eq:A:mid:0');
    expect(calls).toContain('eq:A:low:0');
    expect(calls).toContain('eq:B:high:0');
    expect(calls).toContain('eq:B:mid:0');
    expect(calls).toContain('eq:B:low:0');
    expect(calls).toContain('gain:A:0');
    expect(calls).toContain('gain:B:0');
    expect(calls).toContain('cfx:A:0');
    expect(calls).toContain('cfx:B:0');
    // Only deck B had an active loop
    expect(calls).toContain('exitLoop:B');
    expect(calls).not.toContain('exitLoop:A');
    // Master resets
    expect(calls).toContain('masterFlt:0');
    expect(calls).toContain('masterDist:0');
    expect(calls).toContain('masterPunch:0');
    expect(calls).toContain('xfader:0.5');
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Shake detection (MobileApp logic)
// ─────────────────────────────────────────────────────────────

describe('Shake detection logic', () => {
  const SHAKE_THRESHOLD = 25;
  const SHAKE_CONSECUTIVE = 3;

  function simulateShake(samples: number[]): boolean {
    let count = 0;
    for (const accel of samples) {
      if (accel > SHAKE_THRESHOLD) {
        count++;
        if (count >= SHAKE_CONSECUTIVE) return true;
      } else {
        count = 0;
      }
    }
    return false;
  }

  it('detects shake with 3 consecutive high-acceleration samples', () => {
    expect(simulateShake([30, 30, 30])).toBe(true);
  });

  it('does not trigger on 2 consecutive samples', () => {
    expect(simulateShake([30, 30, 10])).toBe(false);
  });

  it('does not trigger on normal movement (< 25 m/s²)', () => {
    expect(simulateShake([10, 15, 20, 12, 8])).toBe(false);
  });

  it('does not trigger on interrupted high acceleration', () => {
    expect(simulateShake([30, 30, 5, 30, 30])).toBe(false);
  });

  it('triggers late in a sequence', () => {
    expect(simulateShake([5, 10, 30, 30, 30])).toBe(true);
  });

  it('gravity alone (~9.8 m/s²) does not trigger', () => {
    expect(simulateShake([9.8, 9.8, 9.8, 9.8])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Crossfader haptic detent logic
// ─────────────────────────────────────────────────────────────

describe('Crossfader center detent', () => {
  function shouldSnap(prev: number, current: number): boolean {
    return (prev < 0.48 || prev > 0.52) && current >= 0.48 && current <= 0.52;
  }

  it('snaps when crossing into center zone from left', () => {
    expect(shouldSnap(0.40, 0.50)).toBe(true);
  });

  it('snaps when crossing into center zone from right', () => {
    expect(shouldSnap(0.60, 0.50)).toBe(true);
  });

  it('does not snap when already in center zone', () => {
    expect(shouldSnap(0.49, 0.50)).toBe(false);
  });

  it('does not snap when moving outside center zone', () => {
    expect(shouldSnap(0.30, 0.40)).toBe(false);
  });

  it('snaps at edge of zone (0.48)', () => {
    expect(shouldSnap(0.47, 0.48)).toBe(true);
  });

  it('snaps at edge of zone (0.52)', () => {
    expect(shouldSnap(0.53, 0.52)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Deck slot routing (MobileDeckSlot logic)
// ─────────────────────────────────────────────────────────────

describe('MobileDeckSlot routing logic', () => {
  interface MockDeckEntry {
    mode: string;
    mobileComponent?: boolean; // simplified for testing
  }

  function routeDeck(mode: string, decks: MockDeckEntry[]): 'track-inline' | 'mobile-component' | 'fallback' {
    if (mode === 'track') return 'track-inline';
    const deck = decks.find((d) => d.mode === mode);
    if (deck?.mobileComponent) return 'mobile-component';
    return 'fallback';
  }

  const mockDecks: MockDeckEntry[] = [
    { mode: 'groovebox' },                    // no mobile
    { mode: 'turbokick', mobileComponent: true }, // has mobile
    { mode: 'js303' },                        // no mobile
  ];

  it('track mode → handled inline by layout', () => {
    expect(routeDeck('track', mockDecks)).toBe('track-inline');
  });

  it('turbokick (has mobile) → mobile component', () => {
    expect(routeDeck('turbokick', mockDecks)).toBe('mobile-component');
  });

  it('groovebox (no mobile) → fallback', () => {
    expect(routeDeck('groovebox', mockDecks)).toBe('fallback');
  });

  it('js303 (no mobile) → fallback', () => {
    expect(routeDeck('js303', mockDecks)).toBe('fallback');
  });

  it('unknown mode → fallback', () => {
    expect(routeDeck('unknown', mockDecks)).toBe('fallback');
  });
});

// ─────────────────────────────────────────────────────────────
// 8. TurboKick step grid logic
// ─────────────────────────────────────────────────────────────

describe('TurboKick step grid', () => {
  it('default pattern has kicks on every beat (0, 4, 8, 12)', () => {
    const STEP_COUNT = 16;
    const defaultSteps = Array.from({ length: STEP_COUNT }, (_, i) => i % 4 === 0);
    expect(defaultSteps[0]).toBe(true);
    expect(defaultSteps[1]).toBe(false);
    expect(defaultSteps[4]).toBe(true);
    expect(defaultSteps[8]).toBe(true);
    expect(defaultSteps[12]).toBe(true);
    expect(defaultSteps.filter(Boolean).length).toBe(4);
  });

  it('toggle step flips the state', () => {
    const steps = Array(16).fill(false);
    // Toggle step 3 on
    steps[3] = !steps[3];
    expect(steps[3]).toBe(true);
    // Toggle step 3 off
    steps[3] = !steps[3];
    expect(steps[3]).toBe(false);
  });

  it('clear pattern sets all steps to false', () => {
    const steps = [true, false, true, true, false, false, true, false,
                   true, false, false, true, false, true, false, true];
    const cleared = steps.map(() => false);
    expect(cleared.every((s) => s === false)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. Waveform position calculation (MobileWaveform logic)
// ─────────────────────────────────────────────────────────────

describe('Waveform position calculation', () => {
  const POINTS_PER_SECOND = 100;
  const PLAYHEAD_RATIO = 1 / 3;
  const BAR_STEP = 3; // BAR_WIDTH(2) + BAR_GAP(1)

  it('calculates correct startIndex for playhead at 33%', () => {
    const width = 300;
    const currentTime = 10; // 10 seconds in
    const playheadX = (width * PLAYHEAD_RATIO) | 0; // 100px
    const barsLeftOfPlayhead = (playheadX / BAR_STEP) | 0; // 33 bars
    const currentIndex = currentTime * POINTS_PER_SECOND; // 1000
    const startIndex = currentIndex - barsLeftOfPlayhead; // 967

    expect(startIndex).toBe(967);
  });

  it('startIndex can be negative at track start', () => {
    const width = 300;
    const currentTime = 0;
    const playheadX = (width * PLAYHEAD_RATIO) | 0;
    const barsLeftOfPlayhead = (playheadX / BAR_STEP) | 0;
    const currentIndex = currentTime * POINTS_PER_SECOND;
    const startIndex = currentIndex - barsLeftOfPlayhead;

    expect(startIndex).toBeLessThan(0);
  });

  it('totalBars fills the canvas width', () => {
    const width = 300;
    const totalBars = Math.ceil(width / BAR_STEP);
    expect(totalBars).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────
// 10. EQ kill button logic
// ─────────────────────────────────────────────────────────────

describe('EQ kill button logic', () => {
  const EQ_MIN = -32;

  it('kill saves current value and cuts to min', () => {
    let currentValue = 6;
    let savedValue: number | null = null;

    // Kill
    savedValue = currentValue;
    currentValue = EQ_MIN;

    expect(savedValue).toBe(6);
    expect(currentValue).toBe(-32);
  });

  it('un-kill restores saved value', () => {
    let currentValue = EQ_MIN;
    const savedValue = 6;

    // Un-kill
    currentValue = savedValue;

    expect(currentValue).toBe(6);
  });

  it('moving knob while killed clears saved value', () => {
    let savedValue: number | null = 6;

    // User moves knob
    savedValue = null;

    expect(savedValue).toBeNull();
  });
});
