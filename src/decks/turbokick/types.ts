/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – TurboKick Types  (v3 — Kick-Core Module)
// ─────────────────────────────────────────────────────────────

/** Number of steps in one pattern. */
export const STEP_COUNT = 16;

/** Kick synth parameter identifiers. */
export type SynthParamId = 'pitch' | 'decay' | 'click' | 'drive';

/** FX knob identifiers. */
export type FxKnobId = 'filter' | 'resonance' | 'delay' | 'lfoRate' | 'lfoDepth' | 'thump' | 'rumble' | 'tune';

/** Valve identifiers. */
export type ValveId = 'tubeA' | 'punchB';

/** Runtime state exposed to the UI. */
export interface TurboKickSnapshot {
  isPlaying: boolean;
  engaged: boolean;             // true = waiting for downbeat to start
  currentStep: number;          // 0–15, -1 when stopped
  bpm: number;
  syncToMaster: boolean;
  /** Which steps are enabled. */
  steps: boolean[];             // length = STEP_COUNT
  /** Kick synth parameters (0–1). */
  synth: Record<SynthParamId, number>;
  /** FX knob values (0–1). */
  fx: Record<FxKnobId, number>;
  /** Valve drive amounts (0–1). */
  valves: Record<ValveId, number>;
  masterVolume: number;         // 0–1
  swing: number;                // 0–0.5
}

/** Default synth state. */
export function defaultSynth(): Record<SynthParamId, number> {
  return { pitch: 0.35, decay: 0.5, click: 0.3, drive: 0 };
}

/** Default FX state. */
export function defaultFx(): Record<FxKnobId, number> {
  return { filter: 0.75, resonance: 0, delay: 0, lfoRate: 0, lfoDepth: 0, thump: 0.5, rumble: 0, tune: 0.35 };
}

/** Default valve state. */
export function defaultValves(): Record<ValveId, number> {
  return { tubeA: 0, punchB: 0 };
}

/** Default step pattern — kick on every beat (0, 4, 8, 12). */
export function defaultSteps(): boolean[] {
  return Array.from({ length: STEP_COUNT }, (_, i) => i % 4 === 0);
}
