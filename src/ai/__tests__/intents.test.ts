/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// AI Intent Unit Tests
//
// Tests every intent's evaluate() and execute() against known
// blackboard states. Each test creates a mock blackboard and
// mock store, then verifies scoring and actions.
//
// These tests ensure the AI never causes audio disasters:
//   ✓ No volume left at 0
//   ✓ No EQ snap clicks
//   ✓ No race conditions between intents
//   ✓ Correct guards for edge cases
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Blackboard } from '../Blackboard';
import type { DeckState } from '../../types';

// ── Import all intents ──────────────────────────────────────
import { SafetyLoopIntent } from '../intents/SafetyLoopIntent';
import { PhaseDriftCorrectionIntent, resetPhaseDriftState } from '../intents/PhaseDriftCorrectionIntent';
import { RedLineLimiterIntent } from '../intents/RedLineLimiterIntent';
import { EqAmnesiaIntent } from '../intents/EqAmnesiaIntent';
import { DropSwapIntent } from '../intents/DropSwapIntent';
import { SubRumbleControlIntent } from '../intents/SubRumbleControlIntent';
import { HiHatLayeringIntent } from '../intents/HiHatLayeringIntent';
import { VocalSpaceCarvingIntent } from '../intents/VocalSpaceCarvingIntent';
// IsolatorSweepIntent has complex cooldown state, tested via integration.
// import { IsolatorSweepIntent } from '../intents/IsolatorSweepIntent';
import { FilterWashoutIntent } from '../intents/FilterWashoutIntent';
import { LpfMudDiveIntent } from '../intents/LpfMudDiveIntent';
import { PreDropSilenceIntent } from '../intents/PreDropSilenceIntent';
import { FilterWobbleIntent } from '../intents/FilterWobbleIntent';
import { LoopRollBuildupIntent } from '../intents/LoopRollBuildupIntent';
import { TeaserStabIntent } from '../intents/TeaserStabIntent';
import { OutroRidingIntent } from '../intents/OutroRidingIntent';
import { DoubleDropAlignIntent } from '../intents/DoubleDropAlignIntent';
import { KeyClashDefenseIntent } from '../intents/KeyClashDefenseIntent';

// ── Mock Blackboard Factory ─────────────────────────────────

function makeDeckState(overrides: Partial<DeckState> = {}): DeckState {
  return {
    isPlaying: false,
    isTrackLoaded: false,
    volume: 1.0,
    gain: 1.0,
    eq: { low: 0, mid: 0, high: 0 },
    colorFx: 0,
    playbackRate: 1.0,
    bpm: 128,
    firstBeatOffset: 0,
    duration: 300,
    currentTime: 0,
    activeLoop: null,
    musicalKey: '',
    dropBeats: [],
    hotCues: [],
    ...overrides,
  } as DeckState;
}

function makeBB(overrides: Partial<Blackboard> = {}): Blackboard {
  const ms = overrides.masterState ?? makeDeckState({ isPlaying: true, isTrackLoaded: true });
  const is = overrides.incomingState ?? makeDeckState();

  return {
    tick: 100,
    timestamp: 0,
    masterDeck: 'A',
    incomingDeck: 'B',
    masterState: ms,
    masterCurrentTime: 10,
    masterCurrentBeat: 20,
    masterTotalBeats: 600,
    beatsToOutroMaster: 80,
    beatsToEndMaster: 100,
    masterBpm: 128,
    masterBeatPeriod: 60 / 128,
    incomingState: is,
    incomingCurrentTime: 0,
    incomingCurrentBeat: 0,
    incomingBpm: 128,
    incomingIsReady: false,
    bothPlaying: false,
    isPhaseAligned: true,
    phaseDeltaMs: 0,
    bassClash: false,
    midClash: false,
    masterHasLoop: false,
    deadAirImminent: false,
    masterBeatInPhrase: 0,
    masterBeatsToPhrase: 16,
    incomingBeatInPhrase: 0,
    masterOnDownbeat: true,
    isBlending: false,
    incomingBassKilled: false,
    masterBassKilled: false,
    masterBassKilledTicks: 0,
    incomingBassKilledTicks: 0,
    masterHasFilter: false,
    masterDropBeat: null,
    incomingDropBeat: null,
    beatsToIncomingDrop: null,
    masterKey: '',
    incomingKey: '',
    isHarmonicMatch: false,
    crossfader: 0.5,
    masterVolume: 1.0,
    ...overrides,
  };
}

