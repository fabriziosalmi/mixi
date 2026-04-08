/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Dynamics – Filter Wobble
//
// Smooth sinusoidal oscillation of the Color FX knob (±0.2)
// every half-beat, creating rhythmic instability during a
// build-up.
//
// v2: Replaced hard binary switch (+0.2/-0.2) with a smooth
//     sine wave. At 20 Hz tick rate, each half-beat gets ~3
//     samples — a sine wave is audibly smoother than a square.
//
// The wobble makes the crowd uneasy — their brains crave
// the resolution that comes when the filter resets to 0
// and the drop hits.
//
// Trigger: Both playing, within 8 beats of phrase boundary,
//          master has no heavy filter yet.
//
// Score: 0.55 — moderate, can be overridden by washout or silence.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Max wobble amplitude (±0.2 on color FX). */
const WOBBLE_DEPTH = 0.2;

export const FilterWobbleIntent: BaseIntent = {
  name: 'dynamics.filter_wobble',
  domain: 'dynamics',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (bb.masterHasFilter) return 0; // Don't fight an existing sweep.
    if (bb.masterBeatsToPhrase > 8) return 0;
    if (bb.masterBeatsToPhrase < 1) return 0; // Let pre-drop silence take over.
    return 0.55;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    // Smooth sine oscillation at 2× beat frequency (half-beat wobble).
    // One full sine cycle per half-beat.
    const phase = (bb.masterCurrentBeat % 0.5) / 0.5; // 0→1 every half-beat
    const fxValue = Math.sin(phase * 2 * Math.PI) * WOBBLE_DEPTH;
    store.setDeckColorFx(bb.masterDeck, fxValue);
  },
};
