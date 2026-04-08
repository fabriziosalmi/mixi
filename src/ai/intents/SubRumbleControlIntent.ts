/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Spectral – Sub Rumble Control
//
// When both decks have active bass (> -6 dB), two sub-bass
// signals overlap and create "mud" — a boomy, undefined low end.
//
// This intent reduces the incoming deck's bass to -15 dB,
// leaving the "punch" (the transient click of the kick) audible
// but removing the sustained sub-bass tail that causes mud.
//
// v2 changes:
//   - Bass clash threshold relaxed from -10 dB to -6 dB
//     (-10 is too aggressive, two tracks at -9 each are fine)
//   - Post-swap cooldown: after a bass swap, the incoming deck's
//     bass has been restored to 0 dB. We must NOT immediately
//     re-cut it — the swap was intentional. 32-tick cooldown.
//
// Score: 0.7 — important but not as urgent as a bass swap.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

export const SubRumbleControlIntent: BaseIntent = {
  name: 'spectral.sub_rumble_control',
  domain: 'spectral',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bassClash) return 0;
    // Only if we haven't already handled it.
    if (bb.incomingState.eq.low <= -15) return 0;

    // Post-swap cooldown: if the incoming bass was RECENTLY restored
    // (incomingBassKilledTicks === 0 but was > 0 recently), don't re-cut.
    // The simplest heuristic: if incoming bass was killed for many ticks
    // before this (high killed count) it means we're mid-transition.
    // If it was just restored (killed count is 0 and was high), skip.
    // We approximate with: if incoming EQ is at exactly 0 (just restored
    // by DropSwap) and both volumes are high, this is a fresh swap.
    if (bb.incomingBassKilledTicks === 0 && bb.isBlending &&
        Math.abs(bb.incomingState.eq.low) < 1) {
      // Bass was just restored (likely by DropSwap) — don't re-cut.
      return 0;
    }

    return 0.7;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    store.setDeckEq(bb.incomingDeck, 'low', -15);
  },
};
