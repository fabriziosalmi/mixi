/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Dynamics – BuildUp Tension
//
// Detects the pre-drop buildup window (16-4 beats before the
// incoming drop) and applies a progressive high-pass filter
// sweep to both decks, stripping bass energy to build tension.
//
// The sweep is linear: at 16 beats out the colorFx is barely
// touched (±0.15), at 4 beats out it reaches a full open sweep
// (±0.85), then releases instantly when the drop hits.
//
// Why colorFx and not EQ low?  ColorFx is the DJ-style filter
// knob — a sweep sounds natural and undoes itself cleanly.
// EQ kills are percussive; filter sweeps are tonal.
//
// Score: 0.65 — overrides mild FX but not bass swaps or safety.
// Not exclusive: EqAmnesia can still fire to prevent stuck kills.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

// How many beats before incoming drop to start the sweep.
const BUILDUP_START_BEATS = 16;
const BUILDUP_END_BEATS = 4;

// colorFx range: 0 = neutral, positive = HPF sweep.
const SWEEP_MIN = 0.15;
const SWEEP_MAX = 0.85;

/** Ownership flag so our own HPF sweep doesn't trip masterHasFilter (AUD-10). */
let isBuildupActive = false;

export function resetBuildUpTensionState(): void {
  isBuildupActive = false;
}

export const BuildUpTensionIntent: BaseIntent = {
  name: 'dynamics.buildup_tension',
  domain: 'dynamics',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    if (!bb.masterState.isPlaying || !bb.incomingIsReady) {
      isBuildupActive = false;
      return 0;
    }

    const btd = bb.beatsToIncomingDrop;
    if (btd === null) {
      isBuildupActive = false;
      return 0;
    }

    // If we own an active sweep and passed the end beat, score once more to release filters to 0.
    if (isBuildupActive && btd < BUILDUP_END_BEATS) {
      return 0.7;
    }

    // Only active in the buildup window.
    if (btd > BUILDUP_START_BEATS || btd < BUILDUP_END_BEATS) return 0;

    // Don't fight a manual filter the DJ already applied before we took ownership.
    if (!isBuildupActive && bb.masterHasFilter) return 0;

    return 0.65;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    const btd = bb.beatsToIncomingDrop;
    if (btd === null) return;

    // Release filters cleanly when the drop hits.
    if (btd < BUILDUP_END_BEATS) {
      store.setDeckColorFx(bb.masterDeck, 0);
      store.setDeckColorFx(bb.incomingDeck, 0);
      isBuildupActive = false;
      return;
    }

    isBuildupActive = true;
    // Linear ramp: 0.0 at BUILDUP_START, 1.0 at BUILDUP_END.
    const progress = Math.max(0, Math.min(1, 1 - (btd - BUILDUP_END_BEATS) / (BUILDUP_START_BEATS - BUILDUP_END_BEATS)));
    const sweep = SWEEP_MIN + progress * (SWEEP_MAX - SWEEP_MIN);

    store.setDeckColorFx(bb.masterDeck, sweep);
    store.setDeckColorFx(bb.incomingDeck, sweep * 0.6); // gentler on incoming
  },
};
