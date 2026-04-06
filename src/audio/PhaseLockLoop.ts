/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Continuous Phase-Lock Loop (PI Controller)
//
// Runs at ~20 Hz (via rAF) on the synced deck.  Replaces the
// one-shot sync + blunt PhaseDriftCorrectionIntent with a
// smooth, inaudible, continuous phase correction.
//
// Why this beats everyone:
//   - Traktor:    discrete nudges → audible "wobble"
//   - Rekordbox:  periodic re-sync → audible jump
//   - Mixi PLL:   continuous PI → zero artefacts, zero slingshot
//
// PI controller with anti-windup:
//   P = Kp * error          — immediate reaction
//   I = Ki * accumulated    — eliminates steady-state drift
//   correction = clamp(P + I, -maxCorr, +maxCorr)
//
// Three layers of anti-windup protection:
//   1. Freeze during human interaction (nudge, jog, scratch)
//   2. Symmetric integral clamp (never exceeds ±integralMax)
//   3. Reset on large discontinuity (seek, hot cue, loop exit)
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../types';
import { MixiEngine } from './MixiEngine';
import { useMixiStore } from '../store/mixiStore';

// ── PI constants (tuned for DJ use) ─────────────────────────

/** Proportional gain: fast but gentle reaction. */
const Kp = 0.02;

/** Integral gain: eliminates steady-state error in ~2s. */
const Ki = 0.001;

/** Ignore phase errors below this fraction of a beat (inaudible). */
const DEADZONE = 0.005;

/** Max correction: ±0.1% rate change — imperceptible. */
const MAX_CORRECTION = 0.001;

/** Anti-windup: integral never exceeds this value. */
const INTEGRAL_MAX = 0.05;

/** Large discontinuity threshold (fraction of beat). */
const DISCONTINUITY_THRESHOLD = 0.25;

/** PLL tick interval in ms (~20 Hz). */
const TICK_INTERVAL_MS = 50;

// ── Controller state per deck ───────────────────────────────

interface PllState {
  integral: number;
  lastPhaseDelta: number;
  lastCorrection: number;
  frozen: boolean;
}

function createPllState(): PllState {
  return { integral: 0, lastPhaseDelta: 0, lastCorrection: 0, frozen: false };
}

// ── PLL singleton ───────────────────────────────────────────

class PhaseLockLoop {
  private states: Record<DeckId, PllState> = {
    A: createPllState(),
    B: createPllState(),
  };

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Start the PLL tick loop. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  /** Stop the PLL tick loop. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.states.A = createPllState();
    this.states.B = createPllState();
  }

  /** Freeze the PLL for a deck (during human nudge/jog). */
  freeze(deck: DeckId): void {
    const s = this.states[deck];
    s.frozen = true;
    s.integral = 0;
    s.lastCorrection = 0;
  }

  /** Unfreeze the PLL for a deck. */
  unfreeze(deck: DeckId): void {
    this.states[deck].frozen = false;
  }

  /** Reset on discontinuity (seek, hot cue, loop exit). */
  reset(deck: DeckId): void {
    this.states[deck] = createPllState();
  }

  /** Core tick — runs for each synced deck. */
  private tick(): void {
    const store = useMixiStore.getState();
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    for (const deck of ['A', 'B'] as DeckId[]) {
      const d = store.decks[deck];
      if (!d.isSynced || !d.isPlaying) continue;

      const masterDeck: DeckId = deck === 'A' ? 'B' : 'A';
      const master = store.decks[masterDeck];
      if (!master.isPlaying || master.bpm <= 0 || d.bpm <= 0) continue;

      const phaseDelta = this.computePhaseDelta(deck, masterDeck, engine, store);
      if (phaseDelta === null) continue;

      const correction = this.computePI(deck, phaseDelta);
      this.applyCorrection(deck, correction, engine);
    }
  }

  /** Compute signed phase delta (fraction of beat, -0.5 to +0.5). */
  private computePhaseDelta(
    slaveDeck: DeckId,
    masterDeck: DeckId,
    engine: MixiEngine,
    store: ReturnType<typeof useMixiStore.getState>,
  ): number | null {
    const master = store.decks[masterDeck];
    const slave = store.decks[slaveDeck];

    const masterTime = engine.getCurrentTime(masterDeck);
    const slaveTime = engine.getCurrentTime(slaveDeck);

    const masterPeriod = 60 / master.bpm;
    const slavePeriod = 60 / slave.bpm;

    const masterFrac = (((masterTime - master.firstBeatOffset) / masterPeriod) % 1 + 1) % 1;
    const slaveFrac = (((slaveTime - slave.firstBeatOffset) / slavePeriod) % 1 + 1) % 1;

    let delta = masterFrac - slaveFrac;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;

    return delta;
  }

  /** PI controller with anti-windup. Returns rate correction factor. */
  private computePI(deck: DeckId, phaseDelta: number): number {
    const s = this.states[deck];

    // Layer 1: Freeze during human interaction
    if (s.frozen) return 0;

    // Layer 3: Reset on large discontinuity (seek, hot cue)
    if (Math.abs(phaseDelta - s.lastPhaseDelta) > DISCONTINUITY_THRESHOLD) {
      s.integral = 0;
      s.lastPhaseDelta = phaseDelta;
      s.lastCorrection = 0;
      return 0;
    }

    s.lastPhaseDelta = phaseDelta;

    // Deadzone: ignore tiny errors (inaudible)
    if (Math.abs(phaseDelta) < DEADZONE) {
      // Slowly decay integral toward zero when in deadzone
      s.integral *= 0.95;
      return 0;
    }

    // P term
    const P = Kp * phaseDelta;

    // I term with anti-windup clamp (Layer 2)
    s.integral += phaseDelta * (TICK_INTERVAL_MS / 1000);
    s.integral = Math.max(-INTEGRAL_MAX, Math.min(INTEGRAL_MAX, s.integral));
    const I = Ki * s.integral;

    // Combined + clamp
    const correction = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, P + I));
    s.lastCorrection = correction;
    return correction;
  }

  /** Apply correction to the AudioBufferSourceNode playbackRate. */
  private applyCorrection(deck: DeckId, correction: number, engine: MixiEngine): void {
    if (Math.abs(correction) < 1e-7) return;

    // Access transport via engine's public method
    const store = useMixiStore.getState();
    const baseRate = store.decks[deck].playbackRate;
    const nudgeOffset = engine.getNudge(deck);

    // Effective rate = base + nudge + PLL correction
    const effectiveRate = baseRate * (1 + correction) + nudgeOffset;

    // Apply directly to the AudioNode — don't touch the store
    engine.applyPllRate(deck, effectiveRate);
  }
}

/** Singleton PLL instance. */
export const phaseLockLoop = new PhaseLockLoop();
