/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Safety – Phase Drift Correction (v3)
//
// Even when BPMs match, beatgrids can drift out of phase due
// to floating-point accumulation in AudioContext timing.
//
// This intent uses the continuous phase error (phaseDeltaMs)
// from the Blackboard to apply a proportional pitch nudge:
//
//   - Small drift (10–30 ms): gentle 0.5% nudge for 4 ticks
//   - Medium drift (30–80 ms): 1% nudge for 6 ticks
//   - Large drift (>80 ms):    2% nudge for 8 ticks
//
// v3 changes from v2:
//   - Replaced setTimeout with tick-based state (no stale closures)
//   - Reads current playbackRate on restore (not captured rate)
//   - Stores nudge target deck ID (survives role swaps)
//   - Reset function for engine stop/restart
//
// Score: 0.85 — high priority, just below bass swap.
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../../types';
import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Ticks to wait between corrections (debounce). */
const COOLDOWN_TICKS = 20;

/** Minimum phase error to trigger correction (ms). */
const THRESHOLD_MS = 10;

// ── Tick-based state (no timeouts, no stale closures) ────────
let lastCorrectionTick = 0;
let nudgeActive = false;
let nudgeDeck: DeckId = 'B';
let nudgeDirection = 1;       // +1 = speed up, -1 = slow down
let nudgePercent = 0;
let nudgeEndTick = 0;
let preNudgeRate = 1.0;       // rate BEFORE the nudge was applied

export const PhaseDriftCorrectionIntent: BaseIntent = {
  name: 'safety.phase_drift_correction',
  domain: 'safety',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    // ── Active nudge: keep scoring > 0 to maintain the correction ──
    if (nudgeActive) {
      if (bb.tick >= nudgeEndTick) {
        // Nudge duration elapsed — restore rate on next execute.
        return 0.6; // Score to trigger the restore.
      }
      // Still nudging — keep the correction active.
      return 0.6;
    }

    if (!bb.bothPlaying) return 0;
    if (bb.incomingState.volume < 0.3) return 0; // Not audible yet.
    if (bb.tick - lastCorrectionTick < COOLDOWN_TICKS) return 0;

    const absMs = Math.abs(bb.phaseDeltaMs);
    if (absMs < THRESHOLD_MS) return 0; // Within tolerance.

    // Score scales with drift magnitude.
    return Math.min(0.9, 0.6 + (absMs / 200));
  },

  execute(bb: Blackboard, store: MixiStore): void {
    // ── Restore after nudge duration ─────────────────────────
    if (nudgeActive && bb.tick >= nudgeEndTick) {
      // Read the CURRENT state's rate (not a stale capture).
      // Restore to the synced rate (1.0 if synced, or whatever the
      // store currently has minus our nudge contribution).
      const currentRate = store.decks?.[nudgeDeck]?.playbackRate ?? 1.0;
      const estimatedNudge = nudgeDirection * nudgePercent;
      const restoredRate = currentRate / (1 + estimatedNudge);
      store.setDeckPlaybackRate(nudgeDeck, restoredRate);
      nudgeActive = false;
      return;
    }

    // ── Don't start a new nudge if one is active ─────────────
    if (nudgeActive) {
      // Keep applying the nudge (in case something else reset the rate).
      const targetRate = preNudgeRate * (1 + nudgeDirection * nudgePercent);
      store.setDeckPlaybackRate(nudgeDeck, targetRate);
      return;
    }

    // ── Start a new nudge ────────────────────────────────────
    lastCorrectionTick = bb.tick;
    nudgeActive = true;
    nudgeDeck = bb.incomingDeck;
    preNudgeRate = bb.incomingState.playbackRate;

    const absMs = Math.abs(bb.phaseDeltaMs);

    // Proportional nudge: larger drift → stronger + longer correction.
    let durationTicks: number;
    if (absMs < 30) {
      nudgePercent = 0.005;  // 0.5%
      durationTicks = 4;     // 200ms at 50ms tick
    } else if (absMs < 80) {
      nudgePercent = 0.01;   // 1%
      durationTicks = 6;     // 300ms
    } else {
      nudgePercent = 0.02;   // 2%
      durationTicks = 8;     // 400ms
    }

    // phaseDeltaMs > 0 means incoming is behind → speed up.
    nudgeDirection = bb.phaseDeltaMs > 0 ? 1 : -1;
    nudgeEndTick = bb.tick + durationTicks;

    const targetRate = preNudgeRate * (1 + nudgeDirection * nudgePercent);
    store.setDeckPlaybackRate(nudgeDeck, targetRate);
  },
};

/** Reset module state (call on engine stop). */
export function resetPhaseDriftState(): void {
  lastCorrectionTick = 0;
  nudgeActive = false;
  nudgeEndTick = 0;
}
