/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Safety – Red Line Limiter Crash Prevention
//
// Both decks at full volume with boosted EQ will overdrive the
// master bus, causing the brickwall limiter to clamp hard.
// The result: audible distortion and "pumping" artifacts.
//
// This intent detects the dangerous condition and silently
// reduces the master volume by -3 dB to give the limiter
// headroom, preventing the distortion before it happens.
//
// Score: 0.92 — near-emergency, just below full safety.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

export const RedLineLimiterIntent: BaseIntent = {
  name: 'safety.red_line_limiter',
  domain: 'safety',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;

    // Danger condition: both volumes high + any EQ boosted.
    const mVol = bb.masterState.volume;
    const iVol = bb.incomingState.volume;
    if (mVol < 0.8 || iVol < 0.8) return 0;

    const hasBassBoost =
      bb.masterState.eq.low > 3 || bb.incomingState.eq.low > 3;
    const hasMidBoost =
      bb.masterState.eq.mid > 3 || bb.incomingState.eq.mid > 3;

    if (!hasBassBoost && !hasMidBoost) return 0;

    // Already compensated?
    if (bb.masterVolume < 0.7) return 0;

    return 0.92;
  },

  execute(_bb: Blackboard, store: MixiStore): void {
    // Reduce master by ~3 dB (0.7 linear ≈ -3 dB).
    store.setMasterVolume(0.7);
  },
};
