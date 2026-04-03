/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Filter Washout Intent
//
// DOMAIN: Dynamics
// PRIORITY: 0.1 → 0.8 (rising urgency curve)
//
// Gradually applies a highpass filter to the master deck as
// the incoming track's drop approaches, creating the classic
// techno "thinning out" effect.
//
// Trigger:
//   Both decks playing AND
//   Incoming deck has bass killed (swap hasn't happened yet) AND
//   Master deck Color FX is near zero (no filter already applied) AND
//   We're within 16 beats of the next phrase boundary
//
// Scoring:
//   The score follows a linear ramp from 0.1 (16 beats away)
//   to 0.8 (1 beat away).  This means the washout gains
//   priority as the drop approaches, but can still be
//   overridden by safety intents (1.0) or the drop swap (0.9).
//
// Action:
//   Set the master deck's Color FX to a value proportional
//   to the progress towards the drop.
//
//   progress = 1 - (beatsToPhraseBoundary / 16)
//   colorFx  = progress * 0.7
//
//   At progress=0 → FX=0 (transparent)
//   At progress=1 → FX=0.7 (heavy highpass — bass gone)
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Max Color FX value for the washout sweep. */
const MAX_FX = 0.7;

/** Number of beats over which the washout progresses. */
const WASHOUT_BEATS = 16;

export const FilterWashoutIntent: BaseIntent = {
  name: 'dynamics.filter_washout',
  domain: 'dynamics',
  exclusive: false, // Can stack with spectral intents.

  evaluate(bb: Blackboard): number {
    // Only wash out if we're mid-blend (both playing).
    if (!bb.bothPlaying) return 0;

    // Only if the incoming bass is still killed (pre-swap).
    if (bb.incomingState.eq.low > -15) return 0;

    // Only if we haven't already finished the sweep.
    if (bb.masterState.colorFx >= MAX_FX) return 0;

    // Calculate beats until the next phrase boundary.
    // Phrase boundaries are every 16 beats.
    const beatInPhrase = ((bb.masterCurrentBeat % 16) + 16) % 16;
    const beatsToPhrase = 16 - beatInPhrase;

    // Only activate within the last WASHOUT_BEATS of the phrase.
    if (beatsToPhrase > WASHOUT_BEATS) return 0;

    // Linear ramp: 0.1 at 16 beats out → 0.8 at 1 beat out.
    const progress = 1 - beatsToPhrase / WASHOUT_BEATS;
    return 0.1 + progress * 0.7;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    // Calculate the FX value based on progress towards the phrase end.
    const beatInPhrase = ((bb.masterCurrentBeat % 16) + 16) % 16;
    const beatsToPhrase = 16 - beatInPhrase;
    const progress = 1 - beatsToPhrase / WASHOUT_BEATS;
    const fxValue = progress * MAX_FX;

    store.setDeckColorFx(bb.masterDeck, fxValue);
  },
};
