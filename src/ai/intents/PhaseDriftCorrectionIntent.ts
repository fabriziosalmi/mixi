/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Safety – Phase Drift Correction (v2)
//
// Even when BPMs match, beatgrids can drift out of phase due
// to floating-point accumulation in AudioContext timing.
//
// This intent uses the continuous phase error (phaseDeltaMs)
// from the Blackboard to apply a proportional pitch nudge:
//
//   - Small drift (10–30 ms): gentle 0.5% nudge for ~80 ms
//   - Medium drift (30–80 ms): 1% nudge for ~120 ms
//   - Large drift (>80 ms):    2% nudge for ~150 ms
//
// The nudge duration is proportional to the error magnitude,
// creating a smooth correction that's inaudible to the listener.
//
// The "galloping kick" effect (two kicks slightly offset)
// is the #1 sign of amateur DJing.  This kills it.
//
// Score: 0.85 — high priority, just below bass swap.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Ticks to wait between corrections (debounce). */
let lastCorrectionTick = 0;
const COOLDOWN_TICKS = 20;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

/** Minimum phase error to trigger correction (ms). */
const THRESHOLD_MS = 10;

export const PhaseDriftCorrectionIntent: BaseIntent = {
  name: 'safety.phase_drift_correction',
  domain: 'safety',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (bb.incomingState.volume < 0.3) return 0; // Not audible yet.
    if (bb.tick - lastCorrectionTick < COOLDOWN_TICKS) return 0;

    const absMs = Math.abs(bb.phaseDeltaMs);
    if (absMs < THRESHOLD_MS) return 0; // Within tolerance.

    // Score scales with drift magnitude (more urgent = higher score).
    // 10ms → 0.6, 50ms → 0.85, 100ms+ → 0.9
    return Math.min(0.9, 0.6 + (absMs / 200));
  },

  execute(bb: Blackboard, store: MixiStore): void {
    lastCorrectionTick = bb.tick;

    const absMs = Math.abs(bb.phaseDeltaMs);
    const originalRate = bb.incomingState.playbackRate;

    // Proportional nudge: larger drift → stronger correction.
    let nudgePercent: number;
    let durationMs: number;

    if (absMs < 30) {
      nudgePercent = 0.005;  // 0.5%
      durationMs = 80;
    } else if (absMs < 80) {
      nudgePercent = 0.01;   // 1%
      durationMs = 120;
    } else {
      nudgePercent = 0.02;   // 2%
      durationMs = 150;
    }

    // phaseDeltaMs > 0 means incoming is behind → speed up.
    // phaseDeltaMs < 0 means incoming is ahead  → slow down.
    const direction = bb.phaseDeltaMs > 0 ? 1 : -1;
    const nudgeRate = originalRate * (1 + direction * nudgePercent);

    // Cancel any pending restore from previous nudge.
    if (pendingTimeout) clearTimeout(pendingTimeout);

    store.setDeckPlaybackRate(bb.incomingDeck, nudgeRate);

    pendingTimeout = setTimeout(() => {
      store.setDeckPlaybackRate(bb.incomingDeck, originalRate);
      pendingTimeout = null;
    }, durationMs);
  },
};
