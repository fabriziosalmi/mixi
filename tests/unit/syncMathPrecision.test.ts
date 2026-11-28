/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * Mathematical Sync, Phase Lock & Pitch Precision Regression Suite
 *
 * Verifies:
 *   SYNC-01: Drift compensation sign & dimensionless units (ms/s -> s/s)
 *   SYNC-02: Synced slave tracks Master pitch fader ramps automatically
 *   SYNC-03: Worklet slaveTime integrates driftCorrection + nudge
 *   SYNC-04: Exact unrounded master tempo eliminates 5-minute cumulative drift
 *   SYNC-05: JS worklet uses buffer-time originalBpm (no double-pitching)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useMixiStore } from '../../src/store/mixiStore';
import { phaseLockLoop } from '../../src/audio/PhaseLockLoop';

describe('Sync, Phase Lock & Pitch Mathematical Precision', () => {
  let fakeNow = 10_000;

  beforeEach(() => {
    // Advance mock clock past syncDeck's 50ms debounce between tests
    fakeNow += 200;
    vi.spyOn(performance, 'now').mockReturnValue(fakeNow);
    const store = useMixiStore.getState();
    store.setDeckBpm('A', 128, 0, 0.95);
    store.setDeckBpm('B', 125, 0, 0.95);
    store.setDeckPlaybackRate('A', 1.0);
    store.setDeckPlaybackRate('B', 1.0);
    phaseLockLoop.reset('A');
    phaseLockLoop.reset('B');
  });

  it('SYNC-01: tickDrift applies POSITIVE rateCorrection when slave runs slow (positive slope)', () => {
    const pll = phaseLockLoop as unknown as {
      tickDrift: (deck: 'A' | 'B', phaseDelta: number, masterBpm: number) => void;
      drift: Record<'A' | 'B', { rateCorrection: number }>;
    };

    // Simulate slave running 0.1% too slow at 128 BPM (beatPeriod = 0.46875s).
    // Every 500ms tick, master pulls ahead by +0.5ms -> phaseDelta grows by +0.5ms / 468.75ms.
    const masterBpm = 128;
    const beatPeriodMs = (60 / masterBpm) * 1000;
    const driftPerTickMs = 0.5; // +1.0 ms/s = +0.001 fractional speed error

    for (let t = 0; t < 25; t++) {
      const phaseDelta = (t * driftPerTickMs) / beatPeriodMs;
      pll.tickDrift('B', phaseDelta, masterBpm);
    }

    const corr = pll.drift.B.rateCorrection;
    // Must be POSITIVE (speed up slow slave) and bounded cleanly
    expect(corr).toBeGreaterThan(0.0002);
    expect(corr).toBeLessThanOrEqual(0.002);
  });

  it('SYNC-02: synced slave follows Master pitch fader ramps without losing sync', () => {
    const store = useMixiStore.getState();
    store.setDeckBpm('A', 128, 0, 0.95);
    store.setDeckBpm('B', 124, 0, 0.95);
    store.syncDeck('B');

    expect(useMixiStore.getState().decks.B.isSynced).toBe(true);
    expect(useMixiStore.getState().decks.B.playbackRate).toBeCloseTo(128 / 124, 6);

    // DJ ramps Master Deck A from 128 BPM up to +5% (134.4 BPM)
    useMixiStore.getState().setDeckPlaybackRate('A', 1.05);

    const state = useMixiStore.getState();
    expect(state.decks.A.playbackRate).toBeCloseTo(1.05, 6);
    expect(state.decks.B.isSynced).toBe(true);
    expect(state.decks.B.playbackRate).toBeCloseTo((128 * 1.05) / 124, 6);
    expect(state.decks.B.bpm).toBeCloseTo(134.4, 1);
  });

  it('SYNC-04: exact unrounded master tempo keeps 5-minute (300s) cumulative drift < 0.01 ms', () => {
    const store = useMixiStore.getState();
    // Master 128.0 BPM at +1.13% -> exact tempo = 129.4464 BPM (UI displays 129.4)
    store.setDeckBpm('A', 128.0, 0, 0.95);
    store.setDeckBpm('B', 125.0, 0, 0.95);
    store.setDeckPlaybackRate('A', 1.0113);
    store.syncDeck('B');

    const { A, B } = useMixiStore.getState().decks;
    const exactMasterBpm = A.originalBpm * A.playbackRate;
    const exactSlaveBpm = B.originalBpm * B.playbackRate;

    // 5 minutes = 300 seconds of continuous playback
    const durationSec = 300;
    const masterBeats = (durationSec * exactMasterBpm) / 60;
    const slaveBeats = (durationSec * exactSlaveBpm) / 60;
    const driftBeats = Math.abs(masterBeats - slaveBeats);
    const driftMs = driftBeats * (60 / exactMasterBpm) * 1000;

    expect(driftMs).toBeLessThan(0.01);
  });

  it('SYNC-03 & SYNC-05: all 3 pitch-shift worklets use originalBpm and integrate driftCorrection + nudge', () => {
    const files = [
      'src/audio/pitch-shift-processor.ts',
      'src/audio/pitch-shift-processor.js',
      'public/worklets/pitch-shift-wasm-processor.js',
    ];

    for (const rel of files) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(src, `${rel} must integrate driftCorrection + nudge into slaveTime`).toContain(
        'this.baseRate * (1.0 + this.pllCorrection + this.driftCorrection) + this.nudge',
      );
      expect(src, `${rel} must compute masterPeriod from masterOriginalBpm`).toContain(
        '60 / this.masterOriginalBpm',
      );
      expect(src, `${rel} must NOT double-pitch slavePeriod with baseRate`).not.toContain(
        'const slaveBpm = this.slaveOriginalBpm * this.baseRate',
      );
    }
  });

  it('KEYLOCK-01: JS & TS pitch-shift worklets preserve stereo, ratio-safe lookBack, and per-grain anchors', () => {
    for (const rel of ['src/audio/pitch-shift-processor.ts', 'src/audio/pitch-shift-processor.js']) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(src, `${rel} must allocate independent right channel inputBufR`).toContain('inputBufR');
      expect(src, `${rel} must use ratio-safe lookBack for slowing down`).toContain('Math.ceil(GRAIN_SIZE * Math.max(1, this.pitchRatio))');
      expect(src, `${rel} must anchor grainAStart/grainBStart to eliminate 375Hz quantum warble`).toContain('this.grainAStart');
      expect(src, `${rel} must anchor grainBStart`).toContain('this.grainBStart');
    }
  });
});
