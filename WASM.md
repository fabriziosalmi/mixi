# 🦀 Mixi WASM & Rust Architecture (SOTA Roadmap)

## The Core Principle

Wrapping native WebAudio API nodes (`GainNode`, `BiquadFilter`) by calling them from Rust via Wasm is an **architectural anti-pattern**. Crossing the FFI (Foreign Function Interface) bridge between Wasm and JS to move a fader costs *more* CPU than doing it in pure JS.

The SOTA (State of the Art) roadmap for migrating Mixi to near-zero-latency DSP follows a **gradual transition** designed to never break the playable codebase (zero downtime) while validating each architectural layer independently.

> **Target latency:** The WebAudio API enforces a minimum buffer of 128 samples (≈2.9ms @ 44.1kHz). True 0.0ms is physically impossible in a browser. The goal is to reach **one-buffer latency** (128 samples) with deterministic, jitter-free rendering — matching hardware CDJ performance.

---

## 📊 Current Mixi Architecture (v0.1.1 Baseline)

Understanding what we have today is critical for planning the migration. These are the exact files that will be touched or replaced:

| Module | File | Lines | Current Tech | Migration Target |
|--------|------|-------|-------------|-----------------|
| BPM Detection | `BpmDetector.ts` | 449 | JS FFT + onset detection | Rust `rustfft` (Step 4) |
| Key Detection | `KeyDetector.ts` | 311 | JS chromagram | Rust `aubio-rs` (Step 4) |
| Waveform Analysis | `WaveformAnalyzer.ts` | 252 | JS RMS chunking | Rust SIMD (Step 5) |
| Drop Detection | `DropDetector.ts` | 211 | JS derivative analysis | Rust (Step 5) |
| Metadata Parser | `metadataParser.ts` | 47 | Basic JS parser | Rust `symphonia` (Step 3) |
| Engine Core | `MixiEngine.ts` | 898 | WebAudio graph wiring | Rust AudioWorklet (Step 9) |
| Master Bus | `MasterBus.ts` | 356 | Native nodes + WaveShaperNode | Rust biquad + limiter (Step 9) |
| Deck FX | `DeckFx.ts` | 468 | 6 native effect chains | Rust DSP (Step 9) |
| Deck Channel | `DeckChannel.ts` | 216 | GainNode + BiquadFilter EQ | Rust (Step 9) |
| Headphone Bus | `HeadphoneBus.ts` | 244 | ChannelSplitter/Merger | Rust (Step 9) |
| AI AutoMix | `AutoMixEngine.ts` | 308 | JS FSM + 18 intents | Rust FSM (Step 6) |
| AutoMixer | `AutoMixer.ts` | 413 | JS crossfade logic | Rust (Step 6) |

**Total migration surface: ~4,173 lines of TypeScript → Rust.**

### What Mixi Already Has That Accelerates This Plan

1. **Zustand store as single source of truth** — Master FX (filter/dist/punch), deck state, AI controls all flow through the store. This is the exact pattern needed for Step 10's SharedArrayBuffer binding: swap `store.setState()` → `Atomics.store()` with a one-line change per parameter.

2. **`useMixiSync` hook** — Already implements the `store → engine` forwarding pattern. When the engine becomes Rust, only the sync hook's implementation changes — not the 30+ subscribers.

3. **Ghost field system** — The AI ghost proxy (`AutoMixEngine.createGhostProxy()`) marks which fields are AI-controlled. This maps directly to the Rust FSM's output channel in Step 6.

4. **Structured logger** — Zero `console.*` calls in the codebase. Rust's `log` crate output can be forwarded through the same pipeline.

5. **73 unit tests** — Each step's migration can be validated by ensuring these tests still pass against the new Rust-backed implementation.

---

## 🗺️ The 10-Step Masterplan

### 🟢 PHASE 1: Infrastructure (Tooling & Security)

**Goal:** Prepare the build pipeline, integrate Rust into the monorepo, and unlock shared memory.