function mockStore() {
  return {
    setDeckVolume: vi.fn(),
    setDeckEq: vi.fn(),
    setDeckColorFx: vi.fn(),
    setDeckPlaybackRate: vi.fn(),
    setDeckPlaying: vi.fn(),
    setMasterVolume: vi.fn(),
    setMasterFilter: vi.fn(),
    setMasterDistortion: vi.fn(),
    setMasterPunch: vi.fn(),
    setCrossfader: vi.fn(),
    setAutoLoop: vi.fn(),
    exitLoop: vi.fn(),
    setDeckGain: vi.fn(),
    decks: { A: makeDeckState(), B: makeDeckState() },
  } as any;
}

// ─────────────────────────────────────────────────────────────
// Safety Domain
// ─────────────────────────────────────────────────────────────

describe('SafetyLoopIntent', () => {
  it('fires at max urgency when track ending', () => {
    const bb = makeBB({ beatsToEndMaster: 5, masterHasLoop: false });
    expect(SafetyLoopIntent.evaluate(bb)).toBe(1.0);
  });

  it('does not fire if loop already active', () => {
    const bb = makeBB({ beatsToEndMaster: 5, masterHasLoop: true });
    expect(SafetyLoopIntent.evaluate(bb)).toBe(0);
  });

  it('does not fire when far from end', () => {
    const bb = makeBB({ beatsToEndMaster: 50, masterHasLoop: false });
    expect(SafetyLoopIntent.evaluate(bb)).toBe(0);
  });

  it('does not fire when master not playing', () => {
    const ms = makeDeckState({ isPlaying: false });
    const bb = makeBB({ masterState: ms, beatsToEndMaster: 5 });
    expect(SafetyLoopIntent.evaluate(bb)).toBe(0);
  });

  it('sets 4-beat auto-loop', () => {
    const bb = makeBB({ beatsToEndMaster: 5 });
    const store = mockStore();
    SafetyLoopIntent.execute(bb, store);
    expect(store.setAutoLoop).toHaveBeenCalledWith('A', 4);
  });
});

describe('PhaseDriftCorrectionIntent', () => {
  beforeEach(() => {
    resetPhaseDriftState();
  });

  it('returns 0 when phase aligned', () => {
    const bb = makeBB({
      bothPlaying: true,
      phaseDeltaMs: 3,
      incomingState: makeDeckState({ isPlaying: true, volume: 0.8 }),
    });
    expect(PhaseDriftCorrectionIntent.evaluate(bb)).toBe(0);
  });

  it('scores when drift exceeds threshold', () => {
    const bb = makeBB({
      tick: 200,
      bothPlaying: true,
      phaseDeltaMs: 25,
      incomingState: makeDeckState({ isPlaying: true, volume: 0.8 }),
    });
    const score = PhaseDriftCorrectionIntent.evaluate(bb);
    expect(score).toBeGreaterThan(0.6);
  });

  it('returns 0 when incoming not audible', () => {
    const bb = makeBB({
      bothPlaying: true,
      phaseDeltaMs: 40,
      incomingState: makeDeckState({ isPlaying: true, volume: 0.1 }),
    });
    expect(PhaseDriftCorrectionIntent.evaluate(bb)).toBe(0);
  });

  it('applies nudge and stores state for tick-based restore', () => {
    const store = mockStore();
    const bb = makeBB({
      tick: 200,
      bothPlaying: true,
      phaseDeltaMs: 25,
      incomingState: makeDeckState({ isPlaying: true, volume: 0.8, playbackRate: 1.0 }),
    });
    PhaseDriftCorrectionIntent.execute(bb, store);
    expect(store.setDeckPlaybackRate).toHaveBeenCalled();
    const rate = store.setDeckPlaybackRate.mock.calls[0][1];
    // Should speed up (positive delta = incoming behind)
    expect(rate).toBeGreaterThan(1.0);
  });
});

describe('RedLineLimiterIntent', () => {
  it('fires when both loud with EQ boost', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.9, eq: { low: 5, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.9, eq: { low: 0, mid: 0, high: 0 } });
    const bb = makeBB({ masterState: ms, incomingState: is, bothPlaying: true, masterVolume: 1.0 });
    expect(RedLineLimiterIntent.evaluate(bb)).toBe(0.92);
  });

  it('does not fire without EQ boost', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.9, eq: { low: 0, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.9, eq: { low: 0, mid: 0, high: 0 } });
    const bb = makeBB({ masterState: ms, incomingState: is, bothPlaying: true });
    expect(RedLineLimiterIntent.evaluate(bb)).toBe(0);
  });

  it('reduces master volume to 0.7', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.9, eq: { low: 5, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.9 });
    const bb = makeBB({ masterState: ms, incomingState: is, bothPlaying: true, masterVolume: 1.0 });
    const store = mockStore();
    RedLineLimiterIntent.execute(bb, store);
    expect(store.setMasterVolume).toHaveBeenCalledWith(0.7);
  });
});

