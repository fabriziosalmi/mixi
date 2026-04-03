/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Central Color Theme
//
// All colors defined as CSS custom properties in index.css.
// This module provides:
//   1. Static constants (legacy compat, used as fallbacks)
//   2. themeVar() — reads live CSS var for canvas/JS contexts
//   3. CUE_COLORS array for hot-cue palette
// ─────────────────────────────────────────────────────────────

/**
 * Read a CSS custom property from body at runtime.
 * Use for canvas drawing or any JS context that needs the hex value.
 * Falls back to `fallback` during SSR or if the variable is unset.
 */
export function themeVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(`--${name}`).trim();
  return v || fallback;
}

/** Deck A accent — electric cyan. */
export const COLOR_DECK_A = '#00f0ff';

/** Deck B accent — warm orange. */
export const COLOR_DECK_B = '#ff6a00';

/** Master section accent — purple. */
export const COLOR_MASTER = '#a855f7';

/** CUE/PFL and Headphone accent — neutral white/grey. */
export const COLOR_CUE = COLOR_DECK_B;
export const COLOR_HP = '#888';

/** AI active accent. */
export const COLOR_AI = '#00f0ff';

/** Hot cue pad colours (Rekordbox standard, 8 slots). */
export const CUE_COLORS = [
  '#22c55e', // 1 green
  '#ef4444', // 2 red
  '#3b82f6', // 3 blue
  '#f59e0b', // 4 amber
  '#a855f7', // 5 purple
  '#ec4899', // 6 pink
  '#06b6d4', // 7 cyan
  '#ff6a00', // 8 orange
] as const;