#### Step 1: Rust+Wasm Ecosystem Setup
- Initialize Rust crate `mixi-core/` inside the monorepo with `cargo init --lib`
- Configure `wasm-pack` with `--target web` (not `bundler`) for direct ESM import
- Add `vite-plugin-wasm` + `vite-plugin-top-level-await` to Vite config
- Proof-of-concept: export a `fn add(a: f32, b: f32) -> f32` that runs in the browser
- CI integration: add `wasm-pack build` to the GitHub Actions workflow

```toml
# mixi-core/Cargo.toml
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
```

> **Effort:** ~2 days. **Risk:** Low. No production code changes.

#### Step 2: Cross-Origin Isolation (Unlock SharedArrayBuffer)
- **FastAPI** (`api/main.py`): add response headers
  ```python
  response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
  response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
  ```
- **Vite dev server**: configure in `vite.config.ts`
  ```typescript
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    }
  }
  ```
- **Electron**: set headers in `main.ts` `session.defaultSession.webRequest.onHeadersReceived`
- **Runtime validation**: assert `window.crossOriginIsolated === true` in `AudioDeviceGuard.ts`

> **Effort:** ~1 day. **Risk:** Medium — may break external resource loading (CDN fonts, images) that lack CORS headers. Audit all `<link>`, `<img>`, and `fetch()` calls.

> **Browser Support:**
> | Browser | SharedArrayBuffer | Notes |
> |---------|------------------|-------|
> | Chrome 92+ | ✅ | Requires COOP/COEP headers |
> | Firefox 79+ | ✅ | Requires COOP/COEP headers |
> | Safari 16.4+ | ✅ | Requires COOP/COEP headers |
> | Electron 18+ | ✅ | Configure via session headers |

---

### 🟡 PHASE 2: Rust as the Brain (Offload Main Thread)

**Goal:** Keep the WebAudio API for now, but move CPU-intensive analysis to Rust. The user-facing audio pipeline is untouched.

#### Step 3: Metadata Parsing Migration
- Replace `metadataParser.ts` (47 lines) with Rust `symphonia` crate
- Read `ArrayBuffer` directly from the browser into Rust linear memory
- Extract ID3v2 tags, cover art, duration, sample rate, channel count
- Return structured data via `wasm-bindgen` (no JSON serialization — use `JsValue`)
- **Benchmark target:** < 1ms for a 10MB MP3 file (currently ~5ms in JS)

> **Effort:** ~2 days. **Risk:** Low — metadata parsing is fire-and-forget, no hot path.

#### Step 4: DSP Analysis — BPM & Key Detection
- Port `BpmDetector.ts` (449 lines) using `rustfft` for onset detection
- Port `KeyDetector.ts` (311 lines) using chromagram → pitch class → Camelot
- Run in a Web Worker (not main thread) to avoid blocking UI
- JS passes the decoded `AudioBuffer` channel data; Rust returns `{ bpm: f64, key: String }`
- **Benchmark target:** < 20ms for a 5-minute track (current JS: ~200ms)
- Consider `aubio-rs` bindings for battle-tested algorithms

> **Effort:** ~5 days. **Risk:** Medium — FFT accuracy must match or exceed current JS implementation. A/B test against a corpus of 100 tracks with known BPM/key.

#### Step 5: Waveform RMS & Drop Detection
- Replace `WaveformAnalyzer.ts` (252 lines) and `DropDetector.ts` (211 lines)
- Rust computes per-band RMS (low/mid/high) and transient energy derivatives
- Data transfer via `SharedArrayBuffer` or `wasm-bindgen` typed array views (zero-copy)
- Generate `WaveformPoint[]` directly in Wasm linear memory, pass view to JS
- **Benchmark target:** < 10ms for full waveform generation (current JS: ~80ms)

> **Effort:** ~3 days. **Risk:** Low — data is computed once per track load.

#### Step 6: AutoMix FSM (The "Orchestra Conductor")
- Migrate `AutoMixEngine.ts` (308 lines) and `AutoMixer.ts` (413 lines) logic to Rust
- Rust FSM (Finite State Machine) receives the Blackboard state (BPM, energy, position, key)
- Outputs a command stream: `Vec<MixCommand>` → serialized as `Float32Array`
  ```rust
  enum MixCommand {
      SetCrossfader(f32),
      SetEq(DeckId, Band, f32),
      SetVolume(DeckId, f32),
      TriggerLoop(DeckId, f32),  // beats
  }
  ```
