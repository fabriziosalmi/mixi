/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Dynamics – LPF Mud Dive
//
// The inverse of the HPF washout: applies a lowpass filter
// to the master deck, making it sound "submerged" / underwater.
//
// Used to prepare for the entrance of a clean, bright
// incoming track — the contrast makes the new track
// explode when it enters.
//
// Trigger: Both playing, incoming bass killed,
//          within 16 beats of a phrase boundary,
//          master has no filter applied yet.
//
// Score: lower than HPF washout (0.05→0.5) — the AI prefers
//        the classic HPF, but LPF fires if HPF hasn't started.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

const MAX_LPF = -0.5;
const DIVE_BEATS = 16;

export const LpfMudDiveIntent: BaseIntent = {
  name: 'dynamics.lpf_mud_dive',
  domain: 'dynamics',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (!bb.incomingBassKilled) return 0;
    // Only if master has NO filter yet (don't fight the HPF washout).
    if (bb.masterHasFilter) return 0;
    if (bb.masterBeatsToPhrase > DIVE_BEATS) return 0;

    const progress = 1 - bb.masterBeatsToPhrase / DIVE_BEATS;
    return 0.05 + progress * 0.45;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    const progress = 1 - bb.masterBeatsToPhrase / DIVE_BEATS;
    store.setDeckColorFx(bb.masterDeck, progress * MAX_LPF);
  },
};
