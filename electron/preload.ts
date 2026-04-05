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

  // ── Disk Recording (Crash-Proof WAV) ─────────────────────
  diskRecording: {
    /** Open a new recording file in temp dir */
    open: (args: { sampleRate: number; channels: number }) =>
      ipcRenderer.invoke('disk-rec:open', args),
    /** Flush PCM data to disk */
    flush: (data: ArrayBuffer) =>
      ipcRenderer.invoke('disk-rec:flush', data),
    /** Finalize recording: patch WAV header, close file */
    finalize: () =>
      ipcRenderer.invoke('disk-rec:finalize'),
    /** Cancel recording: close and delete temp file */
    cancel: () =>
      ipcRenderer.invoke('disk-rec:cancel'),
    /** Show native OS save dialog */
    showSaveDialog: () =>
      ipcRenderer.invoke('disk-rec:show-save-dialog') as Promise<string | null>,
    /** Copy temp file to user-chosen destination */
    saveAs: (src: string, dest: string) =>
      ipcRenderer.invoke('disk-rec:save-as', { src, dest }),
    /** Check for orphan recordings from previous crashes */
    checkOrphans: () =>
      ipcRenderer.invoke('disk-rec:check-orphans') as Promise<Array<{
        path: string; sizeBytes: number; estimatedDurationSecs: number; createdAt: string;
      }>>,
    /** Recover an orphan: patch header, copy to destination */
    recover: (src: string, dest: string) =>
      ipcRenderer.invoke('disk-rec:recover', { src, dest }),
    /** Discard an orphan recording */
    discard: (path: string) =>
      ipcRenderer.invoke('disk-rec:discard', { path }),
  },

  // ── MIXI Sync Protocol ───────────────────────────────────
  mixiSync: {
    /** Start the UDP sync socket on port 4303 */
    start: () => ipcRenderer.invoke('mixi-sync:start', {}),
    /** Send a 64-byte sync packet */
    send: (data: ArrayBuffer, broadcast?: boolean, targetIp?: string) =>
      ipcRenderer.invoke('mixi-sync:send', { data, broadcast, targetIp }),
    /** Get discovered peers */
    peers: () => ipcRenderer.invoke('mixi-sync:peers') as Promise<Array<{
      id: string; ip: string; port: number; lastSeen: number;
    }>>,
    /** Stop sync */
    stop: () => ipcRenderer.invoke('mixi-sync:stop'),
    /** Listen for incoming packets (forwarded from main process) */
    onPacket: (cb: (data: ArrayBuffer) => void) => {
      ipcRenderer.on('mixi-sync:packet', (_event, data: ArrayBuffer) => cb(data));
    },
  },
});
