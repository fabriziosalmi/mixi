/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – WebSocket Bridge (Browser Side)
//
// Connects to the Python backend's /ws/mixer endpoint and
// translates incoming JSON commands into Zustand store actions.
//
// This is the "nervous system" that lets an external AI agent
// control every knob, fader, and button on the mixer in
// real-time — the store changes, useMixiSync forwards to the
// engine, and the UI updates reactively.
//
// The bridge also pushes state snapshots back to the server
// whenever the mixer state changes, so the AI has continuous
// situational awareness.
//
// Reconnection: If the WebSocket drops, the bridge retries
// with exponential backoff (1s → 2s → 4s → max 10s).
// ─────────────────────────────────────────────────────────────

import { useMixiStore } from '../store/mixiStore';
import { MixiEngine } from '../audio/MixiEngine';
import { log } from '../utils/logger';
import type {
  ServerMessage,
  MixiCommandResponse,
  MixiStateSnapshot,
  SerializableMixerState,
  SerializableDeckState,
} from './protocol';
import type { DeckId } from '../types';
import { WS_BASE } from '../utils/apiBase';

// ── Config ───────────────────────────────────────────────────

const WS_URL = `${WS_BASE}/ws/mixer`;
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 10_000;
/** Throttle interval for state pushes (ms). */
const PUSH_THROTTLE_MS = 50;

// ── Actions whitelist ────────────────────────────────────────
//
// Only these store actions can be called remotely.
// This prevents the AI from calling internal-only mutations
// like setDeckWaveform or setDeckBpm.

const ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  // Master
  'setMasterVolume',
  'setCrossfader',
  // Deck transport
  'setDeckPlaying',
  'setDeckVolume',
  'setDeckGain',
  'setDeckEq',
  'setDeckColorFx',
  'setDeckPlaybackRate',
  'setKeyLock',
  // BPM / Sync
  'syncDeck',
  'unsyncDeck',
  // Hot Cues
  'setHotCue',
  'triggerHotCue',
  'deleteHotCue',
  // Loops
  'setAutoLoop',
  'exitLoop',
  // PFL
  'toggleCue',
  // Headphones
  'setHeadphoneLevel',
  'setHeadphoneMix',
  'toggleSplitMode',
  // Quantize
  'setQuantize',
]);

// ── Bridge Class ─────────────────────────────────────────────

export class MixiBridge {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_BASE;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;
  private pushPending = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  /** True when the WebSocket is open and ready. */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  connect(): void {
    if (this.destroyed) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;

    if (this.reconnectAttempts === 0) {
      log.info('Bridge', `Connecting to ${WS_URL}…`);
    }
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      log.success('Bridge', 'Connected to MCP backend');
      this.reconnectDelay = RECONNECT_BASE;
      this.reconnectAttempts = 0;

      // Send initial state snapshot.
      this.pushState();

      // Clean up any previous subscription before creating a new one.
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }

      // Subscribe to all store changes → throttled push.
      this.unsubscribe = useMixiStore.subscribe(() => {
        this.throttledPushState();
      });
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string);
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts === 0) {
        log.warn('Bridge', 'Backend not available — will retry silently');
      }
      this.cleanup();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there.
    };
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    log.info('Bridge', 'Disconnected');
  }

  // ── Incoming message handler ───────────────────────────────

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      log.error('Bridge', `Invalid JSON: ${raw.slice(0, 100)}`);
      return;
    }

    if (msg.type === 'command') {
      this.executeCommand(msg.id, msg.action, msg.args);
    } else if (msg.type === 'get_state') {
      this.pushState(msg.id);
    }
  }

  // ── Command execution ──────────────────────────────────────

  private executeCommand(id: string, action: string, args: unknown[]): void {
    // Security: only allow whitelisted actions.
    if (!ALLOWED_ACTIONS.has(action)) {
      this.sendResponse(id, false, `Action "${action}" is not allowed`);
      return;
    }

    const store = useMixiStore.getState();
    const fn = (store as unknown as Record<string, unknown>)[action];

    if (typeof fn !== 'function') {
      this.sendResponse(id, false, `Action "${action}" not found on store`);
      return;
    }

    try {
      (fn as (...a: unknown[]) => void)(...args);
      log.info('Bridge', `Executed: ${action}(${args.map(String).join(', ')})`);
      this.sendResponse(id, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Bridge', `Action failed: ${action} — ${msg}`);
      this.sendResponse(id, false, msg);
    }
  }

  // ── Outgoing messages ──────────────────────────────────────

  private sendResponse(id: string, ok: boolean, error?: string): void {
    const resp: MixiCommandResponse = { type: 'response', id, ok };
    if (error) resp.error = error;
    this.send(resp);
  }

  /** Serialize and push the full mixer state (minus waveform data). */
  private pushState(requestId?: string): void {
    const state = useMixiStore.getState();
    const engine = MixiEngine.getInstance();

    const serializeDeck = (id: DeckId): SerializableDeckState => {
      const d = state.decks[id];
      return {
        isPlaying: d.isPlaying,
        isTrackLoaded: d.isTrackLoaded,
        volume: d.volume,
        gain: d.gain,
        eq: { ...d.eq },
        colorFx: d.colorFx,
        playbackRate: d.playbackRate,
        keyLock: d.keyLock,
        duration: d.duration,
        bpm: d.bpm,
        originalBpm: d.originalBpm,
        firstBeatOffset: d.firstBeatOffset,
        isSynced: d.isSynced,
        hotCues: [...d.hotCues],
        activeLoop: d.activeLoop ? { ...d.activeLoop } : null,
        quantize: d.quantize,
        cueActive: d.cueActive,
        trackName: d.trackName,
        musicalKey: d.musicalKey,
        currentTime: engine.isInitialized
          ? engine.getCurrentTime(id)
          : 0,
      };
    };

    const data: SerializableMixerState = {
      master: { volume: state.master.volume },
      crossfader: state.crossfader,
      headphones: { ...state.headphones },
      decks: {
        A: serializeDeck('A'),
        B: serializeDeck('B'),
      },
    };

    const snapshot: MixiStateSnapshot = { type: 'state', data };
    if (requestId) snapshot.id = requestId;
    this.send(snapshot);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Throttled state push — collapses rapid mutations into
   * a single WS send every PUSH_THROTTLE_MS.
   */
  private throttledPushState(): void {
    if (this.pushPending) return;
    this.pushPending = true;
    this.pushTimer = setTimeout(() => {
      this.pushPending = false;
      this.pushTimer = null;
      this.pushState();
    }, PUSH_THROTTLE_MS);
  }

  // ── Reconnection ───────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX);
  }

  private cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      this.pushPending = false;
    }
  }
}
