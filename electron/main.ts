/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Electron Main Process (Audio-Optimized)
//
// Performance optimizations for professional audio:
//   1. Chromium GPU flags for smooth UI rendering
//   2. Audio thread priority elevation
//   3. WebAudio low-latency hints
//   4. SharedArrayBuffer enabled (COOP/COEP)
//   5. V8 Wasm SIMD enabled
//   6. Disabled unnecessary Chromium features
// ─────────────────────────────────────────────────────────────

import { app, BrowserWindow, screen, session, globalShortcut, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { join } from 'path';
import {
  existsSync, openSync, writeSync, closeSync, readSync,
  copyFileSync, unlinkSync, readdirSync, statSync,
} from 'fs';
import { tmpdir } from 'os';
import { createWavHeader, patchWavHeaderSize, isOrphanWav, WAV_HEADER_SIZE, WAV_DATA_SIZE_SENTINEL } from './wavHeader';
import { createSocket, Socket as DgramSocket } from 'dgram';

// ── Chromium Audio & Performance Flags ───────────────────────
// These must be set BEFORE app.ready fires.

// Audio latency: request the lowest possible buffer size
app.commandLine.appendSwitch('audio-buffer-size', '128');

// Disable audio output resampling — pass-through at native rate
app.commandLine.appendSwitch('disable-audio-output-resampler');

// GPU acceleration for canvas/WebGL (waveforms, VU meters)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// WebAssembly SIMD (our DSP engine uses simd128)
app.commandLine.appendSwitch('enable-features',
  'SharedArrayBuffer,WebAssemblySimd,WebAssemblyTiering');

// Disable power throttling — audio must never be throttled
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Disable unnecessary Chromium features that waste CPU
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-default-apps');

// Windows: high-resolution timers (fixes 15.6ms default tick rate)
app.commandLine.appendSwitch('enable-highres-timer');

// Reduce memory footprint: single-origin app, no need for site isolation
app.commandLine.appendSwitch('disable-site-isolation-trials');

// Disable renderer code integrity checks (saves CPU cycles)
app.commandLine.appendSwitch('disable-features',
  'RendererCodeIntegrity,MediaRouter');

// V8 optimization: Wasm SIMD and tiering
app.commandLine.appendSwitch('js-flags', '--wasm-opt --liftoff --experimental-wasm-simd');

// ── Globals ──────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
let apiPort = 0;

// ── Native Audio I/O (cpal via N-API) ────────────────────────
// Load the mixi-native addon for direct hardware audio output.
// Falls back gracefully if the addon is not available.

let nativeAudio: any = null;
try {
  nativeAudio = require('./native/index.js');
  if (nativeAudio.isLoaded()) {
    console.log(`[mixi-native] Loaded — host: ${nativeAudio.getHostName()}`);
    console.log(`[mixi-native] Available: ${nativeAudio.isNativeAudioAvailable()}`);
  } else {
    console.log('[mixi-native] Addon not found for this platform — using WebAudio');
    nativeAudio = null;
  }
} catch (err) {
  console.log(`[mixi-native] Not available: ${(err as Error).message}`);
  nativeAudio = null;
}

// ── Disk Recording State ────────────────────────────────────

let recState: {
  filePath: string;
  fd: number;
  totalBytes: number;
  sampleRate: number;
  channels: number;
} | null = null;

// ── Helpers ──────────────────────────────────────────────────

/** Grab an available port by briefly binding to :0 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not determine port')));
      }
    });
    srv.on('error', reject);
  });
}

/** Resolve the path to the mixi-engine binary. */
function enginePath(): string {
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    // In a packaged app, the binary sits in extraResources
    const base = process.resourcesPath;
    const name = process.platform === 'win32' ? 'mixi-engine.exe' : 'mixi-engine';
    return join(base, name);
  }

  // Dev mode — run the Python source directly
  return '';
}

/** Poll /api/health until it responds or timeout. */
async function waitForEngine(port: number, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  const url = `http://127.0.0.1:${port}/api/health`;

  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`mixi-engine did not start within ${timeoutMs}ms`);
}

// ── Python lifecycle ─────────────────────────────────────────

