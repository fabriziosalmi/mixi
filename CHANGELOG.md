# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.9] - 2026-04-05

### Added — TurboBass v2 + Performance Features + MIDI Presets

**TurboBass v2 — 5 Iterations**

*Audio Engine (Iter 1)*
- Sub-oscillator (sine, -1 octave) with mixable SUB level
- Analog drift LFO (~0.1Hz, ±5 cents) for organic fatness
- Pre-filter drive (tanh saturation) — the "squelch"
- Accent click (1ms noise burst, -22dB) for percussive transients
- Exponential slide with variable glide time (faster on accents)
- Extended accent decay (+50%) with momentary resonance Q boost

*FX Chain (Iter 2)*
- Rat-style asymmetric distortion (germanium diode modeling)
- BPM-synced delay with HP filter (200Hz) in feedback loop
- Ducking spring reverb (generated metallic IR, ducks on note-on)
- Chorus (dual modulated delay lines), auto-pan (LFO → StereoPanner)
- Filter LFO with BPM-synced subdivisions (1/4 → 1/32)
- Internal brick-wall limiter (ratio 20:1, 1ms attack)

*Usability (Iter 3)*
- Smart randomizer (6 scales: minor, phrygian, pentatonic, blues, dorian, chromatic)
- Pattern mutate (progressive alteration preserving DNA)
- ACID macro knob (single gesture: cutoff + envMod + resonance + decay)
- Pattern shift ◀▶, polyrhythmic length (1-32 steps)
- Transpose ±24 semitones, crossfader-linked cutoff

*UI (Iter 4)*
- Industrial chassis (dark metallic gradient + brushed texture)
- VFD display (cyan-green glow: bank/pattern/name/BPM/transpose)
- LED glow sequencer with color-coded step indicators
- Roland-style horizontal param rows (ACC/SLD/UP/DN per step)
- Filter visualizer (real-time Canvas LP response curve)
- Per-step note editor (right-click popup), 16/32-step toggle

*Presets (Iter 5)*
- 32 factory patterns: 4 banks × 8 (Acid House, Techno, Minimal, Experimental)
- Pattern bank selector (A/B/C/D + 1-8)
- Ghost sequence (auto-generates pattern after 5min idle)
- PANIC button (reset all synth+FX to safe defaults)

**Performance Features**
- Slip mode, beat jump (1-32 beats), 3 EQ models (LR4 Isolator, DJ Peak, Xone Kill)
- Master 3-band EQ, click-to-seek on waveform
- 37 MIDI controller presets (Pioneer, Numark, Denon, Hercules, NI, Reloop, Roland, Akai, A&H, Behringer, Traktor)

### Changed
- TurboBass README description updated with full v2 feature set
- js303 by thedjinn credited in Acknowledgements

## [0.2.8] - 2026-04-05

### Added — House Decks + MIXI Sync Protocol + MIDI Clock

**Pluggable Deck System**
- `src/decks/` registry with lazy-loaded components and DeckMode union type
- One-line registration: add mode to `DeckMode`, push entry to `HOUSE_DECKS`

**TurboKick Deck** — Real-time kick drum synthesizer + 16-step sequencer
- Pitch/decay/click/drive synthesis, THUMP macro, dual valve distortion (tube + punch)
- Filter + LFO, Berghain-style RUMBLE (dark reverb + rhythmic delay + sidechain pump)
- BPM sync, quantized engage, speaker touchpad with shockwave animations

**TurboBass Deck** — TB-303 acid synth (pure WebAudio, no external Wasm dependency)
- Persistent oscillator (saw/square) + resonant LP filter (Q up to 26)
- Filter envelope with accent boost + env mod depth, slide (60ms portamento)
- Per-step note/gate/accent/slide/octave, 16-step acid sequencer
- tanh waveshaper distortion, BPM-synced dotted 8th delay

**MIDI Clock Out + In (24 ppqn)**
- `startClock()` sends 0xFA Start + 24 ppqn 0xF8 ticks to all MIDI outputs
- Dynamic BPM tracking from active deck
- Clock input: calculates external BPM from received ticks
- Two MIXI instances can now sync via standard MIDI Clock

**MIXI Sync Protocol v1** (src/sync/)
- 64-byte binary packet codec (encode/decode, fixed-point u32 phase)
- PID phase lock controller with gain scheduling, hysteresis, phase unwrapping
- UDP transport on port 4303 (Electron IPC + dgram)
- BroadcastChannel fallback for browser-only sync
- Predictive onset triggers (kick/snare/hihat countdown for VJ software)
- Dynamic Dictatorship master election with epoch-generation split-brain resolution
- Flywheel mode, dead reckoning, graceful degradation (phase-lock → tempo-match)
- 5 final amendments: drain-to-newest, feed-forward pitch nudge, epoch poisoning guard, master claim cooldown