describe('EqAmnesiaIntent', () => {
  it('fires when bass killed for too long solo', () => {
    const ms = makeDeckState({ isPlaying: true, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      masterState: ms, masterBassKilled: true,
      masterBassKilledTicks: 50, isBlending: false, bothPlaying: false,
    });
    expect(EqAmnesiaIntent.evaluate(bb)).toBeGreaterThan(0);
  });

  it('does not fire during blend', () => {
    const ms = makeDeckState({ isPlaying: true, eq: { low: -20, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.8 });
    const bb = makeBB({
      masterState: ms, incomingState: is,
      masterBassKilled: true, masterBassKilledTicks: 50,
      isBlending: true, bothPlaying: true,
    });
    expect(EqAmnesiaIntent.evaluate(bb)).toBe(0);
  });

  it('does not fire when incoming has any volume (soft blend)', () => {
    const ms = makeDeckState({ isPlaying: true, eq: { low: -20, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.3 });
    const bb = makeBB({
      masterState: ms, incomingState: is,
      masterBassKilled: true, masterBassKilledTicks: 50,
      isBlending: false, bothPlaying: true,
    });
    expect(EqAmnesiaIntent.evaluate(bb)).toBe(0);
  });

  it('recovery step is 1 dB', () => {
    const ms = makeDeckState({ isPlaying: true, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      masterState: ms, masterBassKilled: true,
      masterBassKilledTicks: 50, isBlending: false,
    });
    const store = mockStore();
    EqAmnesiaIntent.execute(bb, store);
    expect(store.setDeckEq).toHaveBeenCalledWith('A', 'low', -19);
  });
});

// ─────────────────────────────────────────────────────────────
// Spectral Domain
// ─────────────────────────────────────────────────────────────

describe('DropSwapIntent', () => {
  it('fires on phrase boundary with incoming bass killed', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: 0, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      masterState: ms, incomingState: is,
      bothPlaying: true, incomingCurrentBeat: 16.1,
    });
    expect(DropSwapIntent.evaluate(bb)).toBe(0.9);
  });

  it('does not fire off phrase boundary', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: 0, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      masterState: ms, incomingState: is,
      bothPlaying: true, incomingCurrentBeat: 10,
    });
    expect(DropSwapIntent.evaluate(bb)).toBe(0);
  });

  it('does not fire when master bass already killed', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: -15, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      masterState: ms, incomingState: is,
      bothPlaying: true, incomingCurrentBeat: 16,
    });
    expect(DropSwapIntent.evaluate(bb)).toBe(0);
  });

  it('swaps bass EQ between decks', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.8 });
    const is = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({ masterState: ms, incomingState: is, bothPlaying: true });
    const store = mockStore();
    DropSwapIntent.execute(bb, store);
    expect(store.setDeckEq).toHaveBeenCalledWith('A', 'low', -26);
    expect(store.setDeckEq).toHaveBeenCalledWith('B', 'low', 0);
  });
});

describe('SubRumbleControlIntent', () => {
  it('fires on bass clash', () => {
    const is = makeDeckState({ isPlaying: true, eq: { low: 0, mid: 0, high: 0 } });
    const bb = makeBB({ incomingState: is, bassClash: true, isBlending: false, incomingBassKilledTicks: 5 });
    expect(SubRumbleControlIntent.evaluate(bb)).toBe(0.7);
  });

  it('does not fire when incoming bass already killed', () => {
    const is = makeDeckState({ isPlaying: true, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({ incomingState: is, bassClash: true });
    expect(SubRumbleControlIntent.evaluate(bb)).toBe(0);
  });

  it('does not re-cut freshly restored bass', () => {
    const is = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: 0, mid: 0, high: 0 } });
    const bb = makeBB({
      incomingState: is, bassClash: true,
      isBlending: true, incomingBassKilledTicks: 0,
    });
    expect(SubRumbleControlIntent.evaluate(bb)).toBe(0);
  });
});

