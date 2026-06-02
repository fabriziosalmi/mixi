#!/usr/bin/env node
// Wasm build wrapper for both Rust wasm artifacts:
//
//   1. mixi-core → wasm-pack (wasm-bindgen) → mixi-core/pkg
//        BPM/key/waveform/etc. analysis, used on the main thread.
//   2. mixi-dsp  → cargo (wasm32-unknown-unknown) → public/mixi_dsp.wasm
//        A dedicated, ZERO-IMPORT DSP wasm the AudioWorklet instantiates with
//        an empty import object. We assert it has no imports so the worklet can
//        never silently fail to link (the bug that made the Rust DSP path time
//        out and fall back to WebAudio).
//
// SKIP_WASM_BUILD=1 skips the (slow) Rust compiles but still verifies/publishes
// the already-built lean wasm so a packaged build stays consistent.

import { execSync } from 'node:child_process';
import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LEAN_TARGET = 'mixi-dsp/target/wasm32-unknown-unknown/release/mixi_dsp.wasm';
const LEAN_PUBLIC = 'public/mixi_dsp.wasm';
const REQUIRED_EXPORTS = [
  'dsp_engine_new', 'dsp_engine_free', 'dsp_process', 'dsp_engine_reset',
  'dsp_in_l_ptr', 'dsp_in_r_ptr', 'dsp_out_l_ptr', 'dsp_out_r_ptr',
  'dsp_param_ptr', 'dsp_limiter_gr', 'memory',
];

if (process.env.SKIP_WASM_BUILD) {
  console.log('[build-wasm] SKIP_WASM_BUILD set — skipping Rust compiles');
} else {
  // 1. Analysis core (wasm-bindgen).
  execSync('npm run build:wasm', { stdio: 'inherit' });

  // 2. Lean DSP wasm (no wasm-bindgen → zero imports).
  console.log('[build-wasm] Building lean DSP wasm (mixi-dsp)…');
  execSync(
    "cd mixi-dsp && RUSTFLAGS='-C target-feature=+simd128' cargo build --release --target wasm32-unknown-unknown",
    { stdio: 'inherit' },
  );
}

// ── Verify + publish the lean DSP wasm ──────────────────────────────────────
if (!existsSync(LEAN_TARGET)) {
  if (existsSync(LEAN_PUBLIC)) {
    console.log(`[build-wasm] ${LEAN_TARGET} absent; keeping existing ${LEAN_PUBLIC}`);
  } else {
    console.warn(
      `[build-wasm] WARNING: ${LEAN_TARGET} not found and no ${LEAN_PUBLIC} — ` +
      'Wasm DSP will fall back to WebAudio at runtime.',
    );
  }
} else {
  const bytes = readFileSync(LEAN_TARGET);
  const mod = await WebAssembly.compile(bytes);

  // Zero-import guard: the AudioWorklet instantiates with {}, so ANY import is
  // unsatisfiable and would silently break the Rust DSP path. Fail the build.
  const imports = WebAssembly.Module.imports(mod);
  if (imports.length !== 0) {
    console.error('[build-wasm] FATAL: lean DSP wasm has imports the AudioWorklet cannot satisfy:');
    for (const i of imports) console.error(`    ${i.module}.${i.name} [${i.kind}]`);
    process.exit(1);
  }

  // Export guard: the worklet calls these by name.
  const have = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
  const missing = REQUIRED_EXPORTS.filter((n) => !have.has(n));
  if (missing.length) {
    console.error('[build-wasm] FATAL: lean DSP wasm missing exports:', missing.join(', '));
    process.exit(1);
  }

  mkdirSync(dirname(LEAN_PUBLIC), { recursive: true });
  copyFileSync(LEAN_TARGET, LEAN_PUBLIC);
  console.log(`[build-wasm] Lean DSP wasm OK — 0 imports, ${(bytes.length / 1024) | 0}KB → ${LEAN_PUBLIC}`);
}
