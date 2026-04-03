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
// then snap them back at the next phrase boundary.
//
// This creates a dramatic "vacuum" effect — the track thins
// to a ghostly residual, then EXPLODES back to full power.
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

export const IsolatorSweepIntent: BaseIntent = {
  name: 'spectral.isolator_sweep',
  domain: 'spectral',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    // Only when master is solo.
    if (bb.bothPlaying) return 0;
    if (!bb.masterState.isPlaying) return 0;
    // EQ must be roughly flat to start the sweep.
    const eq = bb.masterState.eq;
    if (Math.abs(eq.low) > 3 || Math.abs(eq.mid) > 3 || Math.abs(eq.high) > 3) return 0;
    // Within the last 8 beats of the phrase.
    if (bb.masterBeatsToPhrase > 8) return 0;
    return 0.35;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    const btp = bb.masterBeatsToPhrase;

    if (btp < 0.5) {
      // Snap back to flat at the phrase boundary.
      store.setDeckEq(bb.masterDeck, 'low', 0);
      store.setDeckEq(bb.masterDeck, 'mid', 0);
      store.setDeckEq(bb.masterDeck, 'high', 0);
      return;
    }

    // Progressive sweep: 8 beats → -20 dB on all bands.
    const progress = 1 - btp / 8;
    const dbValue = -20 * progress;
    store.setDeckEq(bb.masterDeck, 'low', dbValue);
    store.setDeckEq(bb.masterDeck, 'mid', dbValue);
    store.setDeckEq(bb.masterDeck, 'high', dbValue);
  },
};
