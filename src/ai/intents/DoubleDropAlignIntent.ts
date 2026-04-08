/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Structure – Double Drop Align
//
// The holy grail of techno DJing: aligning two tracks so their
// drops hit at the EXACT same moment.
//
// When two drops collide, the energy multiplies — the crowd
// feels two kicks, two bass lines, and two synth riffs all
// explode simultaneously.
//
// v2 changes:
//   - Tightened clamp from ±8% to ±2% (0.98–1.02)
//   - Added return-to-1.0 when drops are aligned
//   - Added max accumulated deviation guard
//
// Algorithm:
//   1. Read the drop positions from both tracks.
//   2. Calculate misalignment in beats.
//   3. Apply micro playbackRate nudge (max ±0.5%) to converge.
//   4. When aligned, restore rate to 1.0 (or sync rate).
//
// Score: 0.6 — structural but not urgent.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';
import { log } from '../../utils/logger';

/** Maximum playbackRate nudge for alignment (±0.5%). */
const MAX_NUDGE = 0.005;

/** Maximum total deviation from 1.0 (±2% = barely audible). */
const MAX_DEVIATION = 0.02;

/** Minimum beats of lead time needed to align. */
const MIN_LEAD_BEATS = 32;

/** Tolerance: drops within this many beats count as "aligned". */
const ALIGNED_THRESHOLD = 1;

let lastLogTick = 0;

export const DoubleDropAlignIntent: BaseIntent = {
  name: 'structure.double_drop_align',
  domain: 'structure',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (bb.masterDropBeat === null || bb.incomingDropBeat === null) return 0;
    if (bb.beatsToIncomingDrop === null) return 0;
    if (bb.beatsToIncomingDrop < MIN_LEAD_BEATS) return 0;

    const masterBeatsToItsDrop = bb.masterDropBeat - bb.masterCurrentBeat;
    const masterTarget = masterBeatsToItsDrop > 0
      ? masterBeatsToItsDrop : bb.beatsToOutroMaster;
    const misalignment = Math.abs(masterTarget - bb.beatsToIncomingDrop);

    if (misalignment < ALIGNED_THRESHOLD) {
      // Aligned! If rate is still nudged, score to restore it.
      const deviation = Math.abs(bb.incomingState.playbackRate - 1.0);
      return deviation > 0.001 ? 0.2 : 0;
    }

    return Math.min(0.6, 0.2 + misalignment * 0.01);
  },

  execute(bb: Blackboard, store: MixiStore): void {
    if (bb.masterDropBeat === null || bb.beatsToIncomingDrop === null) return;

    const masterBeatsToItsDrop = bb.masterDropBeat - bb.masterCurrentBeat;
    const masterTarget = masterBeatsToItsDrop > 0
      ? masterBeatsToItsDrop : bb.beatsToOutroMaster;
    const misalignment = Math.abs(masterTarget - bb.beatsToIncomingDrop);

    // ── Aligned: restore rate to 1.0 gradually ──────────────
    if (misalignment < ALIGNED_THRESHOLD) {
      const currentRate = bb.incomingState.playbackRate;
      if (Math.abs(currentRate - 1.0) > 0.001) {
        // Ease back to 1.0 (50% per tick to avoid sudden jump).
        const restored = currentRate + (1.0 - currentRate) * 0.5;
        store.setDeckPlaybackRate(bb.incomingDeck, restored);
      }
      return;
    }

    // ── Nudge to converge ────────────────────────────────────
    const diff = bb.beatsToIncomingDrop - masterTarget;
    const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, diff * 0.001));
    const newRate = bb.incomingState.playbackRate + nudge;

    // Clamp to ±2% max deviation from 1.0 (barely audible).
    const clampedRate = Math.max(1.0 - MAX_DEVIATION, Math.min(1.0 + MAX_DEVIATION, newRate));
    store.setDeckPlaybackRate(bb.incomingDeck, clampedRate);

    // Log periodically (~2s).
    if (bb.tick - lastLogTick > 40) {
      lastLogTick = bb.tick;
      log.info(
        'AI',
        `Double Drop Align: ${bb.incomingDeck} drop in ${bb.beatsToIncomingDrop.toFixed(0)} beats, ` +
        `master drop in ${masterTarget.toFixed(0)} — nudge ${(nudge * 100).toFixed(3)}%`,
      );
    }
  },
};
