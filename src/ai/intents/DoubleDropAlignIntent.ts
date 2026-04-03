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
// explode simultaneously.  It's the most powerful moment
// a DJ can create.
//
// Algorithm:
//   1. Read the drop positions from both tracks (detected
//      offline by DropDetector).
//   2. Calculate the beat difference between the incoming
//      track's current position and its first drop.
//   3. Calculate how many beats remain on the master until
//      its next drop (or its mix-out point).
//   4. If the drops are misaligned, apply a micro playbackRate
//      adjustment on the incoming deck to make them converge.
//
// The adjustment is invisible: at 170 BPM, shifting by 0.5%
// for 20 seconds moves the drop by ~1 beat.
//
// Score: 0.6 — structural but not urgent.  Only fires during
//        the preparation phase (before the blend starts).
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';
import { log } from '../../utils/logger';

/** Maximum playbackRate nudge for alignment (±0.5%). */
const MAX_NUDGE = 0.005;

/** Minimum beats of lead time needed to align (too late otherwise). */
const MIN_LEAD_BEATS = 32;

/** Tolerance: drops within this many beats count as "aligned". */
const ALIGNED_THRESHOLD = 1;

let lastLogTick = 0;

export const DoubleDropAlignIntent: BaseIntent = {
  name: 'structure.double_drop_align',
  domain: 'structure',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    // Both decks must be playing.
    if (!bb.bothPlaying) return 0;

    // Need drop data for both tracks.
    if (bb.masterDropBeat === null || bb.incomingDropBeat === null) return 0;
    if (bb.beatsToIncomingDrop === null) return 0;

    // Only useful if we have enough runway to nudge.
    if (bb.beatsToIncomingDrop < MIN_LEAD_BEATS) return 0;

    // Calculate how far apart the two drops are in time.
    // We want: masterDropBeat - masterCurrentBeat ≈ incomingDropBeat - incomingCurrentBeat
    const masterBeatsToItsDrop = bb.masterDropBeat - bb.masterCurrentBeat;
    const incomingBeatsToItsDrop = bb.beatsToIncomingDrop;

    // If master drop is already past, use beats to outro instead.
    const masterTarget = masterBeatsToItsDrop > 0
      ? masterBeatsToItsDrop
      : bb.beatsToOutroMaster;

    const misalignment = Math.abs(masterTarget - incomingBeatsToItsDrop);

    // Already aligned? Nothing to do.
    if (misalignment < ALIGNED_THRESHOLD) return 0;

    // Score scales with misalignment (more offset = more urgent).
    return Math.min(0.6, 0.2 + misalignment * 0.01);
  },

  execute(bb: Blackboard, store: MixiStore): void {
    if (bb.masterDropBeat === null || bb.beatsToIncomingDrop === null) return;

    const masterBeatsToItsDrop = bb.masterDropBeat - bb.masterCurrentBeat;
    const masterTarget = masterBeatsToItsDrop > 0
      ? masterBeatsToItsDrop
      : bb.beatsToOutroMaster;
    const incomingBeatsToItsDrop = bb.beatsToIncomingDrop;

    // incoming needs to ARRIVE at its drop at the same time as master.
    // If incoming is "too far" from its drop → speed up.
    // If incoming is "too close" → slow down.
    const diff = incomingBeatsToItsDrop - masterTarget;

    // Proportional nudge: bigger diff = bigger nudge, clamped.
    const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, diff * 0.001));
    const newRate = bb.incomingState.playbackRate + nudge;

    store.setDeckPlaybackRate(
      bb.incomingDeck,
      Math.max(0.92, Math.min(1.08, newRate)),
    );

    // Log periodically (every ~2s).
    if (bb.tick - lastLogTick > 40) {
      lastLogTick = bb.tick;
      log.info(
        'AI',
        `Double Drop Align: ${bb.incomingDeck} drop in ${incomingBeatsToItsDrop.toFixed(0)} beats, ` +
        `master drop in ${masterTarget.toFixed(0)} — nudge ${(nudge * 100).toFixed(3)}%`,
      );
    }
  },
};