- The Rust module does **not** touch audio — it only computes control signals
- The existing `useMixiSync` hook consumes the command stream and dispatches to store

> **Effort:** ~5 days. **Risk:** Medium — the 18 AI intents have complex phase logic. Migrate incrementally (start with `DropSwapIntent`, `FilterWashoutIntent`).

---

### 🔴 PHASE 3: Rust as the DSP Engine (The AudioWorklet Bypass)

**Goal:** Eliminate the WebAudio API node graph entirely. Raw audio enters Rust and exits as the final master signal. This is the endgame.

#### Step 7: AudioWorklet Scaffolding (The Dummy Node)
- Write a custom `AudioWorkletProcessor` in raw JS (Worklet thread cannot import ES modules)
- Load the `.wasm` binary inside the Worklet via `WebAssembly.instantiate()`
- Initialize `SharedArrayBuffer` for the audio data bus
- Implement `process(inputs, outputs, parameters)` returning silence — validates the tick runs at real-time priority
- **Validation:** measure `performance.now()` jitter inside the Worklet. Target: < 0.1ms variance.

```javascript
// audio-worklet-processor.js (runs in Worklet thread)
class MixiDSP extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasmReady = false;
    this.port.onmessage = async (e) => {
      if (e.data.type === 'init') {
        const { module, memory } = e.data;
        this.instance = await WebAssembly.instantiate(module, {
          env: { memory }
        });
        this.wasmReady = true;
      }
    };
  }
  process(inputs, outputs) {
    if (!this.wasmReady) return true;
    // Step 9 fills this in
    return true;
  }
}
registerProcessor('mixi-dsp', MixiDSP);
```

> **Effort:** ~3 days. **Risk:** High — Worklet thread has strict constraints (no `fetch()`, no DOM, no GC pauses allowed). The `.wasm` must be pre-compiled on the main thread and transferred via `postMessage`.

#### Step 8: Lock-Free Ring Buffer (The Audio Bridge)
- Implement SPSC (Single Producer, Single Consumer) ring buffer using `SharedArrayBuffer`
- **Producer** (Web Worker): decodes MP3/FLAC → float samples → writes to ring buffer
- **Consumer** (AudioWorklet/Rust): reads from ring buffer → feeds DSP pipeline
- Use Rust crate `rtrb` compiled to Wasm, or hand-roll with `Atomics.load/store`
- Buffer size: 4096 samples (~93ms @ 44.1kHz) — enough for decode jitter, small enough for low memory

```
┌──────────────┐    SharedArrayBuffer    ┌──────────────────┐
│  Web Worker  │ ──── Ring Buffer ─────▶ │  AudioWorklet    │
│  (Decoder)   │    (lock-free SPSC)     │  (Rust DSP)      │
└──────────────┘                         └──────────────────┘
       ▲                                         │
       │ postMessage(ArrayBuffer)                 │ output[0][0..127]
       │                                         ▼
  ┌─────────┐                              ┌───────────┐
  │ Main    │◀─── SharedArrayBuffer ──────│ Speakers  │
  │ Thread  │     (parameter bus)          │ / Phones  │
  └─────────┘                              └───────────┘
```

> **Effort:** ~5 days. **Risk:** High — if the decoder can't keep up, the ring buffer underflows and audio glitches. Need watermark monitoring + fallback to WebAudio decode.

#### Step 9: Custom DSP Engine (EQ & Filters in Wasm)
- Implement the full mixer signal chain in Rust:
  - **Per-deck:** 3-band parametric EQ (biquad IIR, 64-bit coefficients), Color FX filter (LPF/HPF sweep), gain/volume, 6 send effects
  - **Master bus:** distortion (waveshaper), punch (parallel compression), master filter, brickwall limiter, stereo analyser
  - **Crossfader:** equal-power and sharp curves (port `mathUtils.ts` functions)
  - **Headphone bus:** PFL mix, split mode
