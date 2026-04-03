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
// When both decks have active bass (> -10 dB), two sub-bass
// signals overlap and create "mud" — a boomy, undefined low end.
//
// This intent reduces the incoming deck's bass to -15 dB,
// leaving the "punch" (the transient click of the kick) audible
// but removing the sustained sub-bass tail that causes mud.
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
    return 0.7;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    store.setDeckEq(bb.incomingDeck, 'low', -15);
  },
};
