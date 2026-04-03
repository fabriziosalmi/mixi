/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Core Audio Type Definitions
// Shared types for the entire audio pipeline.
// ─────────────────────────────────────────────────────────────

/** Identifiers for the two physical decks. */
export type DeckId = 'A' | 'B';

/** Three-band EQ band names matching a hardware mixer. */
export type EqBand = 'low' | 'mid' | 'high';

/** EQ value in dB: -40 (kill) to +6 (boost), 0 = flat. */
export type EqValue = number;

/** Normalised 0–1 range used for volumes, crossfader position, etc. */
export type UnitValue = number;

/** Color FX value: -1 (LowPass full) → 0 (off) → +1 (HighPass full). */
export type ColorFxValue = number;

/** Playback rate: 0.92–1.08 for ±8 % pitch range. */
export type PlaybackRate = number;

/**
 * Per-deck EQ state (dB values).
 *  -40 = total kill
 *    0 = flat
 *   +6 = boost
 */
export interface EqState {
  low: EqValue;
  mid: EqValue;
  high: EqValue;
}

/** One data point in the RGB waveform (energy per band, 0–1). */
export interface WaveformPoint {
  low: number;
  mid: number;
  high: number;
}

/** Active loop state. */
export interface LoopState {
  start: number;     // seconds
  end: number;       // seconds
  lengthInBeats: number;
}

/** Number of hot cue slots per deck. */
export const HOT_CUE_COUNT = 8;

/** Gain/trim dB range: -12 to +12, 0 = unity. */
export type GainValue = number;

/** Complete state snapshot of a single deck. */
export interface DeckState {
  isPlaying: boolean;
  isTrackLoaded: boolean;
  /** Channel gain/trim in dB (-12 to +12, 0 = unity). */
  gain: GainValue;
  volume: UnitValue;
  eq: EqState;
  colorFx: ColorFxValue;
  playbackRate: PlaybackRate;
  waveformData: WaveformPoint[] | null;
  duration: number;
  /** Detected BPM (adjusted by playbackRate for display). */
  bpm: number;
  /** Original BPM at playbackRate = 1.0 (never changes once detected). */
  originalBpm: number;
  /** Time of the first downbeat in seconds (grid phase). */
  firstBeatOffset: number;
  /** True if this deck has been synced to the other deck's tempo. */
  isSynced: boolean;
  /** 8 hot cue slots — timestamp in seconds, or null if empty. */
  hotCues: (number | null)[];
  /** Currently active loop, or null if no loop. */
  activeLoop: LoopState | null;
  /** When true, hot cues and loops snap to the nearest beat. */
  quantize: boolean;
  /** When true, pitch stays locked while tempo changes. */
  keyLock: boolean;
  /** PFL (Pre-Fader Listen) cue button state. */
  cueActive: boolean;
  /** Name of the loaded track. */
  trackName: string;
  /** Beat numbers where drops were detected, sorted by strength. */
  dropBeats: number[];
  /** Musical key in Camelot notation (e.g. "8A", "11B"). */
  musicalKey: string;
}

/** Master section state. */
export interface MasterState {
  volume: UnitValue;
  /** Bipolar master filter: -1 (LPF full) → 0 (off) → +1 (HPF full). */
  filter: number;
  /** Master distortion amount (0 = off, 1 = max). */
  distortion: UnitValue;
  /** Punch parallel compression (0 = off, 1 = max). */
  punch: UnitValue;
}

/** Headphone monitoring state. */
export interface HeadphoneState {
  /** Headphone output level (0–1). */
  level: UnitValue;
  /**
   * CUE / MASTER mix knob.
   *   0 = 100 % CUE (pre-fader listen only)
   *   1 = 100 % MASTER (hear the main output)
   */
  mix: UnitValue;
  /** Mono Split: L = Headphone, R = Master. */
  splitMode: boolean;
}

/** AI control mode — like a car's cruise control selector. */
export type AiMode = 'OFF' | 'CRUISE' | 'ASSIST';

/** AI subsystem state. */
export interface AiState {
  mode: AiMode;
  /** True when ASSIST mode is temporarily paused due to user interaction. */
  isPaused: boolean;
  /** Timestamp (Date.now()) of the last human interaction with any control. */
  lastInteractionTime: number;
  /** Seconds of inactivity before ASSIST mode resumes. */
  assistResumeDelay: number;
}

/** Crossfader curve type. */
export type CrossfaderCurve = 'smooth' | 'sharp';

/** What occupies a deck slot – a normal track player or a groovebox module. */
export type DeckMode = 'track' | 'groovebox';

/** Full mixer surface state – what an external controller (or AI agent) sees. */
export interface MixerState {
  master: MasterState;
  crossfader: UnitValue;
  crossfaderCurve: CrossfaderCurve;
  headphones: HeadphoneState;
  ai: AiState;
  decks: Record<DeckId, DeckState>;
  /** What module occupies each deck slot. */
  deckModes: Record<DeckId, DeckMode>;
}
