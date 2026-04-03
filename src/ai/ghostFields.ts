/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Ghost Fields Registry
//
// A global mutable Set tracking which mixer controls the AI
// is currently manipulating.  Knobs/Faders read this to
// show purple "ghost" mode.
//
// The set is cleared at the start of each AI tick, then
// repopulated by whichever intents fire.
//
// NOT in Zustand — avoids 50ms re-render storms.
// UI components poll it during their own render cycle.
// ─────────────────────────────────────────────────────────────

/** Active ghost fields. Format: "A.eq.low", "B.volume", "crossfader". */
export const ghostFields = new Set<string>();

/** Clear all ghost fields (called at start of each AI tick). */
export function clearGhostFields(): void {
  ghostFields.clear();
}

/** Mark a field as AI-controlled for this tick. */
export function markGhost(field: string): void {
  ghostFields.add(field);
}

/** Check if a field is currently ghost-controlled. */
export function isGhost(field: string): boolean {
  return ghostFields.has(field);
}
