/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Blackboard (Real-Time Context Snapshot)
//
// The Blackboard is the "sensorium" of the AI DJ.
// Updated once per tick, it pre-computes every derived value
// that intents might need so they don't duplicate math.
//
// WHY a Blackboard:
//   - Intents must be FAST.  If 30 intents each compute
//     "beats to end of track A", that's 30× the same work.
//     The Blackboard does it once.
//   - It decouples "sensing" from "deciding".  An intent
//     never touches MixiEngine or useMixiStore directly —
//     it reads a flat, pre-computed snapshot.
//   - It's serialisable: we can log it, replay it, diff it.
//
// Naming convention:
//   master*   → refers to the deck currently driving the floor
//   incoming* → refers to the deck being prepared or mixed in
//   (Not to be confused with the "Master bus" which is the
//    physical output — these are logical DJ roles.)
// ─────────────────────────────────────────────────────────────

import type { DeckId, DeckState } from '../types';
import { MixiEngine } from '../audio/MixiEngine';
import { useMixiStore } from '../store/mixiStore';
import { timeToBeat, calcMixOutBeat } from '../automixer/beatUtils';
import { isHarmonicMatch } from '../audio/KeyDetector';

// ── The Blackboard Data Structure ────────────────────────────

export interface Blackboard {
  // ── Tick metadata ──────────────────────────────────────────
  /** Monotonic tick counter (for debouncing / cooldowns). */
  tick: number;
  /** Wall-clock timestamp of this snapshot (performance.now()). */
  timestamp: number;

  // ── Deck role assignment ───────────────────────────────────
  /** Which deck is currently the loudest / driving the floor. */
  masterDeck: DeckId;
  /** The other deck. */
  incomingDeck: DeckId;

  // ── Master deck metrics ────────────────────────────────────
  masterState: Readonly<DeckState>;
  masterCurrentTime: number;         // seconds
  masterCurrentBeat: number;         // beat number on the grid
  masterTotalBeats: number;          // total beats in the track
  /** Beats remaining until the calculated mix-out point. */
  beatsToOutroMaster: number;
  /** Beats remaining until the raw end of the audio file. */
  beatsToEndMaster: number;
  masterBpm: number;
  masterBeatPeriod: number;          // seconds per beat (60/bpm)

  // ── Incoming deck metrics ──────────────────────────────────
  incomingState: Readonly<DeckState>;
  incomingCurrentTime: number;
  incomingCurrentBeat: number;
  incomingBpm: number;
  incomingIsReady: boolean;          // has track + BPM

  // ── Cross-deck relationships ───────────────────────────────
  /** True if both decks are playing simultaneously. */
  bothPlaying: boolean;
  /** True if the beatgrids are phase-aligned (within ±50 ms). */
  isPhaseAligned: boolean;
  /**
   * Continuous phase error in milliseconds (0 = perfect alignment).
   * Positive = incoming is behind master, negative = ahead.
   * Only valid when both decks are playing with valid BPM.
   */
  phaseDeltaMs: number;
  /** Both decks have bass > -10 dB (potential frequency clash). */
  bassClash: boolean;
  /** Both decks have mid > -6 dB (potential vocal/synth mud). */
  midClash: boolean;

  // ── Energy / safety ────────────────────────────────────────
  /** Master deck has an active loop. */
  masterHasLoop: boolean;
  /** True if the master track is about to end (< 8 beats). */
  deadAirImminent: boolean;

  // ── Rhythmic position ───────────────────────────────────────
  /** Master beat position within the current phrase (0–15.99). */
  masterBeatInPhrase: number;
  /** Beats until the next 16-beat phrase boundary. */
  masterBeatsToPhrase: number;
  /** Incoming beat position within current phrase (0–15.99). */
  incomingBeatInPhrase: number;
  /** True if master is on a downbeat (beat mod 4 < 0.5). */
  masterOnDownbeat: boolean;

  // ── Volume / energy ────────────────────────────────────────
  /** Both decks have high volume (> 0.5) — actively blending. */
  isBlending: boolean;
  /** Incoming bass is killed (EQ low < -15 dB). */
  incomingBassKilled: boolean;
  /** Master bass is killed (EQ low < -15 dB). */
  masterBassKilled: boolean;
  /**
   * How many consecutive ticks the master bass has been < -15 dB.
   * Resets to 0 when bass returns above threshold.
   */
  masterBassKilledTicks: number;
  /**
   * How many consecutive ticks the incoming bass has been < -15 dB.
   */
  incomingBassKilledTicks: number;
  /** Master color FX has been applied (> 0.3 or < -0.3). */
  masterHasFilter: boolean;

