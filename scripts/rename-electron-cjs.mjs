#!/usr/bin/env node
// Rename Electron's compiled .js outputs to .cjs so the main process loads
// them as CommonJS (the rest of the project is "type": "module").
// Idempotent: missing files are ignored.

import { renameSync, existsSync } from 'node:fs';

const renames = [
  ['electron/dist/main.js', 'electron/dist/main.cjs'],
  ['electron/dist/preload.js', 'electron/dist/preload.cjs'],
];

for (const [from, to] of renames) {
  if (existsSync(from)) {
    renameSync(from, to);
  } else if (!existsSync(to)) {
    console.error(`[rename-electron-cjs] missing input: ${from}`);
    process.exit(1);
  }
}
