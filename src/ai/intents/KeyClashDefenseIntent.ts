/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Structure – Key Clash Defense (Harmonic Mixing Guard)
//
// When two tracks are in clashing keys (e.g. C minor vs
// F# major — a tritone apart, the most dissonant interval),
// blending them with both mid-ranges audible creates a
// physically painful wall of dissonance.
//
// This intent detects key incompatibility and forces a
// protective mixing strategy:
//
//   - If the keys clash: force a "hard cut" approach.
//     Kill the mids on the incoming track aggressively (-20 dB)
//     so only the rhythm (kick, hi-hat) comes through.
//     The melodic content never overlaps.
//
//   - Apply a stronger HPF washout (colorFx → +0.8) to strip
//     the outgoing track's tonal content faster.
//
// The result: even with clashing keys, the transition sounds
// clean because the two melodies never coexist at audible levels.
//
// Camelot compatibility rule:
//   Compatible = same number OR ±1 on the same letter.
//   8A ↔ 7A, 9A, 8B = compatible.
//   8A ↔ 2B = CLASH.
//
// Score: 0.8 — high priority (bad key mixing is unforgivable).
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';
import { log } from '../../utils/logger';

let hasLogged = false;

export const KeyClashDefenseIntent: BaseIntent = {
  name: 'structure.key_clash_defense',
  domain: 'structure',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    // Need key data on both decks.
    if (!bb.masterKey || !bb.incomingKey) return 0;

    // Only relevant when both are playing.
    if (!bb.bothPlaying) {
      hasLogged = false; // Reset log flag for next blend.
      return 0;
    }

    // If keys are compatible, no action needed.
    if (bb.isHarmonicMatch) return 0;

    // Keys clash! High priority.
    return 0.8;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    if (!hasLogged) {
      log.warn(
        'AI',
        `KEY CLASH: ${bb.masterDeck}=${bb.masterKey} vs ${bb.incomingDeck}=${bb.incomingKey} — forcing hard-cut strategy`,
      );
      hasLogged = true;
    }

    // ── Strategy: kill incoming mids to prevent melodic overlap ──

    // Aggressive mid kill on incoming.
    if (bb.incomingState.eq.mid > -20) {
      store.setDeckEq(bb.incomingDeck, 'mid', -20);
    }

    // If both are already at high volume (blend in progress),
    // accelerate the washout on the outgoing deck.
    if (bb.isBlending && bb.masterState.colorFx < 0.8) {
      // Ramp the HPF faster than the normal FilterWashout would.
      const currentFx = bb.masterState.colorFx;
      const step = 0.05; // ~1.0 per second at 50ms tick.
      store.setDeckColorFx(bb.masterDeck, Math.min(0.8, currentFx + step));
    }
  },
};
