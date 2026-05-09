#!/usr/bin/env node
// Conditional Wasm build wrapper.
// Skipped when SKIP_WASM_BUILD=1 (used in CI jobs that don't need DSP rebuilt).

import { execSync } from 'node:child_process';

if (process.env.SKIP_WASM_BUILD) {
  console.log('[build-wasm] SKIP_WASM_BUILD set — skipping');
  process.exit(0);
}

execSync('npm run build:wasm', { stdio: 'inherit' });
