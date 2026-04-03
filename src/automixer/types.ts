/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – AutoMixer FSM Types
//
// Defines the 8 deterministic intents of a techno DJ mix,
// plus configuration constants.
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../types';

/**
 * The 8 sequential states of a single mix transition.
 *
 * MONITORING           → Deck A plays solo, watching for mix-out point
 * PREPARE_INCOMING     → 64 beats out: sync, kill bass B, cue to beat 1
 * PHRASE_SYNC_START    → 32 beats out: launch Deck B in silence
 * RAMP_UP_VOLUME       → 16 beats: fade B volume from 0 → 1
 * BASS_SWAP            → Instant: kill bass A, restore bass B
 * FILTER_WASHOUT       → 16 beats: highpass sweep on A (0 → +0.7)
 * FADE_OUT_EXIT        → 8 beats: fade A volume from 1 → 0
 * CLEANUP_AND_SWAP     → Instant: pause A, reset EQ/FX, swap roles → MONITORING
 */
export type AutoMixIntent =
  | 'MONITORING'
  | 'PREPARE_INCOMING'
  | 'PHRASE_SYNC_START'
  | 'RAMP_UP_VOLUME'
  | 'BASS_SWAP'
  | 'FILTER_WASHOUT'
  | 'FADE_OUT_EXIT'
  | 'CLEANUP_AND_SWAP';

/** Which deck is currently the "outgoing" (master) and which is "incoming". */
export interface DeckRoles {
  outgoing: DeckId;
  incoming: DeckId;
}

/** Configuration for the AutoMixer — all values in beats. */
export interface AutoMixConfig {
  /** Beats before mix-out to start preparing the incoming deck. */
  prepareLeadBeats: number;      // default: 64
  /** Beats before mix-out to launch the incoming deck. */
  launchLeadBeats: number;       // default: 32
  /** Duration of the volume fade-in (in beats). */
  fadeInBeats: number;           // default: 16
  /** Duration of the filter washout on outgoing deck (in beats). */
  washoutBeats: number;          // default: 16
  /** Duration of the final volume fade-out (in beats). */
  fadeOutBeats: number;          // default: 8
  /** EQ low kill value in dB for bass cutting. */
  bassKillDb: number;            // default: -26
  /** Max highpass Color FX value for washout. */
  washoutMaxFx: number;          // default: 0.7
}

/** Runtime snapshot of the FSM — exposed to the UI for visualisation. */
export interface AutoMixState {
  enabled: boolean;
  intent: AutoMixIntent;
  roles: DeckRoles;
  /** Progress through the current intent (0–1), for animated intents. */
  progress: number;
  /** Beat position where the current animated intent started. */
  intentStartBeat: number;
}
