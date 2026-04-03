/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – API Base URL resolver
//
// In Electron, the preload script exposes window.mixi with
// the dynamic port. In the browser (dev), we fall back to
// the Vite env var or localhost:8000.
// ─────────────────────────────────────────────────────────────

interface MixiGlobal {
  apiPort: number;
  apiBase: string;
  wsBase: string;
}

declare global {
  interface Window {
    mixi?: MixiGlobal;
  }
}

/** HTTP base URL for REST calls (no trailing slash) */
export const API_BASE: string =
  window.mixi?.apiBase
  ?? import.meta.env.VITE_API_BASE
  ?? 'http://localhost:8000';

/** WebSocket base URL (no trailing slash) */
export const WS_BASE: string =
  window.mixi?.wsBase
  ?? import.meta.env.VITE_WS_BASE
  ?? 'ws://localhost:8000';
