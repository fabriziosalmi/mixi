/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Drop Swap Intent (The Bass Swap)
//
// DOMAIN: Spectral
// PRIORITY: 0.9 (high — this is THE move in techno)
//
// The iconic techno bass swap: at the exact moment the
// incoming track's phrase boundary arrives (every 16 beats),
// kill the bass on the outgoing and restore it on the incoming.
//
// Trigger:
//   Both decks playing AND
//   Both volumes > 0.5 (we're mid-blend) AND
//   Incoming deck's bass is still killed (< -15 dB) AND
//   Current beat is on a phrase boundary (beat % 16 < 0.5)
//
// Action:
//   Instant snap (10 ms via smoothParam):
//     - Master (outgoing) EQ Low → -26 dB (kill)
//     - Incoming EQ Low → 0 dB (restore)
//
// WHY phrase boundaries:
//   In techno/house, musical phrases are 16 beats (4 bars).
//   Swapping bass mid-phrase sounds "wrong" to the dancer's
//   brain — they expect structural changes on the 1.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';
import { log } from '../../utils/logger';

export const DropSwapIntent: BaseIntent = {
  name: 'spectral.drop_swap',
  domain: 'spectral',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    // Pre-conditions: both decks must be playing at volume.
    if (!bb.bothPlaying) return 0;
    if (bb.masterState.volume < 0.5 || bb.incomingState.volume < 0.5) return 0;

    // The incoming bass must still be killed (waiting for the swap).
    if (bb.incomingState.eq.low > -15) return 0;

    // Master bass must be alive — no point swapping if already killed.
    if (bb.masterState.eq.low < -10) return 0;

    // Must be on a phrase boundary: beat number mod 16 is near 0.
    // We use a ±0.5 beat window to account for tick timing.
    const incomingBeatMod = ((bb.incomingCurrentBeat % 16) + 16) % 16;
    const onPhraseBoundary = incomingBeatMod < 0.5 || incomingBeatMod > 15.5;

    if (!onPhraseBoundary) return 0;

    return 0.9;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    // Kill outgoing bass, restore incoming bass — simultaneously.
    store.setDeckEq(bb.masterDeck, 'low', -26);
    store.setDeckEq(bb.incomingDeck, 'low', 0);
    log.success('AI', `DROP SWAP — ${bb.incomingDeck} takes the bass from ${bb.masterDeck}`);
  },
};
