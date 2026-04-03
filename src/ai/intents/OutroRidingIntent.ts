/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Structure – Outro Riding
//
// When the master track enters its outro (simple kick loop)
// and the incoming track is in its intro, let both play at
// full volume for an extended 64-beat blend.
//
// This creates a "hybrid track" feeling — the two rhythms
// merge into something that sounds intentional, not like
// a DJ scrambling to transition.
//
// Trigger: Both playing, both at volume > 0.8,
//          master in the last 64 beats, no bass clash.
//
// Action: Keep both volumes at 1.0 and both bass flat.
//         The outro's simple pattern won't clash with the
//         intro's simple pattern.
//
// Score: 0.3 — low-priority "let it ride" behaviour.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';

export const OutroRidingIntent: BaseIntent = {
  name: 'structure.outro_riding',
  domain: 'structure',
  exclusive: false,

  evaluate(bb: Blackboard): number {
    if (!bb.bothPlaying) return 0;
    if (bb.masterState.volume < 0.8 || bb.incomingState.volume < 0.8) return 0;
    // Master should be in its final stretch.
    if (bb.beatsToEndMaster > 64 || bb.beatsToEndMaster < 8) return 0;
    // No bass clash — if there is, other intents handle it.
    if (bb.bassClash) return 0;
    return 0.3;
  },

  execute(_bb: Blackboard, _store: MixiStore): void {
    // Intentionally no-op: the point is to NOT intervene.
    // By scoring > 0, this intent "claims" the structure domain,
    // preventing other structure intents from cutting the blend short.
  },
};