**Documentation**
- `CREATE_DECKS_AI.md`: complete AI guide for building deck plugins (506 lines)
- `MIXI_PROTOCOL.md`: scientific spec with 55 engineering directives + PDF export

### Tests
- 51 new sync tests (protocol codec + PID controller)
- 2 new E2E sync tests (BroadcastChannel two-tab exchange)
- Total: 169 JS unit + 7 E2E + 152 Rust = 328 tests

New files: `src/decks/turbokick/` (TurboKickDeck.tsx, TurboKickEngine.ts, TurboKickBus.ts, kickSynth.ts, types.ts)

## [0.2.6] - 2026-04-04

### Added — Mixer Hardening + Audit Fixes + Test Gate

**Wasm DSP Engine — Now Actually Processing Audio**
- AudioWorklet calls Rust `DspEngine.processRaw()` via direct Wasm memory access
- 2-input worklet (Deck A + Deck B), full signal chain in Rust
- ParamLayout offset mismatch fixed (all FX byte offsets aligned TS ↔ Rust)
- SharedParamBus with layout versioning (PARAM_LAYOUT_VERSION=2 at offset 508)
- Wasm module fetched, compiled, and sent to worklet thread

**Linkwitz-Riley 24dB/oct EQ (WebAudio path)**
- Parallel 3-band isolator with cascaded Butterworth = LR4
- Flat magnitude sum at crossover, zero phase difference
- Kill = gain 0 on one band only, others 100% unaffected

**Audit Fixes (13/18 from ISSUES.md)**
- C1: Stereo mono bug — separate `master_l`/`master_r` instances
- C2: Master double-processing — independent state per channel
- C3+C4: Wasm URL + worklet paths — `import.meta.url` resolution
- H1: `processRaw` bounds validation (offset + size <= memory size)
- H2: ParamBus version check (Rust validates on every `process()` call)
- H4: Wasm panic message extraction via TextDecoder
- H5+M4+M7: Export name guessing → explicit error reporting
- M1: NaN sort panic → `unwrap_or(Equal)` in drop_detect
- M6: Waveshaper div-by-zero → `.max(1e-10)` guard

**Headroom Hardening**
- Punch compressor gain compensation: `1/(1+wet)` prevents +3.5dB overshoot

**Comprehensive Test Gate (275 tests)**
- 118 JS unit tests (Vitest): stores, math, WAV header, ParamLayout, crossfader, GPU detect
- 152 Rust tests: DSP modules (127 unit + 24 integration + 1 bench)
- 5 Playwright E2E: app launch, layout, VFX toggle, REC button, console errors
- CI pipeline: `.github/workflows/test.yml` — test-js + test-rust on every push

### Stats
- 275 total tests (118 JS + 152 Rust + 5 E2E)
- Rust DSP benchmark: 10.76µs/block, 99.6% headroom
- Build: 2.08s (Vite), 6.9s (wasm-pack)

## [0.2.5] - 2026-04-04

### Fixed
- **Parallel 3-Band Isolator EQ**: rewritten from series shelving to parallel crossover
- **Gate FX**: rewritten as simple phase-based volume chop (was broken scheduling)
- **WebGPU VFX**: fixed swap chain CopyDst error, render direct to swap chain
- **VFX tuning**: thinner spectrum border, sensitivity boost, removed polar circle, softer CRT/vignette

## [0.2.4] - 2026-04-04

### Added — VFX Tier 2 (7 VJ secrets, 16/30 total)
- Ring texture spectrogram (128×64 r32float, 64-frame audio history)
- Feedback loops (ping-pong render targets, zoom + hihat rotation)
- CRT phosphor emulation (barrel distortion + RGB subpixel mask + curved scanlines)
- Semantic color binding (CSS `--clr-a`/`--clr-b` → GPU uniforms)
- Filter washout (HPF → white/contrast, LPF → dark/desaturate)
- Beatgrid Tron floor (BPM-synced perspective grid, deck-colored)
- Peak-hold downsampling (0.95 decay per frame)
- 14-effect shader chain, spectrum border contour around page

## [0.2.3] - 2026-04-04

