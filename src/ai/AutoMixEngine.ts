/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – AutoMix Engine (Utility AI Arbiter)
//
// The "brain" that runs the DJ decision loop.
// Every 50 ms:
//   1. Update the Blackboard (sensor fusion)
//   2. Evaluate all registered intents (scoring)
//   3. Sort by score descending
//   4. Execute the top-scoring compatible intents
//
// Architecture: Utility AI
//   Unlike a simple FSM where states are mutually exclusive,
//   Utility AI lets multiple intents run simultaneously if
//   they're in different domains.  A SafetyLoop (domain=safety)
//   can fire at the same time as a FilterWashout (domain=dynamics).
//
//   Within a domain, if an intent is marked `exclusive`, it
//   blocks all lower-scored intents in that domain.
//
// Performance:
//   50 ms tick = 20 Hz.  At 170 BPM that's ~5.7 ticks per beat.
//   The Blackboard computation + 30 intent evaluations takes
//   < 1 ms total — zero main thread impact.
//
// Extensibility:
//   To add a new DJ move, create a file in src/ai/intents/
//   that exports a BaseIntent, then register it in the engine.
//   No other file needs to change.
// ─────────────────────────────────────────────────────────────

import type { BaseIntent, IntentDomain } from './intents/BaseIntent';
import type { Blackboard } from './Blackboard';
import { computeBlackboard } from './Blackboard';
import { useMixiStore } from '../store/mixiStore';
import { MixiEngine } from '../audio/MixiEngine';
import { log } from '../utils/logger';
import { clearGhostFields, markGhost } from './ghostFields';

// ── Tick config ──────────────────────────────────────────────

const TICK_INTERVAL_MS = 50;

// ── Scored intent (internal) ─────────────────────────────────

interface ScoredIntent {
  intent: BaseIntent;
  score: number;
}

// ── Engine state (for React subscription) ────────────────────

export interface AIEngineState {
  enabled: boolean;
  /** The intents that fired on the last tick, with their scores. */
  activeIntents: { name: string; domain: IntentDomain; score: number }[];
  /** Last blackboard snapshot (for debug UI). */
  blackboard: Blackboard | null;
  /** Total number of registered intents. */
  registeredCount: number;
}

// ─────────────────────────────────────────────────────────────
// AutoMixEngine – Singleton
// ─────────────────────────────────────────────────────────────

export class AutoMixEngine {
  private static instance: AutoMixEngine | null = null;

