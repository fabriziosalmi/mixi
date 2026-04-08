/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Set Recorder — Records every AI decision for post-set analysis
//
// Every tick that produces an action, the recorder captures:
//   - Timestamp (wall clock)
//   - Blackboard snapshot (compressed)
//   - Active intents + scores
//   - Actions taken (store mutations)
//
// The recording is stored as a JSON-serializable array that can
// be exported, replayed, and analyzed to:
//   1. Debug AI behavior
//   2. Learn the DJ's mixing style
//   3. Generate post-set analytics (total transitions, avg blend
//      duration, most-used intents, etc.)
//
// Storage: In-memory during session. Exported to localStorage
// on demand or automatically when AI stops.
//
// Performance: ~100 bytes per event, 20 events/sec max.
// A 4-hour set = ~30 MB uncompressed. With compression (only
// recording when intents change), typically ~500 KB.
// ─────────────────────────────────────────────────────────────

import type { Blackboard } from './Blackboard';

// ── Types ────────────────────────────────────────────────────

/** A single recorded action (store mutation). */
export interface RecordedAction {
  /** Method name (e.g. 'setDeckEq', 'setDeckVolume'). */
  method: string;
  /** Arguments passed to the method. */
  args: unknown[];
}

/** A single recorded tick event. */
export interface SetRecordEvent {
  /** Wall clock ISO timestamp. */
  ts: string;
  /** Tick number. */
  tick: number;
  /** Elapsed seconds since recording started. */
  elapsed: number;
  /** Active intents with scores. */
  intents: { name: string; score: number }[];
  /** Actions taken by the AI this tick. */
  actions: RecordedAction[];
  /** Compressed blackboard snapshot (key metrics only). */
  bb: CompressedBlackboard;
}

/** Minimal blackboard snapshot for recording (saves space). */
export interface CompressedBlackboard {
  masterDeck: string;
  masterBpm: number;
  masterBeat: number;
  beatsToEnd: number;
  incomingBpm: number;
  incomingBeat: number;
  phaseDeltaMs: number;
  isBlending: boolean;
  bassClash: boolean;
  masterKey: string;
  incomingKey: string;
}

/** Post-set analytics summary. */
export interface SetAnalytics {
  /** Total recording duration (seconds). */
  durationSec: number;
  /** Total number of events recorded. */
  totalEvents: number;
  /** Number of ticks with at least one action. */
  activeTicks: number;
  /** Intent frequency: how many times each intent fired. */
  intentCounts: Record<string, number>;
  /** Top 5 most-fired intents. */
  topIntents: { name: string; count: number }[];
  /** Number of bass swaps detected. */
  bassSwaps: number;
  /** Number of safety interventions. */
  safetyInterventions: number;
  /** Average phase drift when correction fired (ms). */
  avgPhaseDrift: number;
  /** Number of unique tracks mixed (estimated from role swaps). */
  estimatedTransitions: number;
}

// ── SetRecorder Class ────────────────────────────────────────

export class SetRecorder {
  private events: SetRecordEvent[] = [];
  private startTime = 0;
  private isRecording = false;
  private lastIntentHash = '';

  // ── Lifecycle ──────────────────────────────────────────────

  start(): void {
    this.events = [];
    this.startTime = Date.now();
    this.isRecording = true;
    this.lastIntentHash = '';
  }

  stop(): void {
    this.isRecording = false;
  }

  get recording(): boolean {
    return this.isRecording;
  }

  get eventCount(): number {
    return this.events.length;
  }

  // ── Recording ──────────────────────────────────────────────

  /**
   * Record a tick. Only stores events when intents change
   * (delta compression) to keep memory usage low.
   */
  recordTick(
    bb: Blackboard,
    activeIntents: { name: string; score: number }[],
    actions: RecordedAction[],
  ): void {
    if (!this.isRecording) return;

    // Delta compression: only record when intent set changes
    // or when actions were taken.
    const intentHash = activeIntents.map(i => i.name).join(',');
    if (intentHash === this.lastIntentHash && actions.length === 0) {
      return;
    }
    this.lastIntentHash = intentHash;

    const event: SetRecordEvent = {
      ts: new Date().toISOString(),
      tick: bb.tick,
      elapsed: (Date.now() - this.startTime) / 1000,
      intents: activeIntents.map(i => ({ name: i.name, score: Math.round(i.score * 100) / 100 })),
      actions: actions.map(a => ({
        method: a.method,
        args: a.args.map(arg =>
          typeof arg === 'number' ? Math.round(arg * 1000) / 1000 : arg
        ),
      })),
      bb: compressBlackboard(bb),
    };

    this.events.push(event);
  }