### Added — WebGPU VFX Engine (Pillar 5 Step 1)
- WebGPU audio-reactive visual engine with Canvas 2D fallback
- 10 composited WGSL shader effects (single draw call per frame)
- VJ secrets: FFT as GPU texture, isolated stems, BPM phase sync, energy derivative
- Polar spectrum, chromatic aberration, dynamic film grain, Rule of Black
- ESC kill-switch (instant GPU teardown)
- float32-filterable feature negotiation (linear/nearest sampler adaptive)

## [0.2.2] - 2026-04-04

### Added — Crash-Proof WAV Recording (Pillar 3)
- Disk-backed WAV recording via SPSC ring buffer → IPC → fs.writeSync
- Fixed ~1MB RAM regardless of recording length (6+ hour sets safe)
- 32-bit float IEEE WAV format, orphan detection and recovery on crash
- 9 Electron IPC handlers (open/flush/finalize/cancel/save-as/recover/discard)
- Dual-mode RecPanel: Electron gets disk WAV, web keeps MediaRecorder → WebM

## [0.2.1] - 2026-04-04

### Added — Native Audio I/O (Pillar 1, Phase D Complete)
- mixi-native Rust crate: cpal 0.15 for direct hardware audio output
- N-API addon loader with platform detection (darwin-arm64/x64, win32, linux)
- Zero-copy SPSC ring buffer consumer from SharedArrayBuffer
- Device enumeration, lock-free audio thread, 364KB ARM64 dylib
- Settings UI: native output toggle + device dropdown
- MixiEngine: switchToNativeOutput() / switchToWebOutput()

## [0.2.0] - 2026-04-04

### Added — DSP Engine Hardening + Electron God Mode
- Predictive limiter (0.2ms lookahead, poly-knee)
- Electron audio optimization flags (128-sample buffer, GPU rasterization, SIMD)
- Mobile landscape compact mode
- Drop detection in Rust/Wasm

## [0.1.4] - 2026-04-04

### Added -- Phase 3: Rust DSP Engine Foundation

**DSP Abstraction Layer** (Layer 0)
- DspProcessor / DspChain / DspParamBus interfaces for backend-agnostic audio processing
- Parameter Bus Layout: 512-byte shared memory map (40+ parameter offsets)
- LocalParamBus (native mode) and SharedParamBus (Wasm mode with Atomics)
- NativeDeckProcessor / NativeMasterProcessor: WebAudio node wrappers
- AudioWorklet shell (passthrough, public/worklets/mixi-dsp-worklet.js)
- Feature flag: useWasmDsp in Settings (default: off, persisted)

**Lock-Free Ring Buffer** (Layer 2)
- SPSC ring buffer in Rust (ring_buffer.rs) with Acquire/Release atomic ordering
- SharedArrayBuffer bridge: audio ring (93ms), param bus (512B), metering bus (24B)
- Feature detection and MessagePort worklet communication

**8 DSP Primitives in Rust** (Layer 3)
- Biquad filter: lowpass, highpass, lowshelf, highshelf, peaking (Audio EQ Cookbook)
- ThreeBandEq: 250 Hz / 1 kHz / 4 kHz matching DeckChannel EQ
- Gain: simple multiply + click-free ramp
- Limiter: brick-wall peak limiter with instant attack
- Compressor: parallel compression with auto-makeup gain
- Delay: variable delay line with linear interpolation and feedback
- Reverb: Schroeder algorithm (4 comb + 2 allpass, rate-scaled)
- Flanger: LFO-modulated short delay with feedback
- Phaser: 4-stage allpass chain with LFO frequency sweep
- Gate: beat-locked amplitude gate with smoothed envelope
- Waveshaper: tanh soft-clip distortion with quadratic drive scaling

### Changed
- mixi-core crate: 3,987 lines of Rust across 17 source files
- .wasm binary: 120 KB (unchanged from v0.1.3 -- DSP not yet FFI-exported)

### Stats
- 176 total tests (103 Rust + 73 JavaScript)
- Zero behavioral change (DSP modules ready but not wired to audio graph)
- Full JS fallback preserved on all paths

## [0.1.3] - 2026-04-04

### Added — 🦀 Rust/Wasm Integration (Phase 2 Complete)

- **mixi-core Crate**: New `mixi-core/` Rust crate compiled to WebAssembly (87 KB binary)
  - `wasm-pack` build pipeline with `--target web`, `opt-level = "z"`, LTO
  - Vite integration via `vite-plugin-wasm` + `vite-plugin-top-level-await`
  - Cross-Origin Isolation (COOP/COEP headers) for `SharedArrayBuffer` support
  - Lazy-loading `wasmBridge.ts` singleton with TypeScript types

