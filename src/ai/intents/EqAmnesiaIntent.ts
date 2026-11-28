/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Safety – EQ Amnesia Recovery (Bass Recovery Guard)
//
// Detects the classic DJ mistake: cutting the bass for a blend,
// then forgetting to bring it back after the transition.
//
// If a deck is playing solo (no blend) and its bass has been
// killed for > 32 ticks (~1.6 seconds at 20 Hz tick rate,
// approximately 2+ bars at 128 BPM), the intent gradually
// restores the bass EQ to 0 dB over several ticks.
//
// The restoration is gentle (+2 dB per tick ≈ +40 dB/sec)
// so it sounds like a smooth fade-in rather than a snap.
//
// Score: 0.85 — high priority (safety) but below dead air
//   prevention (1.0) and redline limiter (0.92).
//
// Domain: safety, exclusive: false (can stack with phase
//   correction or redline limiter).
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Ticks before we consider bass "forgotten" (~1.6 s). */
const AMNESIA_THRESHOLD_TICKS = 32;

/** dB to add per tick during recovery (+1 dB × 20 Hz = 20 dB/s).
 *  From -26 dB to 0 takes 26 ticks = 1.3s (~2 beats at 128 BPM). */
const RECOVERY_STEP_DB = 1;

/** Target EQ level to restore to (0 dB = flat). */
const TARGET_DB = 0;

/** Active recovery ownership so recovery continues past -15 dB all the way to 0 dB (AUD-10). */
let isRecovering = false;

export function resetEqAmnesiaState(): void {
  isRecovering = false;
}

export const EqAmnesiaIntent: BaseIntent = {
  name: 'safety.eq_amnesia_recovery',
  domain: 'safety',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.masterState.isPlaying) {
      isRecovering = false;
      return 0;
    }
    if (bb.isBlending || (bb.bothPlaying && bb.incomingState.volume > 0.15)) {
      isRecovering = false;
      return 0;
    }

    // Once recovery starts, keep scoring until bass reaches TARGET_DB (0 dB).
    if (isRecovering) {
      if (bb.masterState.eq.low >= TARGET_DB - 0.01) {
        isRecovering = false;
        return 0;
      }
      return 0.8;
    }

    if (!bb.masterBassKilled) return 0;
    if (bb.masterBassKilledTicks < AMNESIA_THRESHOLD_TICKS) return 0;

    // Scale score: longer forgotten → higher urgency, cap at 0.85.
    const overshoot = bb.masterBassKilledTicks - AMNESIA_THRESHOLD_TICKS;
    return Math.min(0.85, 0.7 + overshoot * 0.005);
  },

  execute(bb: Blackboard, store: MixiStore): void {
    isRecovering = true;
    const current = bb.masterState.eq.low;
    const next = Math.min(TARGET_DB, current + RECOVERY_STEP_DB);
    store.setDeckEq(bb.masterDeck, 'low', next);
    if (next >= TARGET_DB - 0.01) {
      isRecovering = false;
    }
  },
};