  // ── Drop detection ─────────────────────────────────────────
  /** Beat number of the master track's first (strongest) drop. */
  masterDropBeat: number | null;
  /** Beat number of the incoming track's first drop. */
  incomingDropBeat: number | null;
  /** Beats remaining until the incoming track's drop. */
  beatsToIncomingDrop: number | null;

  // ── Key / harmonic mixing ──────────────────────────────────
  /** Camelot key of master deck (e.g. "8A"). */
  masterKey: string;
  /** Camelot key of incoming deck. */
  incomingKey: string;
  /** True if both keys are harmonically compatible (Camelot ±1). */
  isHarmonicMatch: boolean;

  // ── Store reference (for intents that need non-derived data) ─
  crossfader: number;
  masterVolume: number;
}

// ── Blackboard Builder ───────────────────────────────────────

let _tickCounter = 0;

// ── Persistent accumulators (survive across ticks) ───────────
// Keyed by deck ID so role-swaps don't corrupt the count.
const _bassKilledTicks: Record<DeckId, number> = { A: 0, B: 0 };

/**
 * Compute a fresh Blackboard snapshot from the current
 * Zustand store state and MixiEngine transport positions.
 *
 * Called once per tick by AutoMixEngine.
 * All derived values are computed here so intents stay fast.
 */