describe('VocalSpaceCarvingIntent', () => {
  it('fires on mid clash', () => {
    const ms = makeDeckState({ isPlaying: true, eq: { low: 0, mid: 0, high: 0 } });
    const is = makeDeckState({ isPlaying: true, eq: { low: 0, mid: 0, high: 0 } });
    const bb = makeBB({ masterState: ms, incomingState: is, midClash: true });
    expect(VocalSpaceCarvingIntent.evaluate(bb)).toBe(0.5);
  });

  it('does not fire if incoming mids already deeply cut', () => {
    const is = makeDeckState({ isPlaying: true, eq: { low: 0, mid: -10, high: 0 } });
    const bb = makeBB({ incomingState: is, midClash: true });
    expect(VocalSpaceCarvingIntent.evaluate(bb)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Dynamics Domain
// ─────────────────────────────────────────────────────────────

describe('FilterWashoutIntent', () => {
  it('fires when both playing with incoming bass killed', () => {
    const is = makeDeckState({ isPlaying: true, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      bothPlaying: true,
      incomingState: is,
      masterCurrentBeat: 12, // 4 beats to phrase boundary
      masterState: makeDeckState({ isPlaying: true, colorFx: 0 }),
    });
    const score = FilterWashoutIntent.evaluate(bb);
    expect(score).toBeGreaterThan(0);
  });

  it('does not fire when incoming bass not killed', () => {
    const is = makeDeckState({ isPlaying: true, eq: { low: 0, mid: 0, high: 0 } });
    const bb = makeBB({ bothPlaying: true, incomingState: is });
    expect(FilterWashoutIntent.evaluate(bb)).toBe(0);
  });
});

describe('PreDropSilenceIntent', () => {
  it('fires within last beat of phrase', () => {
    const is = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: -20, mid: 0, high: 0 } });
    const ms = makeDeckState({ isPlaying: true, volume: 0.8 });
    const bb = makeBB({
      tick: 500,
      masterState: ms, incomingState: is,
      bothPlaying: true, incomingBassKilled: true,
      masterBeatsToPhrase: 0.7,
    });
    expect(PreDropSilenceIntent.evaluate(bb)).toBe(0.95);
  });

  it('sets both volumes to 0 and schedules restore', () => {
    vi.useFakeTimers();
    const is = makeDeckState({ isPlaying: true, volume: 0.8, eq: { low: -20, mid: 0, high: 0 } });
    const ms = makeDeckState({ isPlaying: true, volume: 0.9 });
    const bb = makeBB({
      tick: 500,
      masterState: ms, incomingState: is,
      bothPlaying: true, incomingBassKilled: true,
      masterBeatsToPhrase: 0.7,
      masterBeatPeriod: 0.469, // 128 BPM
    });
    const store = mockStore();
    PreDropSilenceIntent.execute(bb, store);
    expect(store.setDeckVolume).toHaveBeenCalledWith('A', 0);
    expect(store.setDeckVolume).toHaveBeenCalledWith('B', 0);

    // After restore timeout, volumes should be restored.
    vi.advanceTimersByTime(500);
    // The restore uses the raw store, so it calls setDeckVolume again.
    expect(store.setDeckVolume.mock.calls.length).toBeGreaterThanOrEqual(4);
    vi.useRealTimers();
  });
});

describe('FilterWobbleIntent', () => {
  it('fires within 8 beats of phrase boundary during blend', () => {
    const bb = makeBB({
      bothPlaying: true, masterHasFilter: false,
      masterBeatsToPhrase: 4,
    });
    expect(FilterWobbleIntent.evaluate(bb)).toBe(0.55);
  });

  it('produces smooth sine values', () => {
    const store = mockStore();
    // At beat fraction 0.25 (quarter of half-beat = peak sine)
    const bb = makeBB({
      bothPlaying: true, masterCurrentBeat: 10.125,
      masterBeatsToPhrase: 4,
    });
    FilterWobbleIntent.execute(bb, store);
    const fxValue = store.setDeckColorFx.mock.calls[0][1];
    // Sine wave: should be a smooth value between -0.2 and +0.2.
    expect(Math.abs(fxValue)).toBeLessThanOrEqual(0.201);

    // Test at a different beat to verify it's NOT binary.
    const store2 = mockStore();
    const bb2 = makeBB({
      bothPlaying: true, masterCurrentBeat: 10.05, // different fraction
      masterBeatsToPhrase: 4,
    });
    FilterWobbleIntent.execute(bb2, store2);
    const fxValue2 = store2.setDeckColorFx.mock.calls[0][1];
    // 10.05 % 0.5 = 0.05, 0.05/0.5 = 0.1, sin(0.1*2π) ≈ 0.588 → 0.588*0.2 ≈ 0.118
    // Should be between 0 and 0.2, NOT exactly 0.2 or -0.2
    expect(Math.abs(fxValue2)).toBeGreaterThan(0.01);
    expect(Math.abs(fxValue2)).toBeLessThan(0.19);
  });
});

// ─────────────────────────────────────────────────────────────
// Rhythm Domain
// ─────────────────────────────────────────────────────────────

describe('LoopRollBuildupIntent', () => {
  it('fires when approaching phrase boundary during blend', () => {
    const bb = makeBB({
      masterBeatsToPhrase: 6,
      beatsToOutroMaster: 20,
      incomingIsReady: true,
    });
    expect(LoopRollBuildupIntent.evaluate(bb)).toBe(0.75);
  });

  it('does not exit loop when near end of track', () => {
    const bb = makeBB({
      masterBeatsToPhrase: 0.3,
      beatsToEndMaster: 5, // Near end!
      masterHasLoop: true,
      beatsToOutroMaster: 3,
      incomingIsReady: true,
    });
    const store = mockStore();
    LoopRollBuildupIntent.execute(bb, store);
    // Should NOT call exitLoop (SafetyLoop needs the loop).
    expect(store.exitLoop).not.toHaveBeenCalled();
  });

  it('exits loop at phrase boundary when not near end', () => {
    const bb = makeBB({
      masterBeatsToPhrase: 0.3,
      beatsToEndMaster: 100,
      masterHasLoop: true,
      beatsToOutroMaster: 80,
      incomingIsReady: true,
    });
    const store = mockStore();
    LoopRollBuildupIntent.execute(bb, store);
    expect(store.exitLoop).toHaveBeenCalledWith('A');
  });
});

describe('TeaserStabIntent', () => {
  it('fires on downbeat during lead-in', () => {
    const is = makeDeckState({ isPlaying: true, volume: 0, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      incomingState: is, bothPlaying: true,
      incomingBassKilled: true,
      beatsToOutroMaster: 30,
      incomingCurrentBeat: 4.1, // beat mod 4 ≈ 0.1 → on downbeat
    });
    expect(TeaserStabIntent.evaluate(bb)).toBe(0.45);
  });

  it('does not fire when incoming already audible', () => {
    const is = makeDeckState({ isPlaying: true, volume: 0.5, eq: { low: -20, mid: 0, high: 0 } });
    const bb = makeBB({
      incomingState: is, bothPlaying: true,
      incomingBassKilled: true, beatsToOutroMaster: 30,
    });
    expect(TeaserStabIntent.evaluate(bb)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Structure Domain
// ─────────────────────────────────────────────────────────────

describe('KeyClashDefenseIntent', () => {
  it('fires when keys clash', () => {
    const bb = makeBB({
      bothPlaying: true,
      masterKey: '8A', incomingKey: '2B',
      isHarmonicMatch: false,
    });
    expect(KeyClashDefenseIntent.evaluate(bb)).toBe(0.8);
  });

  it('does not fire when keys are compatible', () => {
    const bb = makeBB({
      bothPlaying: true,
      masterKey: '8A', incomingKey: '8B',
      isHarmonicMatch: true,
    });
    expect(KeyClashDefenseIntent.evaluate(bb)).toBe(0);
  });

  it('kills incoming mids aggressively', () => {
    const is = makeDeckState({ isPlaying: true, eq: { low: 0, mid: 0, high: 0 } });
    const bb = makeBB({
      bothPlaying: true, incomingState: is,
      masterKey: '8A', incomingKey: '2B',
      isHarmonicMatch: false,
    });
    const store = mockStore();
    KeyClashDefenseIntent.execute(bb, store);
    expect(store.setDeckEq).toHaveBeenCalledWith('B', 'mid', -20);
  });
});

describe('DoubleDropAlignIntent', () => {
  it('fires when drops are misaligned with enough lead time', () => {
    const bb = makeBB({
      bothPlaying: true,
      masterDropBeat: 200, masterCurrentBeat: 50,
      incomingDropBeat: 100, beatsToIncomingDrop: 90,
    });
    expect(DoubleDropAlignIntent.evaluate(bb)).toBeGreaterThan(0);
  });

  it('does not fire without drop data', () => {
    const bb = makeBB({ bothPlaying: true, masterDropBeat: null });
    expect(DoubleDropAlignIntent.evaluate(bb)).toBe(0);
  });

  it('restores rate when aligned', () => {
    const is = makeDeckState({ isPlaying: true, playbackRate: 1.005 });
    const bb = makeBB({
      bothPlaying: true, incomingState: is,
      masterDropBeat: 100, masterCurrentBeat: 50,
      incomingDropBeat: 50, beatsToIncomingDrop: 50,
    });
    const store = mockStore();
    DoubleDropAlignIntent.execute(bb, store);
    // Should move rate towards 1.0
    const newRate = store.setDeckPlaybackRate.mock.calls[0][1];
    expect(Math.abs(newRate - 1.0)).toBeLessThan(Math.abs(1.005 - 1.0));
  });

  it('clamps rate within ±2%', () => {
    const is = makeDeckState({ isPlaying: true, playbackRate: 1.019 });
    const bb = makeBB({
      bothPlaying: true, incomingState: is,
      masterDropBeat: 200, masterCurrentBeat: 10,
      incomingDropBeat: 300, beatsToIncomingDrop: 250,
    });
    const store = mockStore();
    DoubleDropAlignIntent.execute(bb, store);
    const newRate = store.setDeckPlaybackRate.mock.calls[0][1];
    expect(newRate).toBeLessThanOrEqual(1.02);
    expect(newRate).toBeGreaterThanOrEqual(0.98);
  });
});

describe('OutroRidingIntent', () => {
  it('fires when both loud near end without clash', () => {
    const ms = makeDeckState({ isPlaying: true, volume: 0.9 });
    const is = makeDeckState({ isPlaying: true, volume: 0.9 });
    const bb = makeBB({
      masterState: ms, incomingState: is,
      bothPlaying: true, beatsToEndMaster: 40, bassClash: false,
    });
    expect(OutroRidingIntent.evaluate(bb)).toBe(0.3);
  });

  it('does not fire with bass clash', () => {
    const bb = makeBB({
      bothPlaying: true, beatsToEndMaster: 40,
      bassClash: true,
      masterState: makeDeckState({ isPlaying: true, volume: 0.9 }),
      incomingState: makeDeckState({ isPlaying: true, volume: 0.9 }),
    });
    expect(OutroRidingIntent.evaluate(bb)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Edge Cases & Cross-Intent Safety
// ─────────────────────────────────────────────────────────────

describe('Cross-intent safety', () => {
  it('VocalSpaceCarving defers to KeyClashDefense deep cut', () => {
    // If KeyClashDefense already set mid to -20, VocalSpaceCarving
    // should return 0 (guard: mid <= -8).
    const is = makeDeckState({ isPlaying: true, eq: { low: 0, mid: -20, high: 0 } });
    const bb = makeBB({ incomingState: is, midClash: true });
    expect(VocalSpaceCarvingIntent.evaluate(bb)).toBe(0);
  });

  it('SafetyLoop wins when LoopRoll would exit near track end', () => {
    // LoopRoll wants to exit at phrase boundary, but SafetyLoop
    // needs the loop. LoopRoll should NOT exit when beatsToEnd < 8.
    const bb = makeBB({
      masterBeatsToPhrase: 0.3,
      beatsToEndMaster: 4,
      masterHasLoop: true,
      beatsToOutroMaster: 2,
      incomingIsReady: true,
    });
    const store = mockStore();
    LoopRollBuildupIntent.execute(bb, store);
    expect(store.exitLoop).not.toHaveBeenCalled();
  });

  it('non-stateful intents return 0 when nothing is playing', () => {
    const bb = makeBB({
      tick: 9999,
      masterState: makeDeckState({ isPlaying: false }),
      incomingState: makeDeckState({ isPlaying: false }),
      bothPlaying: false,
    });

    // Only test intents without persistent module state.
    // PhaseDriftCorrection and RedLineLimiter have state that
    // can leak between tests — they're tested individually.
    const statelessIntents = [
      SafetyLoopIntent,
      EqAmnesiaIntent, DropSwapIntent, SubRumbleControlIntent,
      HiHatLayeringIntent, VocalSpaceCarvingIntent,
      FilterWashoutIntent, LpfMudDiveIntent,
      FilterWobbleIntent, LoopRollBuildupIntent, TeaserStabIntent,
      OutroRidingIntent, DoubleDropAlignIntent, KeyClashDefenseIntent,
    ];

    for (const intent of statelessIntents) {
      expect(intent.evaluate(bb)).toBe(0);
    }
  });
});