- **Waveform Analysis in Rust** (`waveform.rs`)
  - `compute_rms()`, `compute_rms_multichannel()`: windowed RMS computation
  - `normalise()`: in-place peak normalization
  - `peak_level()`: absolute peak scan across all channels
  - `build_waveform()`: flat interleaved [low,mid,high,...] array builder
  - Automatic JS fallback when Wasm not loaded

- **BPM Detection in Rust** (`bpm.rs`)
  - Adaptive spectral-flux onset detection
  - Multi-hop IOI histogram with Gaussian smoothing
  - Octave resolution with DJ range preference (100–185 BPM)
  - Grid alignment refinement (±2.5 BPM sweep at 0.1 steps)
  - Integer BPM snap with alignment validation
  - Beatgrid offset detection

- **Key Detection in Rust** (`key.rs`)
  - Goertzel algorithm for pitch-class energy (48 bins, 4 octaves)
  - Krumhansl-Kessler key profiles (major + minor)
  - Pearson correlation for all 24 keys
  - Camelot wheel notation output
  - `is_harmonic_match()` for DJ compatibility check

- **AutoMix Computation in Rust** (`automix.rs`)
  - Beat math: `time_to_beat()`, `beat_to_time()`, `snap_to_phrase()`, `calc_mix_out_beat()`
  - Phase alignment: `compute_phase_alignment()` with signed delta + alignment flag
  - Full blackboard computation: 18 raw inputs → 20 derived metrics per tick
  - Intent scoring helpers: `urgency_curve()`, `score_bass_swap()`, `score_dead_air()`, `score_phase_correction()`
  - 20 Hz AI tick now runs beat math in Rust

- **SystemHud WASM Indicator**: Green dot status when Rust/Wasm module is loaded and active

- **Test Coverage**: 112 total tests (39 Rust + 73 JS), all passing

### Changed

- **WaveformAnalyzer.ts**: Hot loops (RMS, normalization, peak) now use Rust fast path
- **BpmDetector.ts**: Full BPM pipeline runs in Rust when available (log prefix `[Rust]`)
- **KeyDetector.ts**: Goertzel + key matching runs in Rust when available (log prefix `[Rust]`)
- **Blackboard.ts**: AI blackboard computation uses Rust `compute_blackboard()` at 20 Hz
- **Build Pipeline**: `npm run build:wasm` integrated into main `build` script

### Performance

- `.wasm` binary: 87 KB (release, opt-level=z, LTO, stripped)
- BPM detection: JS hot loops replaced by Rust/Wasm
- Key detection: Goertzel on millions of samples now runs in Rust
- AutoMix tick: beat math + phase alignment in Rust (20 Hz × 20 derived values)
- All modules: automatic JS fallback if Wasm not loaded

## [0.1.1] - 2026-04-04

### Added

- **MIDI Presets**: Akai MIDI Mix factory CC preset (`src/midi/presets/akaiMidiMix.ts`)
- **MIDI Actions**: `MASTER_VOL`, `HEADPHONE_MIX`, `HEADPHONE_LEVEL` added to MidiManager
- **MIDI Settings Tab**: Full interactive parameter-by-parameter Learn UI in Settings
  - 24 mappable parameters organized by section (Deck A, Deck B, Master)
  - Per-parameter Learn button with visual feedback ("⏳ Move control…")
  - Per-parameter delete (✕) and global Clear All
  - Preset dropdown (Manual / Akai MIDI Mix)
- **MIDI Store**: `loadPreset()`, `exportMappings()`, `activePreset` tracking
- **Master FX Store**: Filter, Distortion, Punch migrated from React local state to Zustand store
  - 3 new store actions: `setMasterFilter`, `setMasterDistortion`, `setMasterPunch`
  - Full sync pipeline: store → `useMixiSync` → engine (bidirectional)
  - Bridge whitelist + state snapshot includes master FX (AI/MCP agent can control remotely)
  - AI ghost proxy marks filter/dist/punch for glow indicators
  - Panic handler resets master FX via store (single source of truth)
- **MixiEngine API**: Public `setLimiterEnabled()` method replaces unsafe internal cast
- **Testing Suite**: 73 unit tests across 5 test files (+121% from 33)
  - `mixiStore.test.ts` — 27 assertions (+11: master FX, clamping, modes, AI, crossfader curve)
  - `mathUtils.test.ts` — 21 assertions (NEW: dbToGain, crossfaderGains smooth/sharp, logFrequency, clamp)
  - `logger.test.ts` — 8 assertions (NEW: all log levels, console routing, DEV-only debug, extra data)
  - `settingsStore.test.ts` — 8 assertions
  - `midiStore.test.ts` — 9 assertions
