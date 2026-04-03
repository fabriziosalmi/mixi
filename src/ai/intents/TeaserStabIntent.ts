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
// flashing its volume to 1.0 for a quarter-beat, then back
// to 0.  Repeated every 4 beats during the lead-in phase.
//
// This builds anticipation: the crowd hears a fleeting hi-hat
// or synth stab and wants more.
//
// Trigger: Incoming is playing at volume 0, incoming bass killed,
//          we're in the early blend phase (32–16 beats to outro).
//
// Score: 0.45 — cosmetic, overridden by anything structural.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

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
      if (pending) clearTimeout(pending);
      store.setDeckVolume(bb.incomingDeck, 1.0);
      pending = setTimeout(() => {
        store.setDeckVolume(bb.incomingDeck, 0);
        pending = null;
      }, bb.masterBeatPeriod * 250);
    };
  })(),
};
