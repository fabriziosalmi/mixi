/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – DSP Parameter Bus Layout
//
// Fixed memory layout for all DSP parameters, shared between
// the main thread (UI → params) and AudioWorklet (params → DSP).
//
// Each parameter is a 32-bit float (4 bytes).
// Offsets are in BYTES (for use with DataView / Atomics).
//
// Memory map:
//   [0..127]     Deck A parameters
//   [128..255]   Deck B parameters
//   [256..383]   Master parameters
//   [384..511]   Global / flags
//
// IMPORTANT: This layout MUST match the Rust ParamLayout
// in mixi-core when Wasm DSP is active.
// ─────────────────────────────────────────────────────────────

// ── Deck Parameter Offsets (relative to deck base) ───────────

/** Per-deck parameter offsets (relative, add DECK_A_BASE or DECK_B_BASE). */
export const DECK = {
  /** Pre-EQ trim gain (0.0–4.0, default 1.0). */
  TRIM:           0,
  /** EQ low shelf gain in dB (-26..+6, default 0). */
  EQ_LOW:         4,
  /** EQ mid peaking gain in dB (-26..+6, default 0). */
  EQ_MID:         8,
  /** EQ high shelf gain in dB (-26..+6, default 0). */
  EQ_HIGH:        12,
  /** Channel fader (0.0–1.0, default 1.0). */
  FADER:          16,
  /** Crossfader contribution (0.0–1.0, set by engine). */
  XFADER_GAIN:    20,
  /** Color FX filter frequency (20–20000 Hz). */
  COLOR_FREQ:     24,
  /** Color FX filter resonance (0.1–25). */
  COLOR_RES:      28,
  /** CUE (PFL) enabled (0.0 or 1.0). */
  CUE_ACTIVE:     32,
  /** Playback rate (0.5–2.0, default 1.0). */
  PLAYBACK_RATE:  36,

  // ── Per-deck FX parameters ─────────────────────────────────
  // Each FX has: amount (0–1), active (bool), + FX-specific params

  /** Filter (bipolar): amount 0-1. */
  FX_FLT_AMOUNT:  40,
  /** Filter: active flag. */
  FX_FLT_ACTIVE:  44,

  /** Delay: amount 0-1 (dry/wet). */
  FX_DLY_AMOUNT:  48,
  /** Delay: active flag. */
  FX_DLY_ACTIVE:  52,
  /** Delay: time in ms. */
  FX_DLY_TIME:    56,
  /** Delay: feedback 0-1. */
  FX_DLY_FEEDBACK: 60,

  /** Reverb: amount 0-1. */
  FX_REV_AMOUNT:  64,
  /** Reverb: active flag. */
  FX_REV_ACTIVE:  68,

  /** Phaser: amount 0-1. */
  FX_PHA_AMOUNT:  72,
  /** Phaser: active flag. */
  FX_PHA_ACTIVE:  76,

  /** Flanger: amount 0-1. */
  FX_FLG_AMOUNT:  80,
  /** Flanger: active flag. */
  FX_FLG_ACTIVE:  84,

  /** Gate: amount 0-1. */
  FX_GATE_AMOUNT: 88,
  /** Gate: active flag. */
  FX_GATE_ACTIVE: 92,

  /** Auto-gain multiplier (set on track load). */
  AUTO_GAIN:      96,
} as const;

// ── Deck Base Addresses ──────────────────────────────────────

/** Base byte offset for Deck A parameters. */
export const DECK_A_BASE = 0;
/** Base byte offset for Deck B parameters. */
export const DECK_B_BASE = 128;

// ── Master Parameter Offsets ─────────────────────────────────

/** Master bus parameter offsets. */
export const MASTER = {
  /** Master gain (0.0–1.5, default 1.0). */
  GAIN:           256,
  /** Master filter bipolar (-1..+1, 0 = bypass). */
  FILTER:         260,
  /** Distortion amount (0.0–1.0). */
  DISTORTION:     264,
  /** Distortion active flag. */
  DIST_ACTIVE:    268,
  /** Punch compressor amount (0.0–1.0). */
  PUNCH:          272,
  /** Punch active flag. */
  PUNCH_ACTIVE:   276,
  /** Limiter enabled flag. */
  LIMITER_ACTIVE: 280,
  /** Limiter threshold in dB (-20..0, default -1). */
  LIMITER_THRESH: 284,
} as const;

// ── Global Parameters ────────────────────────────────────────

/** Global / cross-cutting parameters. */
export const GLOBAL = {
  /** Crossfader position (0.0 = A, 0.5 = center, 1.0 = B). */
  CROSSFADER:     384,
  /** Crossfader curve type (0 = smooth, 1 = sharp, 2 = constant). */
  XFADER_CURVE:   388,
  /** Headphone mix (0.0 = CUE only, 1.0 = Master only). */
  HP_MIX:         392,
  /** Headphone level (0.0–1.5). */
  HP_LEVEL:       396,
  /** Sample rate (44100, 48000, etc.). */
  SAMPLE_RATE:    400,
  /** DSP backend active (0.0 = native, 1.0 = wasm). */
  DSP_BACKEND:    404,
  /** H2: Layout version magic (must match Rust). Written on init, checked by Rust. */
  LAYOUT_VERSION: 508,
} as const;

/** H2: ParamBus layout version. Increment when changing ANY offset above.
 *  Must match PARAM_LAYOUT_VERSION in mixi-core/src/dsp/engine.rs. */
export const PARAM_LAYOUT_VERSION = 2;

// ── Total Layout Size ────────────────────────────────────────

/** Total size of the parameter bus in bytes. Must be multiple of 4. */
export const PARAM_BUS_SIZE = 512;

// ── Helper: resolve deck-relative offset to absolute ─────────

import type { DeckId } from '../../types';

/** Get the absolute byte offset for a per-deck parameter. */
export function deckParam(deck: DeckId, param: number): number {
  return (deck === 'A' ? DECK_A_BASE : DECK_B_BASE) + param;
}