- Model the EQ after analog hardware (Allen & Heath Xone:92 resonance curves)
- The Rust DSP operates at 64-bit float internally, truncating to 32-bit only at the final `outputs[]` write
- This replaces: `MixiEngine.ts`, `MasterBus.ts`, `DeckFx.ts`, `DeckChannel.ts`, `HeadphoneBus.ts` (~2,182 lines)

> **Effort:** ~15 days. **Risk:** Very high — this is the heart of the audio engine. Must A/B test against the current WebAudio output. Any audible difference is a bug.

#### Step 10: Zero-Cost State Binding via Shared Memory
- Allocate a dedicated `SharedArrayBuffer` for parameter control (the "parameter bus")
- Layout: 128 `Float32` slots (one per controllable parameter)
  ```
  Slot 0:  master.volume
  Slot 1:  master.filter
  Slot 2:  master.distortion
  Slot 3:  master.punch
  Slot 4:  crossfader
  Slot 5:  deck_a.volume
  Slot 6:  deck_a.gain
  Slot 7:  deck_a.eq_low
  ...
  Slot 63: deck_b.eq_high
  ```
- Modify `useMixiSync` to write directly to `Float32Array` view instead of calling `engine.setX()`
- The Rust AudioWorklet reads these slots every 128-sample tick via `Atomics.load()`
- **Result:** moving a React slider → `Atomics.store()` → Rust reads it in the same audio callback. Zero FFI. Zero message passing. Zero serialization.

> **Effort:** ~3 days (after Step 9). **Risk:** Low — this is just plumbing once the DSP engine works.

---

## 🧠 Architectural Advantages

1. **Modularity:** Steps 1–6 never break the existing WebAudio pipeline. They only change who *computes* data (JS → Rust), not how audio is *routed*. Steps 7–10 replace the routing, but by then the analysis layer is already battle-tested.

2. **Safe Rollback:** Every step is a standalone PR that can be merged, tested, and reverted independently. The feature-flag pattern (`useRustBPM: boolean` in Settings) allows A/B testing in production.

3. **Incremental Value:** Each step delivers measurable improvement:
   | Step | User-Visible Benefit |
   |------|---------------------|
   | 3 | Instant track metadata (no loading spinner) |
   | 4 | 10× faster BPM/key detection |
   | 5 | Instant waveform rendering |
   | 6 | Smarter, faster AI automix decisions |
   | 9 | Analog-modeled EQ with 64-bit precision |
   | 10 | True zero-latency knob response |

4. **Cross-Platform:** This pipeline (Wasm + SharedArrayBuffer + AudioWorklet) works identically on Chrome, Firefox, Safari 16.4+, Edge, and Electron. No platform-specific code.

5. **Groovebox Ready:** The drum synth (`GrooveboxEngine.ts`) can also be migrated to the Rust DSP in Step 9, giving sample-accurate sequencing without JS timer jitter.

---

## ⚠️ Risk Matrix

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Wasm binary too large (>2MB) | Slow first load | Medium | Tree-shake unused Rust deps; lazy-load `.wasm` after splash screen |
| AudioWorklet Wasm init fails | No audio | Low | Fallback to current WebAudio pipeline |
| Ring buffer underflow | Audio glitches | Medium | Watermark monitoring; pre-buffer 2× before playback |
| Safari SharedArrayBuffer quirks | Broken on iOS | Low | Safari 16.4+ is stable; test in CI with Playwright WebKit |
| 64-bit biquad sounds different | User complaints | Medium | A/B blind test with 50 reference tracks |
| Web Worker decode can't keep up | Stuttering | Low | Use `AudioDecoder` API (if available) or fall back to `decodeAudioData` |

---

## 📅 Estimated Timeline

| Phase | Steps | Effort | Cumulative |
|-------|-------|--------|------------|
| 🟢 Infrastructure | 1–2 | ~3 days | Week 1 |
| 🟡 Rust Brain | 3–6 | ~15 days | Weeks 2–4 |
| 🔴 Rust DSP Engine | 7–10 | ~26 days | Weeks 5–9 |

**Total: ~44 engineering days** (assuming one senior Rust/WebAudio developer).

> Phase 2 alone (Steps 3–6) delivers 80% of the performance gains with 20% of the risk. It's the highest-ROI investment and can ship as v0.2.0 independently.