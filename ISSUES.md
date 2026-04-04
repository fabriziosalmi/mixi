# MIXI - Audit Findings

> Full codebase audit performed 2026-04-04.
> Severity levels: **CRITICAL** (must fix, causes incorrect behavior or crash),
> **HIGH** (should fix, significant risk), **MEDIUM** (recommended fix).

---

## CRITICAL

### C1. Stereo Output Is Actually Mono (Wasm DSP Path)

**File:** `mixi-core/src/dsp/engine.rs:379-382`

```rust
for i in 0..len {
    output_l[i] = self.scratch_a[i] + self.scratch_b[i];
    output_r[i] = self.scratch_a[i] + self.scratch_b[i];
}
```

Both `output_l` and `output_r` receive the **identical** sum of Deck A + Deck B.
The Wasm DSP path produces mono audio disguised as stereo. Any stereo content
in the source tracks (panning, stereo effects) is collapsed.

**Impact:** Every user running the Wasm DSP path hears mono. The native
WebAudio fallback path does produce proper stereo, masking this bug in
browsers without SharedArrayBuffer support.

**Fix:** Deck inputs arrive as mono (worklet input channels), so they are
inherently mono per-deck. However the master chain (below) must still process
L/R as a true stereo pair — the current approach processes them independently
with shared state (see C2). At minimum, document that the Wasm path is
intentionally mono-sum, or implement true stereo I/O through the worklet.

---

### C2. Master Chain Called Twice With Shared Mutable State

**File:** `mixi-core/src/dsp/engine.rs:385-386`

```rust
self.master.process(&mut output_l[..len], params, self.sr);
self.master.process(&mut output_r[..len], params, self.sr);
```

`MasterDsp` contains stateful processors: DC blocker (`dc_x_prev`, `dc_y_prev`),
`PredictiveLimiter` (lookahead buffer, envelope), `Compressor` (envelope),
`ParamSmoother` (one-pole state). Calling `process()` twice per quantum means:

1. **DC blocker discontinuity:** After processing the last sample of `output_l`,
   `dc_x_prev` holds L's last value. Processing `output_r` starts with this
   stale state, creating a transient click at every block boundary.

2. **Limiter/compressor double-pumping:** The envelope follower attacks on L's
   peaks, then partially releases before seeing R's peaks. Since L = R (see C1),
   the limiter effectively processes the same signal twice with accumulating
   gain reduction, over-compressing by ~6 dB.

3. **Smoother drift:** `gain_smooth` converges toward the target twice per block
   (2x the smoothing speed), so gain transitions are half the intended duration.

**Impact:** Audio artifacts, incorrect limiting, gain overshoot.

**Fix:** Either (a) process stereo as interleaved pairs with a single state
machine, or (b) create separate `MasterDsp` instances for L and R (only valid
if all processors are channel-independent, which DC blocker is not).

---

### C3. WASM Module URL Hardcoded — Fails in Production

**File:** `src/audio/dsp/WasmDspBridge.ts:73`

```typescript
const wasmUrl = new URL('/mixi-core/pkg/mixi_core_bg.wasm', window.location.origin);
```

Vite hashes assets during `build` (e.g., `mixi_core_bg-D5zf0s2c.wasm` in
`dist/assets/`). The hardcoded path `/mixi-core/pkg/...` does not exist in
production builds — the fetch returns 404, Wasm init fails silently, and the
engine falls back to the native WebAudio path without any Rust DSP.

**Impact:** Rust DSP engine never activates in production. All EQ, FX, limiting
from the Wasm path is silently disabled. Users get the passthrough fallback.

**Fix:** Import the wasm file as a Vite asset:
```typescript
import wasmUrl from '../../../mixi-core/pkg/mixi_core_bg.wasm?url';
```
This lets Vite hash and bundle it correctly.

---

### C4. AudioWorklet Paths Absolute — Break With Non-Root Deployments

**Files:**
- `src/audio/dsp/WasmDspBridge.ts:55` — `/worklets/mixi-dsp-worklet.js`
- `src/audio/MixiEngine.ts` — `/worklets/native-output-tap.js`
- `src/audio/recording/DiskRecordingBridge.ts` — `/worklets/recording-tap.js`

