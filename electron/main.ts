/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Electron Main Process
//
// 1. Find a free port
// 2. Spawn the mixi-engine (Python backend) on that port
// 3. Wait for /api/health to respond
// 4. Create the BrowserWindow loading the Vite build
// 5. On quit → graceful shutdown of the Python child
// ─────────────────────────────────────────────────────────────

import { app, BrowserWindow, screen } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { join } from 'path';
import { existsSync } from 'fs';

// ── Globals ──────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
let apiPort = 0;

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
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the Vite build with the API port injected
  const indexPath = join(__dirname, '..', 'dist', 'index.html');

  if (existsSync(indexPath)) {
    // Production: load from dist/
    mainWindow.loadFile(indexPath, {
      query: { apiPort: String(apiPort) },
    });
  } else {
    // Dev: load from Vite dev server
    mainWindow.loadURL(`http://localhost:5173?apiPort=${apiPort}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
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