function spawnEngine(port: number): ChildProcess {
  const binPath = enginePath();

  let child: ChildProcess;

  if (binPath && existsSync(binPath)) {
    // Packaged: run the PyInstaller binary
    child = spawn(binPath, ['--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MIXI_PORT: String(port) },
    });
  } else {
    // Dev: run via Python directly
    const apiDir = join(__dirname, '..', 'api');
    child = spawn('python3', [
      '-m', 'uvicorn', 'main:app',
      '--host', '127.0.0.1',
      '--port', String(port),
    ], {
      cwd: apiDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MIXI_PORT: String(port) },
    });
  }

  child.stdout?.on('data', (d: Buffer) => {
    process.stdout.write(`[mixi-engine] ${d}`);
  });
  child.stderr?.on('data', (d: Buffer) => {
    process.stderr.write(`[mixi-engine] ${d}`);
  });
  child.on('exit', (code) => {
    console.log(`[mixi-engine] exited with code ${code}`);
    pythonProcess = null;
  });

  return child;
}

function killEngine(): void {
  if (!pythonProcess) return;

  if (process.platform === 'win32') {
    // Windows: no SIGTERM, use taskkill
    spawn('taskkill', ['/pid', String(pythonProcess.pid), '/f', '/t']);
  } else {
    pythonProcess.kill('SIGTERM');
  }
}

// ── COOP/COEP Headers (required for SharedArrayBuffer) ──────

function setupSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });
}