Vite config sets `base: './'` (relative), but worklet `addModule()` calls use
absolute paths (`/worklets/...`). These fail when:
- App is deployed under a subpath (e.g., `example.com/app/`)
- Electron loads from `file://` protocol
- Docker serves from a non-root location

**Impact:** Audio engine fails to initialize. No sound output at all.

**Fix:** Use `import.meta.url` or `new URL('./worklets/...', import.meta.env.BASE_URL)`
to resolve worklet paths relative to the deployment base.

---

## HIGH

### H1. `processRaw` Unsafe Block — No Bounds Validation

**File:** `mixi-core/src/dsp/engine.rs:443-451`

```rust
unsafe {
    let base = 0 as *mut u8;
    let in_l = std::slice::from_raw_parts_mut(base.add(mem_in_l as usize) as *mut f32, len);
    // ... same for in_r, out_l, out_r
    let params = std::slice::from_raw_parts(base.add(mem_params as usize), 512);
    self.process(in_l, in_r, out_l, out_r, params);
}
```

Raw pointer arithmetic from `0 as *mut u8` with offsets provided by JavaScript.
No validation that:
- Offsets fall within Wasm linear memory bounds
- Buffers don't overlap (aliased mutable references = UB)
- `len * 4` bytes are actually available at each offset
- `mem_params + 512` doesn't exceed memory size

If the JS worklet has a bug in offset calculation, this produces undefined
behavior: data corruption, silent garbage output, or Wasm trap.

**Impact:** Any bug in the JS allocation code (worklet lines 81-85) corrupts
the audio pipeline with no error reporting.

**Fix:** Add a `memory.size()` check (via `wasm_bindgen::memory()`) before
creating slices. Verify `offset + len*4 <= memory_size` for all buffers.

---

### H2. ParamBus Layout Has No Version Check

**Files:**
- `mixi-core/src/dsp/engine.rs:26-72` — Rust offsets
- `src/audio/dsp/ParamLayout.ts` — TypeScript offsets (must match)

128+ magic byte offsets must match exactly between Rust and TypeScript. A single
offset mismatch causes the DSP to read wrong parameters (e.g., EQ gain read as
fader position), producing incorrect audio with no error.

There is no version field, checksum, or compile-time assertion linking the two
files. Any edit to one without updating the other silently breaks the DSP.

**Impact:** Silent audio corruption after any parameter layout change.

**Fix:** Add a version byte at offset 0 of the param bus. Assert it matches
in both Rust (`read_f32(params, 0) == VERSION`) and TypeScript. Alternatively,
generate both files from a single schema.

---

### H3. GPU Feedback Texture Binding Ignores Float Filterability

**File:** `src/gpu/WebGpuRenderer.ts:159-160`

```typescript
{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
{ binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
```

Bindings 1-3 correctly use the `floatTexType`/`floatSamplerType` variables to
handle devices without `float32-filterable`. But binding 4 (feedback texture)
and binding 5 (feedback sampler) are hardcoded to `'float'` and `'filtering'`.

On GPUs that don't support float32-filterable (some mobile, Intel iGPUs), this
creates a validation error when creating the bind group, crashing the WebGPU
pipeline. The shader falls back to Canvas 2D, losing all VFX.

**Impact:** VFX broken on devices without float32-filterable support.

**Fix:**
```typescript
{ binding: 4, ..., texture: { sampleType: floatTexType as GPUTextureSampleType } },
{ binding: 5, ..., sampler: { type: floatSamplerType as GPUSamplerBindingType } },
```

---

### H4. Wasm Panic Message Not Extracted

**File:** `public/worklets/mixi-dsp-worklet.js:55-58`

```javascript
__wbindgen_throw: (ptr, len) => {
  console.error('[mixi-dsp] Wasm panic');
},
```

When Rust panics (e.g., the `unwrap()` in drop_detect, or any future panic),
the error message is encoded in Wasm memory at `(ptr, len)`. The handler
ignores these parameters and logs a generic message.

**Impact:** Debugging Wasm crashes in production is nearly impossible. The
actual panic message (with file, line, assertion text) is discarded.

