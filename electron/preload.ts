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

import { contextBridge, ipcRenderer } from 'electron';

// Leggi la porta API dall'argomento passato nel main process 
// tramite `additionalArguments: ['--mixi-api-port=...']`.
const portArg = process.argv.find((arg) => arg.startsWith('--mixi-api-port='));
const apiPort = portArg ? portArg.split('=')[1] : '8000';

contextBridge.exposeInMainWorld('mixi', {
  apiPort: Number(apiPort),
  apiBase: `http://127.0.0.1:${apiPort}`,
  wsBase: `ws://127.0.0.1:${apiPort}`,

  // ── Native Audio I/O (cpal) ──────────────────────────────
  nativeAudio: {
    /** Check if native audio addon is available */
    isAvailable: () => ipcRenderer.invoke('native-audio:available'),
    /** Get audio host backend name (CoreAudio, WASAPI, ALSA) */
    getHostName: () => ipcRenderer.invoke('native-audio:host'),
    /** Enumerate output devices */
    getDevices: () => ipcRenderer.invoke('native-audio:devices'),
    /** Open a native audio stream */
    openStream: (args: {
      deviceIndex: number;
      sampleRate: number;
      bufferSize: number;
      ringBuffer: SharedArrayBuffer;
      ringCapacityFrames: number;
      ringChannels: number;
    }) => ipcRenderer.invoke('native-audio:open', args),
    /** Close the active native audio stream */
    closeStream: () => ipcRenderer.invoke('native-audio:close'),
  },
});
