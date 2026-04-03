/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – AutoMixer FSM (Deterministic Finite State Machine)
//
// A "shadow DJ" that reads the mixer state and moves faders
// according to 8 deterministic intents.  No AI, no ML —
// pure techno math.
//
// The FSM runs via tick() called every 100 ms.
// Each tick:
//   1. Reads currentTime + state from the engine & store
//   2. Evaluates which intent should be active
//   3. Executes the intent's actions (set faders, EQ, FX)
//
// All actions go through the Zustand store, which means:
//   - useMixiSync forwards them to MixiEngine (audio changes)
//   - React UI updates reactively (knobs move on screen)
//   - The MCP bridge broadcasts to any connected AI
//
// When the AI arrives, it will OVERRIDE specific intents
// (e.g. "skip RAMP_UP, do an aggressive BASS_SWAP now").
// The FSM provides the deterministic fallback.
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../types';
import { useMixiStore } from '../store/mixiStore';
import { MixiEngine } from '../audio/MixiEngine';
import { log } from '../utils/logger';
import type { AutoMixIntent, AutoMixConfig, AutoMixState, DeckRoles } from './types';
import {
  timeToBeat,
  calcMixOutBeat,
  lerpProgress,
} from './beatUtils';

// ── Default config ───────────────────────────────────────────

const DEFAULT_CONFIG: AutoMixConfig = {
  prepareLeadBeats: 64,
  launchLeadBeats: 32,
  fadeInBeats: 16,
  washoutBeats: 16,
  fadeOutBeats: 8,
  bassKillDb: -26,
  washoutMaxFx: 0.7,
};

// ── Tick interval ────────────────────────────────────────────

const TICK_INTERVAL_MS = 100;

// ─────────────────────────────────────────────────────────────
// AutoMixer Class
// ─────────────────────────────────────────────────────────────

export class AutoMixer {
  private config: AutoMixConfig;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // ── FSM state ──────────────────────────────────────────────
  private _intent: AutoMixIntent = 'MONITORING';
  private _roles: DeckRoles = { outgoing: 'A', incoming: 'B' };
  private _intentStartBeat = 0;
  private _enabled = false;

  // ── Listeners (for React) ──────────────────────────────────
  private listeners = new Set<(state: AutoMixState) => void>();