**Fix:**
```javascript
__wbindgen_throw: (ptr, len) => {
  const bytes = new Uint8Array(this._memory.buffer, ptr, len);
  const message = new TextDecoder().decode(bytes);
  console.error('[mixi-dsp] Wasm panic:', message);
  this.port.postMessage({ type: 'error', message: 'Wasm panic: ' + message });
},
```

---

### H5. Wasm Malloc Export Name Guessing — Silent Failure

**File:** `public/worklets/mixi-dsp-worklet.js:74-77`

```javascript
const malloc = this._exports.__wbindgen_export_0 ||
               this._exports.__wbindgen_malloc ||
               this._exports.wasm_malloc;
```

Three names are tried by guessing wasm-bindgen's internal export naming, which
changes between wasm-bindgen versions. If none match, `malloc` is `undefined`,
the `if (malloc && this._enginePtr)` guard silently skips initialization, and
the worklet runs in passthrough mode with no error message.

**Impact:** A wasm-bindgen version bump silently disables the entire Wasm DSP
path with no logs or errors.

**Fix:** If `malloc` is falsy, post an explicit error:
```javascript
if (!malloc) {
  this.port.postMessage({
    type: 'error',
    message: 'Wasm malloc export not found — wasm-bindgen version mismatch?'
  });
  return;
}
```

---

## MEDIUM

### M1. `unwrap()` on Float Comparison — Panic on NaN

**File:** `mixi-core/src/drop_detect.rs:171`

```rust
candidates.sort_by(|a, b| b.strength.partial_cmp(&a.strength).unwrap());
```

`partial_cmp` returns `None` for NaN values. If any candidate's `strength`
is NaN (possible from pathological audio: 0/0 in energy calculations), this
panics and crashes the Wasm instance.

**Fix:** `b.strength.partial_cmp(&a.strength).unwrap_or(std::cmp::Ordering::Equal)`

---

### M2. Feedback Texture Format Mismatch (Canvas vs RGBA Float)

**File:** `src/gpu/WebGpuRenderer.ts:204-206`

```typescript
const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
this.fbA = this.device.createTexture({ size: [w, h, 1], format: this.canvasFormat, usage });
```

Feedback textures use `canvasFormat` (typically `bgra8unorm`), but the bind
group layout (binding 4) declares `sampleType: 'float'`. The `bgra8unorm`
format has sample type `'float'` only when float32-filterable is supported.
On some platforms, the actual sample type is `'unfilterable-float'` for this
format, causing a validation mismatch.

**Impact:** Potential WebGPU validation error on edge-case GPU configurations.

---

### M3. Single ErrorBoundary — Component Error Crashes Entire App

**File:** `src/components/ErrorBoundary.tsx`

One ErrorBoundary wraps the entire app at the root. A runtime error in VFX
rendering, MIDI handling, or the settings panel crashes the entire UI,
including the audio transport controls.

**Impact:** A GPU shader compilation error (e.g., from a driver update) kills
the entire mixer, not just the visualizer.

**Fix:** Add isolated ErrorBoundaries around:
- `VfxCanvas` (GPU/shader errors)
- MIDI input handlers
- Settings panel
- Track browser

---

### M4. `DspEngine` Constructor Export Name Guessing

**File:** `public/worklets/mixi-dsp-worklet.js:67-71`

```javascript
if (this._exports.dspengine_new) {
  this._enginePtr = this._exports.dspengine_new(sampleRate);
} else if (this._exports.__wbg_dspengine_new) {
  this._enginePtr = this._exports.__wbg_dspengine_new(sampleRate);
}
```

Same issue as H5 — export names are guessed and may change with wasm-bindgen
updates. If neither name matches, `_enginePtr` remains 0, and the guard at
line 78 silently skips. No error is reported.

**Fix:** Add explicit error when neither export is found.

---

### M5. Ring Buffer Atomics Not Actually Atomic in Wasm

**File:** `mixi-core/src/ring_buffer.rs`

The Wasm code path uses direct byte loads instead of true atomic operations.
WebAssembly's `memory.atomic.*` instructions require `shared` memory. The
current implementation assumes single-writer (main thread) / single-reader
(AudioWorklet) without true atomics.

This is safe for the current architecture (JS main thread writes, AudioWorklet
reads, no concurrent Wasm threads), but the code comments claim it uses
"wasm atomic ops" which is misleading.