  private intents: BaseIntent[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private _enabled = false;
  private _lastBlackboard: Blackboard | null = null;
  private _lastFired: ScoredIntent[] = [];

  // ── React listeners ────────────────────────────────────────
  private listeners = new Set<(state: AIEngineState) => void>();

  static getInstance(): AutoMixEngine {
    if (!AutoMixEngine.instance) {
      AutoMixEngine.instance = new AutoMixEngine();
    }
    return AutoMixEngine.instance;
  }

  private constructor() {}

  // ── Intent registration ────────────────────────────────────

  /**
   * Register one or more intents.
   * Call this at app startup before calling start().
   */
  register(...newIntents: BaseIntent[]): void {
    for (const intent of newIntents) {
      // Prevent duplicates.
      if (!this.intents.some((i) => i.name === intent.name)) {
        this.intents.push(intent);
        log.info('AI', `Registered intent: ${intent.name} [${intent.domain}]`);
      }
    }
  }

  /** Remove an intent by name. */
  unregister(name: string): void {
    this.intents = this.intents.filter((i) => i.name !== name);
  }

  /** List all registered intent names. */
  get registeredIntents(): string[] {
    return this.intents.map((i) => i.name);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  start(): void {
    if (this._enabled) return;
    if (!MixiEngine.getInstance().isInitialized) {
      log.warn('AI', 'Cannot start — audio engine not initialised');
      return;
    }

    this._enabled = true;
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    log.success('AI', `Engine started — ${this.intents.length} intents registered`);
    this.notify();
  }

  stop(): void {
    if (!this._enabled) return;
    this._enabled = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this._lastFired = [];
    log.info('AI', 'Engine stopped');
    this.notify();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  // ── The Core Loop ──────────────────────────────────────────

  private tick(): void {
    // ── 0. User Override Guard ───────────────────────────────
    //
    // Respects the "Cruise Control" pattern:
    //   OFF    → AI does nothing, early return.
    //   CRUISE → AI runs, but any user touch killed it (store already set OFF).
    //   ASSIST → AI runs, but pauses when user interacts.
    //            Resumes after `assistResumeDelay` seconds of inactivity.

    const ai = useMixiStore.getState().ai;

    if (ai.mode === 'OFF') return;

    if (ai.mode === 'ASSIST' && ai.isPaused) {
      const elapsed = (Date.now() - ai.lastInteractionTime) / 1000;
      if (elapsed >= ai.assistResumeDelay) {
        // User hasn't touched anything for N seconds — resume.
        useMixiStore.getState().setAiPaused(false);
        log.info('AI', 'ASSIST mode resuming after user inactivity');
      } else {
        // Still paused — skip this tick.
        return;
      }
    }

    // ── 0b. Clear ghost fields from previous tick ──────────────
    clearGhostFields();

    // ── 1. Sense: compute blackboard ─────────────────────────
    const bb = computeBlackboard();
    this._lastBlackboard = bb;

    // No point evaluating if nothing is playing.
    if (!bb.masterState.isPlaying) {
      this._lastFired = [];
      return;
    }

    // ── 2. Score: evaluate all intents ───────────────────────
    const scored: ScoredIntent[] = [];
    for (const intent of this.intents) {
      const score = intent.evaluate(bb);
      if (score > 0) {
        scored.push({ intent, score });
      }
    }

    // Sort descending by score.
    scored.sort((a, b) => b.score - a.score);

    // ── 3. Arbitrate: select compatible intents ──────────────
    //
    // Rules:
    //   - Walk the sorted list top-down.
    //   - Fire each intent unless its domain is already "locked"
    //     by a higher-scoring exclusive intent.
    //   - Non-exclusive intents can stack freely.

    const lockedDomains = new Set<IntentDomain>();
    const toFire: ScoredIntent[] = [];

    for (const entry of scored) {
      const { intent } = entry;

      // Skip if this domain is locked by a higher-priority exclusive.
      if (lockedDomains.has(intent.domain)) continue;

      toFire.push(entry);

      // If this intent is exclusive, lock the domain.
      if (intent.exclusive) {
        lockedDomains.add(intent.domain);
      }
    }

    // ── 4. Act: execute winners ──────────────────────────────
    //
    // Wrap the store in a Proxy that automatically marks ghost
    // fields whenever an intent mutates a control.  This way
    // individual intents don't need to know about ghostFields.
    const store = useMixiStore.getState();
    const ghostStore = this.createGhostProxy(store);
    for (const { intent } of toFire) {
      intent.execute(bb, ghostStore);
    }

    // Only notify if the set of active intents actually changed.
    const prevNames = this._lastFired.map(({ intent }) => intent.name).join(',');
    const nextNames = toFire.map(({ intent }) => intent.name).join(',');
    this._lastFired = toFire;
    if (prevNames !== nextNames) this.notify();
  }

  // ── State for React ────────────────────────────────────────

  get state(): AIEngineState {
    return {
      enabled: this._enabled,
      activeIntents: this._lastFired.map(({ intent, score }) => ({
        name: intent.name,
        domain: intent.domain,
        score,
      })),
      blackboard: this._lastBlackboard,
      registeredCount: this.intents.length,
    };
  }

  subscribe(fn: (state: AIEngineState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }

  // ── Ghost Field Proxy ─────────────────────────────────────
  //
  // Returns a thin wrapper around the store that intercepts
  // control-mutating methods and calls markGhost() with a
  // canonical field key (e.g. "A.eq.low", "B.volume", "master.volume").
  //
  // The UI reads ghostFields to decide which knobs glow purple.

  private createGhostProxy(store: ReturnType<typeof useMixiStore.getState>) {
    type Store = typeof store;

    const wrap = <K extends keyof Store>(key: K, ghostFn: (...args: unknown[]) => void): Store[K] => {
      const orig = store[key];
      if (typeof orig !== 'function') return orig;
      return ((...args: unknown[]) => {
        ghostFn(...args);
        return (orig as (...a: unknown[]) => unknown)(...args);
      }) as Store[K];
    };

    return {
      ...store,
      setDeckGain: wrap('setDeckGain', (deck) => markGhost(`${deck}.gain`)),
      setDeckEq: wrap('setDeckEq', (deck, band) => markGhost(`${deck}.eq.${band}`)),
      setDeckVolume: wrap('setDeckVolume', (deck) => markGhost(`${deck}.volume`)),
      setDeckColorFx: wrap('setDeckColorFx', (deck) => markGhost(`${deck}.colorFx`)),
      setDeckPlaybackRate: wrap('setDeckPlaybackRate', (deck) => markGhost(`${deck}.playbackRate`)),
      setMasterVolume: wrap('setMasterVolume', () => markGhost('master.volume')),
      setCrossfader: wrap('setCrossfader', () => markGhost('crossfader')),
      setAutoLoop: wrap('setAutoLoop', (deck) => markGhost(`${deck}.autoLoop`)),
    };
  }
}
