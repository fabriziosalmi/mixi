/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Akai MIDI Mix Preset
//
// Default CC/Note map for the Akai MIDI Mix controller.
// Channel 1, factory layout.
//
// Physical layout (left → right, top → bottom):
//   Row 1: 8 knobs  (CC 16–23)
//   Row 2: 8 knobs  (CC 24–31)  
//   Row 3: 8 knobs  (CC 46–53)
//   Buttons: 2 rows of 8 (Notes 1–8 mute, 9–16 rec arm)
//   Faders: 8 faders (CC 48–55) + master (CC 62)
// ─────────────────────────────────────────────────────────────

import type { MidiMapping } from '../MidiManager';

const PORT = ''; // matches any port

function cc(channel: number, control: number, action: MidiMapping['action']): MidiMapping {
  return { portId: PORT, type: 'cc', channel, control, action };
}

function note(channel: number, noteNum: number, action: MidiMapping['action']): MidiMapping {
  return { portId: PORT, type: 'note', channel, control: noteNum, action };
}

/**
 * Akai MIDI Mix — default factory CC map.
 *
 * Mapping rationale:
 *   Columns 1–4 → Deck A controls
 *   Columns 5–8 → Deck B controls
 *   Master fader → Crossfader
 *
 * Row 1 (CC 16–23): EQ High, EQ Mid, EQ Low, Gain × 2 decks
 * Row 2 (CC 24–31): Filter (Color FX), reserved × 2 decks
 * Faders (CC 48–51): Deck A Vol | Faders (CC 52–55): Deck B Vol
 * Master Fader (CC 62): Crossfader
 * Mute buttons (Note 1–8): Play, CUE, Sync, _ × 2 decks
 */
export const AKAI_MIDI_MIX_PRESET: MidiMapping[] = [
  // ── Row 1: EQ + Gain ───────────────────────────────────────
  // Deck A
  cc(0, 16, { type: 'DECK_EQ_HIGH', deck: 'A' }),
  cc(0, 17, { type: 'DECK_EQ_MID', deck: 'A' }),
  cc(0, 18, { type: 'DECK_EQ_LOW', deck: 'A' }),
  cc(0, 19, { type: 'DECK_GAIN', deck: 'A' }),
  // Deck B
  cc(0, 20, { type: 'DECK_EQ_HIGH', deck: 'B' }),
  cc(0, 21, { type: 'DECK_EQ_MID', deck: 'B' }),
  cc(0, 22, { type: 'DECK_EQ_LOW', deck: 'B' }),
  cc(0, 23, { type: 'DECK_GAIN', deck: 'B' }),

  // ── Row 2: Color FX / Filter ───────────────────────────────
  cc(0, 24, { type: 'DECK_FILTER', deck: 'A' }),
  cc(0, 28, { type: 'DECK_FILTER', deck: 'B' }),

  // ── Row 3: Headphone / Master ──────────────────────────────
  cc(0, 46, { type: 'HEADPHONE_MIX' }),
  cc(0, 47, { type: 'HEADPHONE_LEVEL' }),
  cc(0, 50, { type: 'MASTER_VOL' }),

  // ── Faders ─────────────────────────────────────────────────
  // Use first fader for each deck's channel volume
  cc(0, 48, { type: 'DECK_VOL', deck: 'A' }),
  cc(0, 49, { type: 'DECK_PITCH', deck: 'A' }),
  cc(0, 52, { type: 'DECK_VOL', deck: 'B' }),
  cc(0, 53, { type: 'DECK_PITCH', deck: 'B' }),

  // ── Master Fader → Crossfader ──────────────────────────────
  cc(0, 62, { type: 'CROSSFADER' }),

  // ── Mute Buttons (Note ON) ────────────────────────────────
  // Deck A
  note(0, 1, { type: 'DECK_PLAY', deck: 'A' }),
  note(0, 2, { type: 'DECK_CUE', deck: 'A' }),
  note(0, 3, { type: 'DECK_SYNC', deck: 'A' }),
  // Deck B
  note(0, 5, { type: 'DECK_PLAY', deck: 'B' }),
  note(0, 6, { type: 'DECK_CUE', deck: 'B' }),
  note(0, 7, { type: 'DECK_SYNC', deck: 'B' }),
];
