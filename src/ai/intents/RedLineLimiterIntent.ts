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
// v2: Added volume restoration when danger condition passes.
//     Tracks whether we reduced the volume so we can restore it.
//
// Score: 0.92 — near-emergency, just below full safety.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Whether the limiter is currently engaged (we reduced volume). */
let isEngaged = false;
/** The original volume before we reduced it. */
let savedVolume = 1.0;

export const RedLineLimiterIntent: BaseIntent = {
  name: 'safety.red_line_limiter',
  domain: 'safety',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    // ── Check for danger condition ───────────────────────────
    const mVol = bb.masterState.volume;
    const iVol = bb.incomingState.volume;
    const bothLoud = bb.bothPlaying && mVol >= 0.8 && iVol >= 0.8;

    const hasBassBoost =
      bb.masterState.eq.low > 3 || bb.incomingState.eq.low > 3;
    const hasMidBoost =
      bb.masterState.eq.mid > 3 || bb.incomingState.eq.mid > 3;

    const isDangerous = bothLoud && (hasBassBoost || hasMidBoost);

    if (!isDangerous) {
      // ── Danger passed — restore volume if we engaged ───────
      if (isEngaged) {
        // Score > 0 so execute() can restore.
        return 0.3;
      }
      return 0;
    }

    // Already compensated?
    if (bb.masterVolume < 0.7) return 0;

    return 0.92;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    // ── Restore path ─────────────────────────────────────────
    if (isEngaged) {
      const mVol = bb.masterState.volume;
      const iVol = bb.incomingState.volume;
      const bothLoud = bb.bothPlaying && mVol >= 0.8 && iVol >= 0.8;
      const hasBassBoost =
        bb.masterState.eq.low > 3 || bb.incomingState.eq.low > 3;
      const hasMidBoost =
        bb.masterState.eq.mid > 3 || bb.incomingState.eq.mid > 3;
      const isDangerous = bothLoud && (hasBassBoost || hasMidBoost);

      if (!isDangerous) {
        // Safe to restore.
        store.setMasterVolume(savedVolume);
        isEngaged = false;
        return;
      }
    }

    // ── Engage: reduce master by ~3 dB ───────────────────────
    if (!isEngaged) {
      savedVolume = bb.masterVolume;
      isEngaged = true;
    }
    store.setMasterVolume(0.7);
  },
};
