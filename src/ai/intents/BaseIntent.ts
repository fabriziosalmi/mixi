/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Base Intent Interface
//
// Every DJ "move" — from a safety loop to a bass swap to a
// filter wobble — implements this interface.
//
// The two methods define a clean Sense → Act loop:
//
//   evaluate()  → "How badly do I need to fire right now?"
//                 Returns 0.0 (irrelevant) to 1.0 (emergency).
//
//   execute()   → "Do the thing."
//                 Mutates the mixer via Zustand store actions.
//
// Design rules:
//   - evaluate() must be PURE and FAST (< 0.1 ms).
//     No store writes, no engine calls, no side effects.
//     It reads only from the Blackboard snapshot.
//
//   - execute() is the ONLY place that touches the store.
//     It receives both Blackboard (for reading context) and
//     store actions (for writing state).
//
//   - An intent can declare a `domain` tag for debugging
//     and future priority grouping.
//
//   - `exclusive` intents suppress all lower-priority intents
//     in the same domain when they fire.
// ─────────────────────────────────────────────────────────────

import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

/** Domains group intents by concern for debugging and arbitration. */
export type IntentDomain =
  | 'safety'      // Emergency: dead air, clipping, phase drift
  | 'spectral'    // EQ sculpting: bass swap, vocal carving, sub control
  | 'dynamics'    // FX & tension: filters, washouts, drops
  | 'rhythm'      // Performance: loops, rolls, stabs
  | 'structure';  // Macro phrasing: double drops, outro riding

export interface BaseIntent {
  /** Unique identifier (e.g. "safety.dead_air_prevention"). */
  readonly name: string;

  /** Domain for grouping and priority arbitration. */
  readonly domain: IntentDomain;

  /**
   * If true, when this intent fires it blocks all lower-scored
   * intents in the same domain for the current tick.
   */
  readonly exclusive: boolean;

  /**
   * Evaluate urgency given the current blackboard snapshot.
   *
   * @returns 0.0 (not needed) to 1.0 (fire immediately).
   *          Return exactly 0 to skip — the arbiter ignores zeros.
   *
   * MUST be pure and side-effect-free.
   */
  evaluate(bb: Blackboard): number;

  /**
   * Execute the intent's action.
   *
   * @param bb    – Read-only blackboard for context.
   * @param store – Zustand store (getState()) for mutations.
   *
   * Called at most once per tick, only if evaluate() > 0.
   */
  execute(bb: Blackboard, store: MixiStore): void;
}