  constructor(config: Partial<AutoMixConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ─────────────────────────────────────────────

  get state(): AutoMixState {
    return {
      enabled: this._enabled,
      intent: this._intent,
      roles: { ...this._roles },
      progress: 0, // updated live during tick
      intentStartBeat: this._intentStartBeat,
    };
  }

  start(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._intent = 'MONITORING';

    // Determine initial roles: whichever deck is playing is outgoing.
    const s = useMixiStore.getState();
    if (s.decks.B.isPlaying && !s.decks.A.isPlaying) {
      this._roles = { outgoing: 'B', incoming: 'A' };
    } else {
      this._roles = { outgoing: 'A', incoming: 'B' };
    }

    log.success('AutoMixer', `Started — ${this._roles.outgoing} is outgoing`);
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.notify();
  }

  stop(): void {
    if (!this._enabled) return;
    this._enabled = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    log.info('AutoMixer', 'Stopped');
    this.notify();
  }

  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(fn: (state: AutoMixState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── FSM Tick ───────────────────────────────────────────────

  private tick(): void {
    if (!this._enabled) return;

    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const store = useMixiStore.getState();
    const { outgoing, incoming } = this._roles;
    const outDeck = store.decks[outgoing];
    const inDeck = store.decks[incoming];

    // Can't do anything without BPM data on the outgoing deck.
    if (outDeck.bpm <= 0 || !outDeck.isPlaying) return;

    const outTime = engine.getCurrentTime(outgoing);
    const outBeat = timeToBeat(outTime, outDeck.bpm, outDeck.firstBeatOffset);
    const mixOutBeat = calcMixOutBeat(
      outDeck.duration,
      outDeck.bpm,
      outDeck.firstBeatOffset,
    );
    const beatsToMixOut = mixOutBeat - outBeat;

    // ── Intent evaluation ────────────────────────────────────

    switch (this._intent) {
      case 'MONITORING':
        this.tickMonitoring(beatsToMixOut, inDeck.isTrackLoaded);
        break;

      case 'PREPARE_INCOMING':
        this.tickPrepareIncoming(beatsToMixOut, incoming, outDeck.bpm);
        break;

      case 'PHRASE_SYNC_START':
        this.tickPhraseSyncStart(beatsToMixOut, incoming);
        break;

      case 'RAMP_UP_VOLUME':
        this.tickRampUpVolume(outBeat, incoming);
        break;

      case 'BASS_SWAP':
        this.tickBassSwap(outgoing, incoming);
        break;

      case 'FILTER_WASHOUT':
        this.tickFilterWashout(outBeat, outgoing);
        break;

      case 'FADE_OUT_EXIT':
        this.tickFadeOutExit(outBeat, outgoing);
        break;

      case 'CLEANUP_AND_SWAP':
        this.tickCleanupAndSwap(outgoing);
        break;
    }
  }

  // ── Intent Handlers ────────────────────────────────────────

  /**
   * MONITORING: Watch the outgoing deck.
   * Transition → PREPARE_INCOMING when 64 beats remain
   * and the incoming deck has a track loaded.
   */
  private tickMonitoring(beatsToMixOut: number, incomingHasTrack: boolean): void {
    if (beatsToMixOut <= this.config.prepareLeadBeats && incomingHasTrack) {
      this.transition('PREPARE_INCOMING');
    }
  }

  /**
   * PREPARE_INCOMING: Sync BPM, kill bass, set volume to 0.
   * All instant (snap) operations.
   * Transition → PHRASE_SYNC_START when 32 beats remain.
   */
  private tickPrepareIncoming(
    beatsToMixOut: number,
    incoming: DeckId,
    _outBpm: number,
  ): void {
    const store = useMixiStore.getState();
    const inDeck = store.decks[incoming];

    // Sync once.
    if (!inDeck.isSynced && inDeck.originalBpm > 0) {
      store.syncDeck(incoming);
      log.info('AutoMixer', `Synced ${incoming} to outgoing BPM`);
    }

    // Kill bass on incoming.
    if (inDeck.eq.low > this.config.bassKillDb) {
      store.setDeckEq(incoming, 'low', this.config.bassKillDb);
    }

    // Volume to 0.
    if (inDeck.volume > 0) {
      store.setDeckVolume(incoming, 0);
    }

    // Seek to first beat (Hot Cue 0 if set, else firstBeatOffset).
    // Only do this once.
    if (!inDeck.isPlaying) {
      const cue0 = inDeck.hotCues[0];
      const seekTo = cue0 !== null ? cue0 : inDeck.firstBeatOffset;
      const engine = MixiEngine.getInstance();
      engine.seek(incoming, seekTo);
    }

    // Transition when 32 beats remain.
    if (beatsToMixOut <= this.config.launchLeadBeats) {
      this.transition('PHRASE_SYNC_START');
    }
  }

  /**
   * PHRASE_SYNC_START: Launch incoming deck in silence.
   * Instant transition → RAMP_UP_VOLUME.
   */
  private tickPhraseSyncStart(beatsToMixOut: number, incoming: DeckId): void {
    const store = useMixiStore.getState();

    if (!store.decks[incoming].isPlaying) {
      // Ensure volume is zero before hitting play.
      store.setDeckVolume(incoming, 0);
      store.setDeckPlaying(incoming, true);
      log.info('AutoMixer', `Launched ${incoming} in silence (${beatsToMixOut.toFixed(0)} beats to mix-out)`);
    }

    this.transition('RAMP_UP_VOLUME');
  }

  /**
   * RAMP_UP_VOLUME: Linear fade-in of incoming deck over N beats.
   * The outgoing deck's bass is still dominant.
   */
  private tickRampUpVolume(outBeat: number, incoming: DeckId): void {
    const progress = lerpProgress(
      outBeat,
      this._intentStartBeat,
      this._intentStartBeat + this.config.fadeInBeats,
    );

    const store = useMixiStore.getState();
    store.setDeckVolume(incoming, progress);

    this.notifyProgress(progress);

    if (progress >= 1) {
      this.transition('BASS_SWAP');
    }
  }

  /**
   * BASS_SWAP: The iconic techno move.
   * Kill bass A, restore bass B — simultaneous, instant.
   */
  private tickBassSwap(outgoing: DeckId, incoming: DeckId): void {
    const store = useMixiStore.getState();

    // Kill outgoing bass.
    store.setDeckEq(outgoing, 'low', this.config.bassKillDb);
    // Restore incoming bass.
    store.setDeckEq(incoming, 'low', 0);

    log.success('AutoMixer', `BASS SWAP — ${incoming} takes the floor`);
    this.transition('FILTER_WASHOUT');
  }

  /**
   * FILTER_WASHOUT: Highpass sweep on outgoing deck over N beats.
   * Makes the old track "thin out" and disappear sonically.
   */
  private tickFilterWashout(outBeat: number, outgoing: DeckId): void {
    const progress = lerpProgress(
      outBeat,
      this._intentStartBeat,
      this._intentStartBeat + this.config.washoutBeats,
    );

    const fxValue = progress * this.config.washoutMaxFx;
    const store = useMixiStore.getState();
    store.setDeckColorFx(outgoing, fxValue);

    this.notifyProgress(progress);

    if (progress >= 1) {
      this.transition('FADE_OUT_EXIT');
    }
  }

  /**
   * FADE_OUT_EXIT: Volume fade-out on outgoing deck over N beats.
   */
  private tickFadeOutExit(outBeat: number, outgoing: DeckId): void {
    const progress = lerpProgress(
      outBeat,
      this._intentStartBeat,
      this._intentStartBeat + this.config.fadeOutBeats,
    );

    const store = useMixiStore.getState();
    store.setDeckVolume(outgoing, 1 - progress);

    this.notifyProgress(progress);

    if (progress >= 1) {
      this.transition('CLEANUP_AND_SWAP');
    }
  }

  /**
   * CLEANUP_AND_SWAP: Pause outgoing, reset EQ/FX, swap roles.
   * Then return to MONITORING.
   */
  private tickCleanupAndSwap(outgoing: DeckId): void {
    const store = useMixiStore.getState();

    // Stop the outgoing deck.
    store.setDeckPlaying(outgoing, false);

    // Reset EQ to flat.
    store.setDeckEq(outgoing, 'low', 0);
    store.setDeckEq(outgoing, 'mid', 0);
    store.setDeckEq(outgoing, 'high', 0);

    // Reset Color FX.
    store.setDeckColorFx(outgoing, 0);

    // Reset volume to 1 for next use.
    store.setDeckVolume(outgoing, 1);

    // Swap roles: old incoming is the new outgoing.
    this._roles = {
      outgoing: this._roles.incoming,
      incoming: this._roles.outgoing,
    };

    log.success(
      'AutoMixer',
      `Cleanup done — ${this._roles.outgoing} is now outgoing, waiting for next track on ${this._roles.incoming}`,
    );

    this.transition('MONITORING');
  }

  // ── Transition helper ──────────────────────────────────────

  private transition(newIntent: AutoMixIntent): void {
    const prev = this._intent;
    this._intent = newIntent;

    // Record the current beat position for progress-based intents.
    const engine = MixiEngine.getInstance();
    const store = useMixiStore.getState();
    const outDeck = store.decks[this._roles.outgoing];
    if (engine.isInitialized && outDeck.bpm > 0) {
      const t = engine.getCurrentTime(this._roles.outgoing);
      this._intentStartBeat = timeToBeat(t, outDeck.bpm, outDeck.firstBeatOffset);
    }

    if (prev !== newIntent) {
      log.info('AutoMixer', `${prev} → ${newIntent}`);
    }
    this.notify();
  }

  // ── Notification ───────────────────────────────────────────

  private notify(): void {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }

  private notifyProgress(progress: number): void {
    const s: AutoMixState = {
      ...this.state,
      progress,
    };
    for (const fn of this.listeners) fn(s);
  }
}