  // ── Export ──────────────────────────────────────────────────

  /** Get all recorded events. */
  getEvents(): ReadonlyArray<SetRecordEvent> {
    return this.events;
  }

  /** Export as JSON string. */
  toJSON(): string {
    return JSON.stringify({
      version: 1,
      startedAt: new Date(this.startTime).toISOString(),
      events: this.events,
      analytics: this.analyze(),
    }, null, 0); // No pretty-print to save space.
  }

  /** Save to localStorage. */
  saveToLocal(): void {
    try {
      const key = `mixi_set_recording_${this.startTime}`;
      const json = this.toJSON();
      localStorage.setItem(key, json);
      // Keep only last 5 recordings.
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith('mixi_set_recording_'))
        .sort();
      while (keys.length > 5) {
        localStorage.removeItem(keys.shift()!);
      }
    } catch {
      // localStorage full or unavailable — silently fail.
    }
  }

  // ── Analytics ──────────────────────────────────────────────

  /** Compute post-set analytics. */
  analyze(): SetAnalytics {
    const intentCounts: Record<string, number> = {};
    let activeTicks = 0;
    let bassSwaps = 0;
    let safetyInterventions = 0;
    let phaseDriftSum = 0;
    let phaseDriftCount = 0;
    let masterDeckChanges = 0;
    let lastMaster = '';

    for (const event of this.events) {
      if (event.actions.length > 0) activeTicks++;

      for (const intent of event.intents) {
        intentCounts[intent.name] = (intentCounts[intent.name] || 0) + 1;

        if (intent.name === 'spectral.drop_swap') bassSwaps++;
        if (intent.name.startsWith('safety.')) safetyInterventions++;
        if (intent.name === 'safety.phase_drift_correction') {
          phaseDriftSum += Math.abs(event.bb.phaseDeltaMs);
          phaseDriftCount++;
        }
      }

      if (event.bb.masterDeck !== lastMaster && lastMaster !== '') {
        masterDeckChanges++;
      }
      lastMaster = event.bb.masterDeck;
    }

    const durationSec = this.events.length > 0
      ? this.events[this.events.length - 1].elapsed : 0;

    // Sort intents by frequency.
    const sorted = Object.entries(intentCounts)
      .sort(([, a], [, b]) => b - a);
    const topIntents = sorted.slice(0, 5).map(([name, count]) => ({ name, count }));

    return {
      durationSec: Math.round(durationSec),
      totalEvents: this.events.length,
      activeTicks,
      intentCounts,
      topIntents,
      bassSwaps,
      safetyInterventions,
      avgPhaseDrift: phaseDriftCount > 0
        ? Math.round(phaseDriftSum / phaseDriftCount * 10) / 10 : 0,
      estimatedTransitions: masterDeckChanges,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function compressBlackboard(bb: Blackboard): CompressedBlackboard {
  return {
    masterDeck: bb.masterDeck,
    masterBpm: Math.round(bb.masterBpm * 10) / 10,
    masterBeat: Math.round(bb.masterCurrentBeat * 10) / 10,
    beatsToEnd: Math.round(bb.beatsToEndMaster),
    incomingBpm: Math.round(bb.incomingBpm * 10) / 10,
    incomingBeat: Math.round(bb.incomingCurrentBeat * 10) / 10,
    phaseDeltaMs: Math.round(bb.phaseDeltaMs * 10) / 10,
    isBlending: bb.isBlending,
    bassClash: bb.bassClash,
    masterKey: bb.masterKey,
    incomingKey: bb.incomingKey,
  };
}

// ── Singleton ────────────────────────────────────────────────

let _instance: SetRecorder | null = null;

export function getSetRecorder(): SetRecorder {
  if (!_instance) {
    _instance = new SetRecorder();
  }
  return _instance;
}
