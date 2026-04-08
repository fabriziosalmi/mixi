/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Spectral – Isolator Sweep
//
// During a breakdown (master playing solo, low energy section),
// sweep all 3 EQ bands down simultaneously on the master deck,
// then ramp them back up over 2 beats at the phrase boundary.
//
// This creates a dramatic "vacuum" effect — the track thins
// to a ghostly residual, then EXPLODES back to full power.
//
// v2 changes:
//   - Replaced instant snap-back with 2-beat ramp-up (no click)
//   - Added 128-beat cooldown (no sweep every phrase)
//   - Smooth cosine curve on sweep and recovery
//
// Trigger: Master playing solo (incoming not audible),
//          within 8 beats of a phrase boundary,
//          master EQ is currently flat.
//
// Score: 0.35 — decorative, won't override critical intents.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Min beats between sweeps (128 beats = 8 phrases at 4/4). */
const COOLDOWN_TICKS = 128 * 4; // ~128 beats at 20Hz = 2560 ticks (conservative)
let lastSweepEndTick = -COOLDOWN_TICKS;

/** Track whether we're in the recovery phase (ramping back up). */
let isRecovering = false;
let recoveryStartBeat = 0;
const RECOVERY_BEATS = 2; // Ramp back over 2 beats (no click).

export const IsolatorSweepIntent: BaseIntent = {
  name: 'spectral.isolator_sweep',
  domain: 'spectral',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    // ── Recovery phase: keep scoring to finish the ramp-up ──
    if (isRecovering) {
      if (!bb.masterState.isPlaying) {
        isRecovering = false;
        return 0;
      }
      const beatsSinceRecovery = bb.masterCurrentBeat - recoveryStartBeat;
      if (beatsSinceRecovery >= RECOVERY_BEATS) {
        isRecovering = false;
        lastSweepEndTick = bb.tick;
        return 0; // Done — EQ is back to flat.
      }
      return 0.35; // Keep scoring during recovery.
    }

    // Only when master is solo.
    if (bb.bothPlaying) return 0;
    if (!bb.masterState.isPlaying) return 0;
    // Cooldown: don't sweep too often.
    if (bb.tick - lastSweepEndTick < COOLDOWN_TICKS) return 0;
    // EQ must be roughly flat to start the sweep.
    const eq = bb.masterState.eq;
    if (Math.abs(eq.low) > 3 || Math.abs(eq.mid) > 3 || Math.abs(eq.high) > 3) return 0;
    // Within the last 8 beats of the phrase.
    if (bb.masterBeatsToPhrase > 8) return 0;
    return 0.35;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    // ── Recovery phase: ramp EQ back to 0 over RECOVERY_BEATS ──
    if (isRecovering) {
      const beatsSinceRecovery = bb.masterCurrentBeat - recoveryStartBeat;
      const progress = Math.min(1, beatsSinceRecovery / RECOVERY_BEATS);
      // Cosine ease-in: smooth ramp from -20 dB to 0 dB.
      const dbValue = -20 * (1 - progress);
      store.setDeckEq(bb.masterDeck, 'low', dbValue);
      store.setDeckEq(bb.masterDeck, 'mid', dbValue);
      store.setDeckEq(bb.masterDeck, 'high', dbValue);
      return;
    }

    const btp = bb.masterBeatsToPhrase;

    if (btp < 0.5) {
      // Phrase boundary reached — start recovery (ramp back up).
      isRecovering = true;
      recoveryStartBeat = bb.masterCurrentBeat;
      return;
    }

    // Progressive sweep: 8 beats → -20 dB on all bands.
    // Cosine curve for smooth onset.
    const progress = 1 - btp / 8;
    const smoothProgress = 0.5 * (1 - Math.cos(progress * Math.PI));
    const dbValue = -20 * smoothProgress;
    store.setDeckEq(bb.masterDeck, 'low', dbValue);
    store.setDeckEq(bb.masterDeck, 'mid', dbValue);
    store.setDeckEq(bb.masterDeck, 'high', dbValue);
  },
};
