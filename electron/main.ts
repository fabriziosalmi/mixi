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

import { app, BrowserWindow, screen, session, globalShortcut, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { join } from 'path';
import { existsSync } from 'fs';

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

    // 0b. Setup native audio IPC handlers
    setupNativeAudioIPC();

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
