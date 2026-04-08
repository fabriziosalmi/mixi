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
// Action: Set both volumes to 0 for ~1 beat, then restore
//         to previous levels. Self-contained — does NOT rely
//         on other intents to restore volume.
//
// Score: 0.95 — higher than filter washout, lower than safety.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Saved volumes before the silence cut. */
let savedMasterVol = 1.0;
let savedIncomingVol = 0.0;
let restoreTimeout: ReturnType<typeof setTimeout> | null = null;
/** Cooldown: don't fire again within 64 ticks (~3.2s). */
let lastFireTick = 0;
const COOLDOWN_TICKS = 64;

export const PreDropSilenceIntent: BaseIntent = {
  name: 'dynamics.pre_drop_silence',
  domain: 'dynamics',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (!bb.incomingBassKilled) return 0;
    if (bb.masterState.volume < 0.5) return 0;
    // Cooldown guard — prevent rapid re-firing.
    if (bb.tick - lastFireTick < COOLDOWN_TICKS) return 0;
    // Don't fire if a restore is still pending.
    if (restoreTimeout !== null) return 0;

    // Fire when we're within the last beat of the phrase.
    // beatsToPhrase between 0.3 and 1.0 = the "just before" window.
    if (bb.masterBeatsToPhrase > 1.0 || bb.masterBeatsToPhrase < 0.3) return 0;

    return 0.95;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    lastFireTick = bb.tick;

    // Save current volumes BEFORE cutting.
    savedMasterVol = bb.masterState.volume;
    savedIncomingVol = bb.incomingState.volume;

    // Cut both to silence.
    store.setDeckVolume(bb.masterDeck, 0);
    store.setDeckVolume(bb.incomingDeck, 0);

    // Self-contained restore: after ~1 beat, bring volumes back.
    // This is the CRITICAL safety net — we never leave volumes at 0.
    const restoreMs = Math.max(80, bb.masterBeatPeriod * 1000 * 0.8);
    const masterDeck = bb.masterDeck;
    const incomingDeck = bb.incomingDeck;

    restoreTimeout = setTimeout(() => {
      // Read the CURRENT store state (not stale closure).
      const currentStore = (store as any).__rawStore
        ? (store as any).__rawStore : store;
      currentStore.setDeckVolume(masterDeck, savedMasterVol);
      currentStore.setDeckVolume(incomingDeck, savedIncomingVol);
      restoreTimeout = null;
    }, restoreMs);
  },
};
