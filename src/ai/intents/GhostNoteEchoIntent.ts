/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Dynamics – Ghost Note Echo
//
// As the outgoing (master) deck fades out during a blend, this
// intent sculpts the EQ to create a "ghost echo" tail:
//
//   1. Progressively kill the bass (clean exit, no rumble clash)
//   2. Boost the high-mids for presence as the track recedes
//   3. Apply a rhythmic tremolo via colorFx synced to 1/4 notes
//      — the crowd hears the ghost of the outgoing melody
//      ticking away before silence.
//
// The effect is proportional to how far the crossfader has
// moved toward the incoming deck — the deeper the blend, the
// more pronounced the ghost.
//
// Trigger: blending, master volume ≤ 0.45, incoming > 0.6.
// Score: 0.48 — below washout, above wobble.
// Not exclusive: EqAmnesia is higher-priority and will clean up.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

export const GhostNoteEchoIntent: BaseIntent = {
  name: 'dynamics.ghost_note_echo',
  domain: 'dynamics',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    // Master must be fading — volume below 45%, incoming dominant.
    if (bb.masterState.volume > 0.45) return 0;
    if (bb.incomingState.volume < 0.6) return 0;
    // Don't stack with a manual filter sweep.
    if (bb.masterHasFilter) return 0;
    return 0.48;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    // Fade depth: 0 when master=0.45, 1 when master=0.
    const fadeDepth = 1 - bb.masterState.volume / 0.45;

    // 1. Progressive bass kill proportional to fade depth.
    const targetBassEq = -(fadeDepth * 18); // 0 dB → -18 dB
    store.setDeckEq(bb.masterDeck, 'low', targetBassEq);

    // 2. Hi-mid presence boost (ghost harmonics shimmer forward).
    const hiMidBoost = fadeDepth * 4; // 0 dB → +4 dB
    store.setDeckEq(bb.masterDeck, 'high', hiMidBoost);

    // 3. Rhythmic colorFx tremolo synced to 1/4-note grid.
    //    Sine LFO at beat frequency — one pulse per quarter note.
    const beatFrac = bb.masterCurrentBeat % 1; // 0→1 per beat
    const tremolo = Math.sin(beatFrac * 2 * Math.PI) * fadeDepth * 0.25;
    store.setDeckColorFx(bb.masterDeck, tremolo);
  },
};
