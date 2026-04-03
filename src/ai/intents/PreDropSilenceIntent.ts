/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Dynamics – Pre-Drop Silence
//
// The ultimate tension builder: cut ALL volume for a fraction
// of a beat right before the bass swap / drop.
//
// When the crowd expects the kick to hit and gets silence
// instead, the dopamine spike on the actual drop is amplified
// tenfold.  Classic Tekno/Techno trick.
//
// Trigger: Both playing, incoming bass killed,
//          exactly 1 beat before a phrase boundary.
//
// Action: Set both volumes to 0.  The DropSwapIntent will fire
//         on the next tick (score 0.9) and restore everything.
//
// Score: 0.95 — higher than filter washout, lower than safety.
//        Must fire BEFORE the drop swap.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

export const PreDropSilenceIntent: BaseIntent = {
  name: 'dynamics.pre_drop_silence',
  domain: 'dynamics',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (!bb.incomingBassKilled) return 0;
    if (bb.masterState.volume < 0.5) return 0;

    // Fire when we're within the last beat of the phrase.
    // beatsToPhrase between 0.3 and 1.0 = the "just before" window.
    if (bb.masterBeatsToPhrase > 1.0 || bb.masterBeatsToPhrase < 0.3) return 0;

    return 0.95;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    store.setDeckVolume(bb.masterDeck, 0);
    store.setDeckVolume(bb.incomingDeck, 0);
  },
};
