/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Safety Loop Intent
//
// DOMAIN: Safety (Emergency)
// PRIORITY: 1.0 (maximum — overrides everything)
//
// Prevents dead air by engaging a 4-beat loop on the master
// deck when the track is about to end and no loop is active.
//
// This is the "last line of defence" — if the DJ (human or AI)
// hasn't started a transition, this kicks in to buy time.
//
// Trigger:
//   Master deck is playing AND
//   < 8 beats remain until the physical end of the audio AND
//   No loop is already active
//
// Action:
//   Activate a 4-beat auto-loop on the master deck.
//   The loop will keep the rhythm going indefinitely until
//   the DJ manually exits it or loads a new track.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent } from './BaseIntent';
import type { Blackboard } from '../Blackboard';
import type { MixiStore } from '../../store/mixiStore';
import { log } from '../../utils/logger';

export const SafetyLoopIntent: BaseIntent = {
  name: 'safety.dead_air_prevention',
  domain: 'safety',
  exclusive: true,

  evaluate(bb: Blackboard): number {
    // Only fire if:
    //   1. Master is playing
    //   2. Track is about to end (< 8 beats)
    //   3. No loop already active (don't stack loops)
    if (
      bb.masterState.isPlaying &&
      bb.beatsToEndMaster > 0 &&
      bb.beatsToEndMaster < 8 &&
      !bb.masterHasLoop
    ) {
      return 1.0; // Maximum urgency — emergency.
    }

    return 0;
  },

  execute(bb: Blackboard, store: MixiStore): void {
    log.warn('AI', `EMERGENCY: Dead air in ${bb.beatsToEndMaster.toFixed(1)} beats — engaging safety loop on ${bb.masterDeck}`);
    store.setAutoLoop(bb.masterDeck, 4);
  },
};
