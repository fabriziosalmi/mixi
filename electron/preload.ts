/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Electron Preload Script
//
// Exposes the API port to the renderer via contextBridge.
// The port is passed as a query-param from the main process.
// ─────────────────────────────────────────────────────────────

import { contextBridge } from 'electron';

// Read the apiPort from the URL query string
const params = new URLSearchParams(window.location.search);
const apiPort = params.get('apiPort') || '8000';

contextBridge.exposeInMainWorld('mixi', {
  apiPort: Number(apiPort),
  apiBase: `http://127.0.0.1:${apiPort}`,
  wsBase: `ws://127.0.0.1:${apiPort}`,
});
