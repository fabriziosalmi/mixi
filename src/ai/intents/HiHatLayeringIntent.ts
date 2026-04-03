/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Spectral – Hi-Hat Layering
//
// Before the full blend, layer only the highs of the incoming
// track over the master.  This adds "frizzantezza" (sparkle)
// without frequency conflicts in the bass/mid range.
//
// Trigger: ~48 beats before mix-out, incoming track loaded,
//          incoming bass already killed, highs still down.
//
// Action: Bring incoming EQ High to 0 dB (flat), keep low/mid
//         at their killed values.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

export const HiHatLayeringIntent: BaseIntent = {
  name: 'spectral.hihat_layering',
  domain: 'spectral',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (!bb.incomingBassKilled) return 0;
    // Only if incoming highs are still down.
    if (bb.incomingState.eq.high >= -2) return 0;
    // Within a reasonable lead window.
    if (bb.beatsToOutroMaster > 48 || bb.beatsToOutroMaster < 16) return 0;
    return 0.4;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    store.setDeckEq(bb.incomingDeck, 'high', 0);
  },
};
