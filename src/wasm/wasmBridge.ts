/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Wasm Core Bridge
//
// Lazy-loads and initializes the Rust/Wasm module (mixi-core).
// All Wasm functions are accessed through this singleton.
//
// Usage:
//   import { wasmCore } from '../wasm/wasmBridge';
//   const core = await wasmCore();
//   console.log(core.version());       // "0.1.0"
//   console.log(core.add(2, 3));       // 5
//   console.log(core.rms(samples));    // 0.707...
// ─────────────────────────────────────────────────────────────

import { log } from '../utils/logger';

// The wasm-pack output exposes an `init()` default export
// and named exports for each #[wasm_bindgen] function.
import init, * as wasm from '../../mixi-core/pkg/mixi_core';

let initialized = false;

/**
 * Initialize the Wasm module (idempotent).
 * Returns the module's exported functions.
 */
export async function wasmCore(): Promise<typeof wasm> {
  if (!initialized) {
    await init();
    initialized = true;
    log.info('WasmBridge', `mixi-core v${wasm.version()} loaded (Rust/Wasm)`);
  }
  return wasm;
}

/** Check if Wasm has been initialized. */
export function isWasmReady(): boolean {
  return initialized;
}
