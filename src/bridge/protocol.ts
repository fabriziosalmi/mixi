/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – WebSocket Protocol Types
//
// Shared contract between the browser bridge and the Python
// MCP server.  All messages are JSON-encoded UTF-8 strings.
// ─────────────────────────────────────────────────────────────

// ── Messages: Server → Browser ───────────────────────────────

/**
 * A command from the AI agent to mutate the mixer state.
 * The `action` field maps directly to a Zustand store action.
 */
export interface MixiCommand {
  type: 'command';
  /** Unique ID for request/response correlation. */
  id: string;
  /** Zustand action name (e.g. "setCrossfader", "setDeckEq"). */
  action: string;
  /** Arguments array — spread into the store action call. */
  args: unknown[];
}

/** Request the current state snapshot. */
export interface MixiStateRequest {
  type: 'get_state';
  id: string;
}

export type ServerMessage = MixiCommand | MixiStateRequest;

// ── Messages: Browser → Server ───────────────────────────────

/** Response to a command — confirms execution or reports error. */
export interface MixiCommandResponse {
  type: 'response';
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * State snapshot pushed to the server.
 * Sent on subscription changes and on explicit get_state requests.
 *
 * NOTE: waveformData is stripped (too large for the wire).
 * The AI doesn't need raw waveform pixels — it uses bpm,
 * energy, duration, and playback position for decision-making.
 */
export interface MixiStateSnapshot {
  type: 'state';
  id?: string;
  data: SerializableMixerState;
}

export type BrowserMessage = MixiCommandResponse | MixiStateSnapshot;

// ── Serializable state (no waveform arrays) ──────────────────

export interface SerializableDeckState {
  isPlaying: boolean;
  isTrackLoaded: boolean;
  volume: number;
  gain: number;
  eq: { low: number; mid: number; high: number };
  colorFx: number;
  playbackRate: number;
  keyLock: boolean;
  duration: number;
  bpm: number;
  originalBpm: number;
  firstBeatOffset: number;
  isSynced: boolean;
  hotCues: (number | null)[];
  activeLoop: { start: number; end: number; lengthInBeats: number } | null;
  quantize: boolean;
  cueActive: boolean;
  trackName: string;
  musicalKey: string;
  /** Live playback position in seconds (computed at snapshot time). */
  currentTime: number;
}

export interface SerializableMixerState {
  master: { volume: number };
  crossfader: number;
  headphones: { level: number; mix: number; splitMode: boolean };
  decks: Record<'A' | 'B', SerializableDeckState>;
}