- **Coverage**: `audio/utils` 12.5% → 75%, `utils/logger` 38% → 100%
- **Dynamic Version**: `__APP_VERSION__` injected from `package.json` via Vite `define`
- **Type Declaration**: `src/vite-env.d.ts` for Vite client types

### Changed

- **MasterBus Distortion**: Dynamic oversample toggle (`'4x'` when active, `'none'` when bypassed) — dramatically reduces CPU when distortion is off
- **MasterBus Buffer**: Simplified `Float32Array(samples)` allocation (no intermediate `ArrayBuffer`)
- **SystemHud CPU Meter**: True O(1) ring buffer (`Float64Array`) replaces `Array.shift()` per-frame overhead
- **MasterLedScreen Lissajous**: Pre-computed 256-entry RGBA alpha LUT eliminates ~61,440 string allocs/sec in inner loop
- **PremiumJogWheel Iris**: Pre-computed `HEX_LUT[256]` replaces `toString(16).padStart()` in render loop
- **SampleManager**: Fixed inverted logger arguments `(message, tag)` → `(tag, message)`
- **Logging Policy**: Zero `console.*` calls remain in entire `src/` directory — all migrated to structured `log.*`
- **Empty Deck Overlay**: Reduced from opaque black/blur to subtle frosted-glass
- **Demo Track Loading**: Now loads every session (not one-shot)
- **WS Bridge Logging**: Only first connection attempt logged; subsequent reconnects silent until success
- **Settings Persistence**: Added explicit `merge` function to strip stale `loadDemoTrack` from localStorage
- **README**: Tech stack corrected; test scripts added
- **DECKS.md**: Fixed API mismatches
- **Audio Decode Error**: Now includes browser's native error message and lists supported formats

### Fixed

- **Deck B Crash**: Removed forced `setDeckTrackLoaded('B', true)` at startup
- **Play Buttons Broken**: `loadDemoTrack` localStorage fix
- **AudioContext Double-Close**: Guard `ctx.state !== 'closed'`
- **Version String**: SettingsModal reads from `package.json`
- **ArrayBuffer Consumed**: `decodeAudioData` receives `arrayBuffer.slice(0)`
- **PitchStrip Nudge Timer**: `setTimeout` now stored in ref and cleared on unmount (prevents stale timer leak)
- **MasterHud LimiterDot**: Uses public `MixiEngine` API instead of unsafe internal cast

### Removed

- **Tracked Build Artifacts**: `tsconfig.tsbuildinfo` removed from git tracking
- **Stale .gitignore**: Fixed malformed entries; added `api/dist/`, `api/build/`, `*.spec`, `coverage/`

## [0.1.0] - 2026-04-03

### Added

- Initial public release of Mixi DAW
- Dual-deck DJ engine with Web Audio API (hand-wired graph, no wrappers)
- 3-band EQ (Low Shelf / Mid Peak / High Shelf) with kill switches
- Bipolar Color FX filter (LPF/HPF sweep)
- 6 send effects per deck: Filter, Delay, Reverb, Phaser, Flanger, Gate
- BPM detection with beat grid and phase-aware sync
- Key detection (Chromagram → pitch class → Camelot notation)
- Drop detection for mix-point suggestions
- 8 hot cue slots per deck with quantize snap
- Auto-loop engine (1/32 to 32 beats)
- Performance pads with multiple modes
- Step sequencer groovebox with 8-voice drum synth
- AI Automixer with 18 intent modules across 5 categories
- MIDI Learn system with WebMIDI API
- Headphone cueing (PFL) with split mode
- Recording engine (real-time WAV export)
- 17 built-in skins with CSS custom property theming
- Crossfader with smooth/sharp curve selection
- Electron desktop app packaging (macOS, Windows, Linux)
- Python backend with FastAPI for MCP bridge
- VitePress documentation site with 5 guide pages
- Mobile scale wrapper for responsive desktop-first layout

[0.2.8]: https://github.com/fabriziosalmi/mixi/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/fabriziosalmi/mixi/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/fabriziosalmi/mixi/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/fabriziosalmi/mixi/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/fabriziosalmi/mixi/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/fabriziosalmi/mixi/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/fabriziosalmi/mixi/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/fabriziosalmi/mixi/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/fabriziosalmi/mixi/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/fabriziosalmi/mixi/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/fabriziosalmi/mixi/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/fabriziosalmi/mixi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fabriziosalmi/mixi/releases/tag/v0.1.0
