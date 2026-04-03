/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Frontend Logger
//
// Colour-coded console output using the browser's native
// %c format strings.  This makes Mixi logs instantly
// distinguishable from React/Vite noise in DevTools.
//
// Colour scheme matches the UI:
//   Engine logs  → Cyan    (#00f0ff)  – same as Deck A accent
//   Store  logs  → Purple  (#a855f7)  – same as Master accent
//   Success      → Green   (#4ade80)
//   Warnings     → Orange  (#ff6a00)  – same as Deck B accent
//   Errors       → Red     (#ef4444)
//
// Usage:
//   import { log } from '../utils/logger';
//   log.info('Engine', 'AudioContext created');
//   log.success('Loader', 'Track decoded in 230 ms');
//   log.warn('CORS', 'Falling back to proxy');
//   log.error('Engine', 'decodeAudioData failed', err);
// ─────────────────────────────────────────────────────────────

// ── Style constants ──────────────────────────────────────────

const BASE = 'font-weight:bold; padding:2px 6px; border-radius:3px;';

const STYLES = {
  info:    `${BASE} background:#003d42; color:#00f0ff;`,  // cyan / engine
  success: `${BASE} background:#14532d; color:#4ade80;`,  // green
  warn:    `${BASE} background:#441400; color:#ff6a00;`,  // orange
  error:   `${BASE} background:#450a0a; color:#ef4444;`,  // red
} as const;

const LABEL_STYLE = 'color:#a1a1aa; font-weight:normal;'; // zinc-400
const RESET = '';

type Level = keyof typeof STYLES;

// ── Core formatter ───────────────────────────────────────────

function emit(
  level: Level,
  tag: string,
  message: string,
  ...data: unknown[]
): void {
  const method =
    level === 'error' ? console.error :
    level === 'warn'  ? console.warn  :
    console.log;

  // Format:  [MIXI tag] message  ...extraData
  method(
    `%c MIXI %c ${tag} %c ${message}`,
    STYLES[level],
    LABEL_STYLE,
    RESET,
    ...data,
  );
}

// ── Public API ───────────────────────────────────────────────

export const log = {
  /**
   * General info – engine lifecycle, state changes.
   * Shows as cyan badge in the console.
   */
  info(tag: string, message: string, ...data: unknown[]): void {
    emit('info', tag, message, ...data);
  },

  /**
   * Operation completed successfully – track loaded, stream ready.
   * Shows as green badge.
   */
  success(tag: string, message: string, ...data: unknown[]): void {
    emit('success', tag, message, ...data);
  },

  /**
   * Non-fatal issue – fallback triggered, deprecated usage.
   * Shows as orange badge.
   */
  warn(tag: string, message: string, ...data: unknown[]): void {
    emit('warn', tag, message, ...data);
  },

  /**
   * Something broke – decode failure, network error, engine crash.
   * Shows as red badge with full stack trace.
   */
  error(tag: string, message: string, ...data: unknown[]): void {
    emit('error', tag, message, ...data);
  },
} as const;
