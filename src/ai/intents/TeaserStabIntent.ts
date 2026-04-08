/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Rhythm – Teaser Stab
//
// Gives the crowd a quick "taste" of the incoming track by
// flashing its volume to 0.5 for a quarter-beat, then back
// to 0.  Repeated every 4 beats during the lead-in phase.
//
// v2 changes:
//   - Reduced flash volume from 1.0 to 0.5 (less jarring)
//   - Added bass-killed guard at execute time (not just evaluate)
//   - Fixed math: beatPeriod * 1000 / 4 for quarter-beat duration
//   - Captured deck ID in closure (survives role swap)
//
// Score: 0.45 — cosmetic, overridden by anything structural.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Flash volume for the stab. 0.5 = -6 dB, enough to hear but
 *  not enough to create a full bass dump if bass isn't killed. */
const STAB_VOLUME = 0.5;

export const TeaserStabIntent: BaseIntent = {
  name: 'rhythm.teaser_stab',
  domain: 'rhythm',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (bb.incomingState.volume > 0.1) return 0; // Already audible.
    if (!bb.incomingBassKilled) return 0;
    if (bb.beatsToOutroMaster < 16 || bb.beatsToOutroMaster > 48) return 0;

    // Only fire on every 4th beat (downbeat of each bar).
    const beatMod4 = (bb.incomingCurrentBeat % 4 + 4) % 4;
    if (beatMod4 > 0.3) return 0;

    return 0.45;
  },

  execute: (() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    return (bb: Blackboard, store: MixiStore): void => {
      if (pending) return; // Don't stack stabs.

      // Double-check bass is still killed at execute time.
      if (!bb.incomingBassKilled) return;

      // Capture the deck ID (not a reference to bb which may change).
      const deckId = bb.incomingDeck;

      store.setDeckVolume(deckId, STAB_VOLUME);

      // Quarter-beat duration in ms = beatPeriod(s) * 1000 / 4.
      const quarterBeatMs = (bb.masterBeatPeriod * 1000) / 4;
      pending = setTimeout(() => {
        store.setDeckVolume(deckId, 0);
        pending = null;
      }, quarterBeatMs);
    };
  })(),
};
