/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// useHaptics — Vibration feedback for mobile DJ controls
//
// Uses the Vibration API (Chrome Android, Firefox Android).
// Degrades silently on iOS Safari (no vibration support).
// Zero state, zero effects — pure utility wrapper.
//
// Patterns:
//   tick()    — 8ms pulse: pad tap, beat marker, scrub start
//   snap()   — 15ms pulse: crossfader center detent
//   confirm() — double-tap: cue saved, sync locked
//   panic()  — 100ms: panic reset confirmation
// ─────────────────────────────────────────────────────────────

const vibrate = typeof navigator !== 'undefined' && navigator.vibrate
  ? (pattern: number | number[]) => { try { navigator.vibrate(pattern); } catch { /* noop */ } }
  : () => {};

export function useHaptics() {
  return {
    tick: () => vibrate(8),
    snap: () => vibrate(15),
    confirm: () => vibrate([10, 30, 10]),
    panic: () => vibrate(100),
  };
}
