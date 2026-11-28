/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Rhythm – Loop Roll Buildup
//
// The "machine gun" effect: a cascade of shrinking loops on
// the master deck as the drop approaches.
//
//   16 beats out → loop(4)
//    8 beats out → loop(2)
//    4 beats out → loop(1)
//    2 beats out → loop(0.5)
//    0 beats     → exit loop (let the drop hit)
//
// Each step halves the loop, doubling the rhythmic density.
// The crowd hears the pattern tighten until it becomes a
// stuttering roll, then the full kick drops.
//
// Score: 0.75 — high enough to override basic FX but lower
//        than bass swap or safety.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Wall-clock roll tracker so looping masterCurrentBeat never traps the deck (AUD-04). */
let rollActive = false;
let rollStartMs = 0;
let rollTotalBeats = 0;

export function resetLoopRollState(): void {
  rollActive = false;
  rollStartMs = 0;
  rollTotalBeats = 0;
}

export const LoopRollBuildupIntent: BaseIntent = {
  name: 'rhythm.loop_roll_buildup',
  domain: 'rhythm',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    if (!bb.masterState.isPlaying) {
      rollActive = false;
      return 0;
    }
    if (rollActive) return 0.75;
    if (bb.masterBeatsToPhrase > 16) return 0;
    // Only during an active blend (incoming is ready).
    if (!bb.incomingIsReady) return 0;
    if (bb.beatsToOutroMaster > 32) return 0; // Too early.
    return 0.75;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    const now = bb.timestamp;
    if (!rollActive) {
      if (bb.masterBeatsToPhrase <= 0.5) {
        if (bb.masterHasLoop && bb.beatsToEndMaster > 8) {
          store.exitLoop(bb.masterDeck);
        }
        return;
      }
      rollActive = true;
      rollStartMs = now;
      rollTotalBeats = bb.masterBeatsToPhrase;
    }

    const beatMs = Math.max(200, bb.masterBeatPeriod * 1000);
    const elapsedBeats = Math.max(0, (now - rollStartMs) / beatMs);
    const remainingBeats = rollTotalBeats - elapsedBeats;

    if (remainingBeats <= 0.5) {
      // Drop! Exit the loop — BUT not if we're near the end of
      // the track (< 8 beats). SafetyLoopIntent needs to keep
      // its emergency loop active. Let SafetyLoop manage it.
      if (bb.masterHasLoop && bb.beatsToEndMaster > 8) {
        store.exitLoop(bb.masterDeck);
      }
      rollActive = false;
      return;
    }

    // Select loop size based on wall-clock countdown.
    let beats: number;
    if (remainingBeats <= 2) beats = 0.5;
    else if (remainingBeats <= 4) beats = 1;
    else if (remainingBeats <= 8) beats = 2;
    else beats = 4;

    // Only change if the loop size differs from current.
    const current = bb.masterState.activeLoop;
    if (!current || current.lengthInBeats !== beats) {
      if (current) store.exitLoop(bb.masterDeck);
      store.setAutoLoop(bb.masterDeck, beats);
    }
  },
};