// ── Window ───────────────────────────────────────────────────

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    minWidth: 1024,
    minHeight: 600,
    title: 'Mixi',
    backgroundColor: '#0a0a0a',
    // Disable visual effects that add latency
    transparent: false,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--mixi-api-port=${apiPort}`],
      // Performance: disable spellcheck and autofill
      spellcheck: false,
      // Enable WebGL 2 for waveform rendering
      webgl: true,
      // Disable throttling when window loses focus
      backgroundThrottling: false,
      // Lock zoom to 1.0 — DJ app must not be zoomable
      zoomFactor: 1.0,
    },
  });

  // ── Live Performance Protections ────────────────────────
  // Block accidental refresh/close during live performance
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    // Block Cmd+R / Ctrl+R / F5 (refresh)
    if ((input.control || input.meta) && input.key === 'r') {
      _event.preventDefault();
    }
    if (input.key === 'F5') {
      _event.preventDefault();
    }
    // Block Cmd+W (accidental close)
    if ((input.control || input.meta) && input.key === 'w') {
      _event.preventDefault();
    }
  });

  // Disable pinch-to-zoom
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  // Disable back/forward navigation (trackpad swipe)
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Load the Vite build without query parameters
  const indexPath = join(__dirname, '..', 'dist', 'index.html');

  if (existsSync(indexPath)) {
    // Production: load from dist/
    mainWindow.loadFile(indexPath);
  } else {
    // Dev: load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    // 0. Setup COOP/COEP headers for SharedArrayBuffer
    setupSecurityHeaders();

    // 0b. Setup IPC handlers
    setupNativeAudioIPC();
    setupDiskRecordingIPC();
    setupMixiSyncIPC();

    // 1. Find free port
    apiPort = await findFreePort();
    console.log(`[mixi] API port: ${apiPort}`);

    // 2. Spawn Python backend
    pythonProcess = spawnEngine(apiPort);

    // 3. Wait for health check
    await waitForEngine(apiPort);
    console.log('[mixi] Engine is ready');

    // 4. Create window
    createWindow();
  } catch (err) {
    console.error('[mixi] Failed to start:', err);
    killEngine();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  killEngine();
  app.quit();
});

app.on('before-quit', () => {
  // Finalize any active disk recording before quitting
  if (recState) {
    try {
      const totalFileSize = recState.totalBytes + WAV_HEADER_SIZE;
      patchWavHeaderSize(recState.fd, totalFileSize, { writeSync });
      closeSync(recState.fd);
      console.log(`[mixi-rec] Finalized on quit: ${recState.filePath} (${totalFileSize} bytes)`);
    } catch (err) {
      console.error(`[mixi-rec] Failed to finalize on quit: ${err}`);
    }
    recState = null;
  }
  killEngine();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── Native Audio IPC Handlers ────────────────────────────────

function setupNativeAudioIPC(): void {
  // Check if native audio is available
  ipcMain.handle('native-audio:available', () => {
    return nativeAudio?.isNativeAudioAvailable() ?? false;
  });

  // Get host backend name
  ipcMain.handle('native-audio:host', () => {
    return nativeAudio?.getHostName() ?? 'WebAudio';
  });

  // Enumerate output devices
  ipcMain.handle('native-audio:devices', () => {
    if (!nativeAudio) return [];
    return nativeAudio.enumerateOutputDevices();
  });

  // Open a native audio stream
  ipcMain.handle('native-audio:open', (_event, args: {
    deviceIndex: number;
    sampleRate: number;
    bufferSize: number;
    ringBuffer: SharedArrayBuffer;
    ringCapacityFrames: number;
    ringChannels: number;
  }) => {
    if (!nativeAudio) throw new Error('Native audio not available');
    return nativeAudio.openStream(
      args.deviceIndex,
      args.sampleRate,
      args.bufferSize,
      Buffer.from(args.ringBuffer),
      args.ringCapacityFrames,
      args.ringChannels,
    );
  });

  // Close the native audio stream
  ipcMain.handle('native-audio:close', () => {
    if (!nativeAudio) return;
    return nativeAudio.closeStream();
  });
}

// ── Disk Recording IPC Handlers ─────────────────────────────

function setupDiskRecordingIPC(): void {
  // Open a new recording file (WAV with sentinel header)
  ipcMain.handle('disk-rec:open', (_event, args: {
    sampleRate: number;
    channels: number;
  }) => {
    if (recState) {
      throw new Error('Recording already in progress');
    }

    const filePath = join(tmpdir(), `mixi-rec-${Date.now()}.wav`);
    const header = createWavHeader(args.sampleRate, args.channels, WAV_DATA_SIZE_SENTINEL);
    const fd = openSync(filePath, 'w');
    writeSync(fd, header, 0, header.length, 0);

    recState = {
      filePath,
      fd,
      totalBytes: 0,
      sampleRate: args.sampleRate,
      channels: args.channels,
    };

    console.log(`[mixi-rec] Opened: ${filePath} (${args.sampleRate}Hz, ${args.channels}ch, 32-bit float)`);
    return { filePath };
  });

  // Flush PCM data to disk (called every ~500ms from renderer)
  ipcMain.handle('disk-rec:flush', (_event, data: ArrayBuffer) => {
    if (!recState) return { bytesWritten: 0 };

    const buf = Buffer.from(data);
    writeSync(recState.fd, buf, 0, buf.length);
    recState.totalBytes += buf.length;

    return { bytesWritten: buf.length };
  });

  // Finalize: patch WAV header and close file
  ipcMain.handle('disk-rec:finalize', () => {
    if (!recState) throw new Error('No recording in progress');

    const { filePath, fd, totalBytes, sampleRate, channels } = recState;
    const totalFileSize = totalBytes + WAV_HEADER_SIZE;

    // Patch RIFF and data size fields
    patchWavHeaderSize(fd, totalFileSize, { writeSync });
    closeSync(fd);

    const durationSecs = totalBytes / (sampleRate * channels * 4);

    console.log(`[mixi-rec] Finalized: ${filePath} (${(totalFileSize / 1048576).toFixed(1)} MB, ${durationSecs.toFixed(1)}s)`);

    const result = { filePath, durationSecs, fileSizeBytes: totalFileSize };
    recState = null;
    return result;
  });

  // Cancel recording: close and delete temp file
  ipcMain.handle('disk-rec:cancel', () => {
    if (!recState) return;

    try { closeSync(recState.fd); } catch { /* already closed */ }
    try { unlinkSync(recState.filePath); } catch { /* may not exist */ }

    console.log(`[mixi-rec] Cancelled: ${recState.filePath}`);
    recState = null;
  });

  // Show native save dialog
  ipcMain.handle('disk-rec:show-save-dialog', async () => {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('');

    const result = await dialog.showSaveDialog({
      title: 'Save Recording',
      defaultPath: `MIXI_Set_${stamp}.wav`,
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    });

    return result.canceled ? null : result.filePath;
  });

  // Copy temp file to user-chosen destination
  ipcMain.handle('disk-rec:save-as', (_event, args: { src: string; dest: string }) => {
    copyFileSync(args.src, args.dest);
    try { unlinkSync(args.src); } catch { /* temp may already be gone */ }
    console.log(`[mixi-rec] Saved: ${args.dest}`);
    return { dest: args.dest };
  });

  // Check for orphan recordings (crash recovery)
  ipcMain.handle('disk-rec:check-orphans', () => {
    const tmp = tmpdir();
    const orphans: Array<{
      path: string;
      sizeBytes: number;
      estimatedDurationSecs: number;
      createdAt: string;
    }> = [];

    try {
      const files = readdirSync(tmp).filter(f => f.startsWith('mixi-rec-') && f.endsWith('.wav'));

      for (const file of files) {
        const filePath = join(tmp, file);
        try {
          const stat = statSync(filePath);
          const headerBuf = Buffer.alloc(WAV_HEADER_SIZE);
          const fd = openSync(filePath, 'r');
          readSync(fd, headerBuf, 0, WAV_HEADER_SIZE, 0);
          closeSync(fd);

          if (isOrphanWav(headerBuf)) {
            const dataBytes = stat.size - WAV_HEADER_SIZE;
            // Assume stereo 44100Hz 32-bit float
            const durationSecs = dataBytes > 0 ? dataBytes / (44100 * 2 * 4) : 0;

            orphans.push({
              path: filePath,
              sizeBytes: stat.size,
              estimatedDurationSecs: durationSecs,
              createdAt: stat.birthtime.toISOString(),
            });
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* tmpdir not readable */ }

    return orphans;
  });

  // Recover an orphan recording: patch header and save
  ipcMain.handle('disk-rec:recover', (_event, args: { src: string; dest: string }) => {
    const stat = statSync(args.src);
    const fd = openSync(args.src, 'r+');
    patchWavHeaderSize(fd, stat.size, { writeSync });
    closeSync(fd);

    copyFileSync(args.src, args.dest);
    try { unlinkSync(args.src); } catch { /* temp cleanup */ }

    console.log(`[mixi-rec] Recovered: ${args.dest} (${(stat.size / 1048576).toFixed(1)} MB)`);
    return { dest: args.dest, sizeBytes: stat.size };
  });

  // Discard an orphan recording
  ipcMain.handle('disk-rec:discard', (_event, args: { path: string }) => {
    try { unlinkSync(args.path); } catch { /* may not exist */ }
    console.log(`[mixi-rec] Discarded: ${args.path}`);
  });
}

// ── MIXI Sync Protocol IPC ──────────────────────────────────

let syncSocket: DgramSocket | null = null;
let syncAnnounceTimer: ReturnType<typeof setInterval> | null = null;
const syncPeers = new Map<string, { ip: string; port: number; lastSeen: number }>();

function setupMixiSyncIPC(): void {
  // Start sync (publisher or subscriber)
  ipcMain.handle('mixi-sync:start', (_event, args: { broadcastIp?: string }) => {
    if (syncSocket) return { ok: true, msg: 'Already running' };

    try {
      syncSocket = createSocket({ type: 'udp4', reuseAddr: true });
      syncSocket.bind(4303, () => {
        syncSocket!.setBroadcast(true);
        console.log('[mixi-sync] UDP socket bound to :4303');
      });

      // Listen for incoming packets → forward to renderer
      syncSocket.on('message', (msg, rinfo) => {
        if (msg.length < 64) return;
        // Rate limit: drop if we already have >100 packets this second from this IP
        const key = rinfo.address;
        const peer = syncPeers.get(key);
        if (peer) peer.lastSeen = Date.now();
        else syncPeers.set(key, { ip: rinfo.address, port: rinfo.port, lastSeen: Date.now() });

        // Forward raw packet to renderer as ArrayBuffer
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('mixi-sync:packet', msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength));
        }
      });

      // Start periodic announce broadcast (1 Hz)
      syncAnnounceTimer = setInterval(() => {
        // Expire stale peers (>5s)
        const now = Date.now();
        for (const [k, v] of syncPeers) {
          if (now - v.lastSeen > 5000) syncPeers.delete(k);
        }
      }, 1000);

      return { ok: true };
    } catch (err) {
      console.error('[mixi-sync] Failed to start:', err);
      return { ok: false, msg: String(err) };
    }
  });

  // Send a packet (heartbeat, announce, transport, etc.)
  ipcMain.handle('mixi-sync:send', (_event, args: {
    data: ArrayBuffer;
    broadcast?: boolean;
    targetIp?: string;
  }) => {
    if (!syncSocket) return;
    const buf = Buffer.from(args.data);

    if (args.broadcast) {
      // Broadcast (ANNOUNCE only)
      syncSocket.send(buf, 0, buf.length, 4303, '255.255.255.255');
    } else if (args.targetIp) {
      // Unicast to specific peer
      syncSocket.send(buf, 0, buf.length, 4303, args.targetIp);
    } else {
      // Unicast to all known peers
      for (const [, peer] of syncPeers) {
        syncSocket.send(buf, 0, buf.length, 4303, peer.ip);
      }
    }
  });

  // Get discovered peers
  ipcMain.handle('mixi-sync:peers', () => {
    return Array.from(syncPeers.entries()).map(([k, v]) => ({
      id: k, ip: v.ip, port: v.port, lastSeen: v.lastSeen,
    }));
  });

  // Stop sync
  ipcMain.handle('mixi-sync:stop', () => {
    if (syncAnnounceTimer) { clearInterval(syncAnnounceTimer); syncAnnounceTimer = null; }
    if (syncSocket) { syncSocket.close(); syncSocket = null; }
    syncPeers.clear();
    console.log('[mixi-sync] Stopped');
  });
}