export function computeBlackboard(): Blackboard {
  const store = useMixiStore.getState();
  const engine = MixiEngine.getInstance();
  const tick = ++_tickCounter;

  // ── Determine deck roles ───────────────────────────────────
  // The "master" is the deck with the higher effective volume
  // (volume × crossfader contribution).  If neither is playing,
  // default to A.
  const aDeck = store.decks.A;
  const bDeck = store.decks.B;

  let masterDeck: DeckId;
  if (aDeck.isPlaying && !bDeck.isPlaying) {
    masterDeck = 'A';
  } else if (bDeck.isPlaying && !aDeck.isPlaying) {
    masterDeck = 'B';
  } else {
    // Both playing (or neither): the louder one is master.
    masterDeck = aDeck.volume >= bDeck.volume ? 'A' : 'B';
  }
  const incomingDeck: DeckId = masterDeck === 'A' ? 'B' : 'A';

  const ms = store.decks[masterDeck];
  const is = store.decks[incomingDeck];

  // ── Time & beat calculations ───────────────────────────────

  const masterTime = engine.isInitialized
    ? engine.getCurrentTime(masterDeck) : 0;
  const incomingTime = engine.isInitialized
    ? engine.getCurrentTime(incomingDeck) : 0;

  const masterBpm = ms.bpm > 0 ? ms.bpm : 120;
  const masterBeatPeriod = 60 / masterBpm;

  const masterBeat = ms.bpm > 0
    ? timeToBeat(masterTime, ms.bpm, ms.firstBeatOffset) : 0;
  const masterTotalBeats = ms.bpm > 0
    ? timeToBeat(ms.duration, ms.bpm, ms.firstBeatOffset) : 0;

  const mixOutBeat = calcMixOutBeat(ms.duration, ms.bpm, ms.firstBeatOffset);
  const beatsToOutro = mixOutBeat - masterBeat;
  const beatsToEnd = masterTotalBeats - masterBeat;

  const incomingBeat = is.bpm > 0
    ? timeToBeat(incomingTime, is.bpm, is.firstBeatOffset) : 0;

  // ── Phase alignment ────────────────────────────────────────
  //
  // Two beatgrids are "in phase" if the fractional beat position
  // of each deck differs by less than ~50 ms.
  //
  //   fractA = masterBeat % 1
  //   fractB = incomingBeat % 1
  //   phaseDelta = min(|fractA - fractB|, 1 - |fractA - fractB|)
  //   aligned if phaseDelta * beatPeriod < 0.05 s

  let isPhaseAligned = false;
  let phaseDeltaMs = 0;
  if (ms.bpm > 0 && is.bpm > 0 && ms.isPlaying && is.isPlaying) {
    const fractA = ((masterBeat % 1) + 1) % 1;
    const fractB = ((incomingBeat % 1) + 1) % 1;
    // Signed delta: positive = incoming is behind master
    let signedDelta = fractA - fractB;
    if (signedDelta > 0.5) signedDelta -= 1;
    if (signedDelta < -0.5) signedDelta += 1;
    const absDelta = Math.abs(signedDelta);
    phaseDeltaMs = signedDelta * masterBeatPeriod * 1000;
    isPhaseAligned = absDelta * masterBeatPeriod < 0.05;
  }

  // ── Frequency clash detection ──────────────────────────────

  const bothPlaying = ms.isPlaying && is.isPlaying;
  const bassClash = bothPlaying && ms.eq.low > -10 && is.eq.low > -10;
  const midClash = bothPlaying && ms.eq.mid > -6 && is.eq.mid > -6;

  // ── Rhythmic position ──────────────────────────────────────
  const masterBeatInPhrase = ((masterBeat % 16) + 16) % 16;
  const masterBeatsToPhrase = 16 - masterBeatInPhrase;
  const incomingBeatInPhrase = ((incomingBeat % 16) + 16) % 16;
  const masterOnDownbeat = (masterBeat % 4 + 4) % 4 < 0.5;

  // ── Blending state ─────────────────────────────────────────
  const isBlending = bothPlaying && ms.volume > 0.5 && is.volume > 0.5;
  const incomingBassKilled = is.eq.low < -15;
  const masterBassKilled = ms.eq.low < -15;
  const masterHasFilter = Math.abs(ms.colorFx) > 0.3;

  // ── Bass-killed duration accumulators ──────────────────────
  // Track per physical deck so a master/incoming role swap
  // doesn't reset the counter.
  for (const d of ['A', 'B'] as const) {
    _bassKilledTicks[d] = store.decks[d].eq.low < -15
      ? _bassKilledTicks[d] + 1
      : 0;
  }

  // ── Drop positions ──────────────────────────────────────────
  const masterDropBeat = ms.dropBeats.length > 0 ? ms.dropBeats[0] : null;
  const incomingDropBeat = is.dropBeats.length > 0 ? is.dropBeats[0] : null;
  const beatsToIncomingDrop = incomingDropBeat !== null && is.bpm > 0
    ? incomingDropBeat - incomingBeat
    : null;

  // ── Harmonic compatibility ───────────────────────────────
  const masterKey = ms.musicalKey || '';
  const incomingKey = is.musicalKey || '';
  const harmonicMatch = masterKey && incomingKey
    ? isHarmonicMatch(masterKey, incomingKey)
    : false;

  return {
    tick,
    timestamp: performance.now(),

    masterDeck,
    incomingDeck,

    masterState: ms,
    masterCurrentTime: masterTime,
    masterCurrentBeat: masterBeat,
    masterTotalBeats,
    beatsToOutroMaster: beatsToOutro,
    beatsToEndMaster: beatsToEnd,
    masterBpm,
    masterBeatPeriod,

    incomingState: is,
    incomingCurrentTime: incomingTime,
    incomingCurrentBeat: incomingBeat,
    incomingBpm: is.bpm,
    incomingIsReady: is.isTrackLoaded && is.bpm > 0,

    bothPlaying,
    isPhaseAligned,
    phaseDeltaMs,
    bassClash,
    midClash,

    masterHasLoop: ms.activeLoop !== null,
    deadAirImminent: ms.isPlaying && beatsToEnd < 8 && beatsToEnd > 0,

    masterBeatInPhrase,
    masterBeatsToPhrase,
    incomingBeatInPhrase,
    masterOnDownbeat,

    isBlending,
    incomingBassKilled,
    masterBassKilled,
    masterBassKilledTicks: _bassKilledTicks[masterDeck],
    incomingBassKilledTicks: _bassKilledTicks[incomingDeck],
    masterHasFilter,

    masterDropBeat,
    incomingDropBeat,
    beatsToIncomingDrop,

    masterKey,
    incomingKey,
    isHarmonicMatch: harmonicMatch,

    crossfader: store.crossfader,
    masterVolume: store.master.volume,
  };
}
