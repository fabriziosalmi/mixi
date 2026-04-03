/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Groovebox Types
// ─────────────────────────────────────────────────────────────

/** Drum voice identifier. */
export type VoiceId = 'kick' | 'snare' | 'hat' | 'perc';

/** Order of voices in the grid. */
export const VOICES: VoiceId[] = ['kick', 'snare', 'hat', 'perc'];

/** Number of steps in one pattern. */
export const STEP_COUNT = 16;

/** A single voice track: 16 steps + per-voice volume. */
export interface VoiceTrack {
  steps: boolean[];
  volume: number;    // 0–1
}

/** Full groovebox pattern. */
export type Pattern = Record<VoiceId, VoiceTrack>;

/** Per-voice mixer channel state (independent of pattern data). */
export interface VoiceMixerState {
  pan: number;      // -1 (L) to 1 (R)
  mute: boolean;
  solo: boolean;
}

/** Mixer state for all voices. */
export type VoiceMixer = Record<VoiceId, VoiceMixerState>;

/** Default mixer state (centered, unmuted, no solo). */
export function defaultVoiceMixer(): VoiceMixer {
  const mk = (): VoiceMixerState => ({ pan: 0, mute: false, solo: false });
  return { kick: mk(), snare: mk(), hat: mk(), perc: mk() };
}

/** Runtime state exposed to the UI. */
export interface GrooveboxSnapshot {
  isPlaying: boolean;
  currentStep: number;       // 0–15, -1 when stopped
  bpm: number;
  syncToMaster: boolean;
  pattern: Pattern;
  mixer: VoiceMixer;
  masterVolume: number;      // 0–1
  swing: number;             // 0–0.5
}

/** Create a default empty pattern. */
export function defaultPattern(): Pattern {
  const mk = (): VoiceTrack => ({
    steps: Array.from({ length: STEP_COUNT }, () => false),
    volume: 0.8,
  });
  return { kick: mk(), snare: mk(), hat: mk(), perc: mk() };
}

/** A classic four-on-the-floor starter pattern. */
export function fourOnFloorPattern(): Pattern {
  const p = defaultPattern();
  // Kick: 1, 5, 9, 13
  [0, 4, 8, 12].forEach((i) => (p.kick.steps[i] = true));
  // Snare: 5, 13
  [4, 12].forEach((i) => (p.snare.steps[i] = true));
  // Hat: every even step
  [0, 2, 4, 6, 8, 10, 12, 14].forEach((i) => (p.hat.steps[i] = true));
  // Perc: offbeats
  [2, 6, 10, 14].forEach((i) => (p.perc.steps[i] = true));
  return p;
}
