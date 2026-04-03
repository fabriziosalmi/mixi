/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Spectral – Vocal Space Carving
//
// When both decks are playing and the master has high mid-range
// energy (vocal, synth lead), cut the incoming deck's mids
// by -8 dB to "carve a hole" for the master's voice.
//
// This prevents the two mid-range signals from turning into
// a wall of indistinct noise.
//
// Reverses automatically when the bass swap happens (the
// DropSwapIntent doesn't touch mids, so the AI must manage it).
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

export const VocalSpaceCarvingIntent: BaseIntent = {
  name: 'spectral.vocal_space_carving',
  domain: 'spectral',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.midClash) return 0;
    // Only carve if the master has prominent mids.
    if (bb.masterState.eq.mid < -3) return 0;
    // Don't carve if incoming mids are already cut.
    if (bb.incomingState.eq.mid <= -6) return 0;
    return 0.5;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    store.setDeckEq(bb.incomingDeck, 'mid', -8);
  },
};