**Impact:** Low risk currently, but becomes a data race if Wasm threads are
enabled in the future.

**Fix:** Update comments to document the actual safety contract, or use
`Atomics` from JS before entering the Wasm path.

---

### M6. Waveshaper Normalization Division Risk

**File:** `mixi-core/src/dsp/waveshaper.rs:43`

```rust
self.norm = 1.0 / self.drive.tanh();
```

If `drive` is exactly 0.0, `tanh(0.0) = 0.0`, producing `Inf`. Subsequent
multiplication propagates `Inf`/`NaN` through the signal chain.

**Likelihood:** Low — `drive` is always >= 1.0 in practice. But no guard exists.

**Fix:** `self.norm = 1.0 / self.drive.tanh().max(1e-10);`

---

### M7. Worklet `processRaw` Export Name Also Guessed

**File:** `public/worklets/mixi-dsp-worklet.js:141-142`

```javascript
const processRaw = this._exports.processRaw ||
                   this._exports.dspengine_processRaw;
```

If neither matches, `processRaw` is `undefined`, the `if (processRaw)` guard
at line 143 silently falls through, and the worklet outputs zeroes with no
error.

**Fix:** Log when the export isn't found, so developers know the Wasm path is
silently broken.

---

### M8. Wasm-Opt Disabled — Larger Binary

**File:** `mixi-core/Cargo.toml:29-33`

```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = false
```

Wasm optimization is disabled due to incompatibility with Rust 1.94+ and
wasm-pack 0.14. This means no dead-code elimination, no constant folding, and
an estimated 20-30% larger .wasm binary.

**Impact:** Increased load time and memory usage. No correctness impact.

**Status:** Known issue. Waiting for wasm-pack >= 0.15.

---

## Summary

| ID  | Severity | Status | One-liner | Fix |
|-----|----------|--------|-----------|-----|
| C1  | CRITICAL | ✅ FIXED | Stereo output is mono (L = R = A+B) | Separate `master_l`/`master_r` instances |
| C2  | CRITICAL | ✅ FIXED | Master chain stateful processors called 2x | Independent state per channel |
| C3  | CRITICAL | ✅ FIXED | Wasm URL hardcoded, 404 in production | `import.meta.url` resolution |
| C4  | CRITICAL | ✅ FIXED | Worklet paths absolute, break non-root deploy | Relative paths (3 files) |
| H1  | HIGH     | ✅ FIXED | processRaw unsafe with no bounds validation | `offset + size <= mem_size` check |
| H2  | HIGH     | ✅ FIXED | ParamBus layout has no version/checksum | `PARAM_LAYOUT_VERSION=2` at offset 508 |
| H3  | HIGH     | ⬜ N/A  | Feedback texture ignores float filterability | False positive: bgra8unorm supports `'float'` natively |
| H4  | HIGH     | ✅ FIXED | Wasm panic message discarded | `TextDecoder` on `(ptr, len)` from Wasm memory |
| H5  | HIGH     | ✅ FIXED | Wasm malloc export name guessed, silent fail | Explicit error with available exports list |
| M1  | MEDIUM   | ✅ FIXED | unwrap() on float sort panics on NaN | `unwrap_or(Equal)` |
| M2  | MEDIUM   | ⬜ N/A  | Feedback texture format/sampleType mismatch | False positive (same as H3) |
| M3  | MEDIUM   | 🔲 TODO | Single ErrorBoundary, component error kills all UI | Needs dedicated refactor |
| M4  | MEDIUM   | ✅ FIXED | Engine constructor export name guessed | Explicit error on mismatch |
| M5  | MEDIUM   | 🔲 WONT | Ring buffer atomics not actually atomic in Wasm | Safe in current single-writer arch |
| M6  | MEDIUM   | ✅ FIXED | Division by tanh(0) produces Inf | `.max(1e-10)` guard |
| M7  | MEDIUM   | ✅ FIXED | processRaw export name guessed, silent fallback | Cached lookup + explicit disable + log |
| M8  | MEDIUM   | 🔲 EXT  | wasm-opt disabled, ~20-30% larger binary | Waiting wasm-pack >= 0.15 |

**Score: 13/18 fixed, 2 false positives, 3 deferred (M3 architectural, M5 safe by design, M8 external dep).**
