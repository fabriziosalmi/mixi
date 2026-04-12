<p align="center">
  <img src="screenshot.png" alt="MIXI — Browser-native DJ workstation" width="100%" />
</p>

<h1 align="center"><a href="https://www.mixidaw.com/app/">MIXI</a></h1>

<p align="center">
  Deterministic audio workstation. Browser-native. Zero install.<br>
  Dual decks, Rust/Wasm DSP, WebGPU visuals, groovebox, automixer, beatmatching, 17 skins, MIDI, headphone cue.
</p>

<p align="center">
  <a href="https://www.mixidaw.com/app/"><strong>Launch in Browser</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/fabriziosalmi/mixi/releases/latest">Download Desktop</a> &nbsp;·&nbsp;
  <a href="https://www.mixidaw.com/">Website</a> &nbsp;·&nbsp;
  <a href="https://github.com/fabriziosalmi/mixi/discussions">Discussions</a>
</p>

<p align="center">
  <a href="https://github.com/fabriziosalmi/mixi/releases/latest"><img src="https://img.shields.io/github/v/release/fabriziosalmi/mixi?label=latest&color=00d4ff" alt="Latest Release"></a>
  <a href="https://github.com/fabriziosalmi/mixi/actions/workflows/test.yml"><img src="https://github.com/fabriziosalmi/mixi/actions/workflows/test.yml/badge.svg" alt="Test Gate"></a>
  <a href="https://github.com/fabriziosalmi/mixi/actions/workflows/docs.yml"><img src="https://github.com/fabriziosalmi/mixi/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-blue" alt="License"></a>
</p>

<table align="center">
  <tr>
    <td align="center"><a href="https://github.com/fabriziosalmi/mixi/releases/latest"><strong>macOS (ARM64)</strong><br><code>.dmg</code></a></td>
    <td align="center"><a href="https://github.com/fabriziosalmi/mixi/releases/latest"><strong>macOS (Intel)</strong><br><code>.dmg</code></a></td>
    <td align="center"><a href="https://github.com/fabriziosalmi/mixi/releases/latest"><strong>Windows</strong><br><code>.exe</code></a></td>
    <td align="center"><a href="https://github.com/fabriziosalmi/mixi/releases/latest"><strong>Linux</strong><br><code>.AppImage</code></a></td>
    <td align="center"><a href="https://www.mixidaw.com/app/"><strong>Browser</strong><br>Zero install</a></td>
  </tr>
</table>

---

## What This Is

MIXI is a dual-deck DJ engine and step sequencer that runs entirely inside a web browser. The DSP pipeline runs in Rust/Wasm (AudioWorklet) or falls back to hand-wired Web Audio API nodes. No Tone.js. No third-party audio wrappers. No server required.

Load two tracks. Mix them. The groovebox runs in parallel on its own bus. The automixer watches phase, spectrum, and headroom on a 50ms tick and applies corrections as visible, non-destructive mutations. Plug in a MIDI controller and it maps to anything. Pick one of 17 skins or write your own in pure CSS.

It ships as a static site. It also packages as an Electron desktop app for macOS, Windows, and Linux. An optional Python sidecar handles heavier analysis offline.

---

## Signal Chain

```
Deck A/B (Track mode):
  BufferSource → Trim → 3-Band Parallel Isolator EQ (LR4 24dB/oct)
    → ColorFX → DeckFX [FLT|DLY|REV|PHA|FLG|GATE]
      ├── Fader → Crossfader → MasterBus
      └── CueGain → HeadphoneBus

Deck A/B (TurboKick mode):
  KickSynth (pitch/decay/click/drive) → ValveA (tube) → ValveB (punch)
    → Filter+LFO → Delay → Rumble (dark reverb + sidechain pump)
      → DeckChannel.input → EQ → Fader → MasterBus

Deck A/B (TurboBass mode):
  MainOsc (saw/pulse) + SubOsc (sine, -1oct) → PreFilterHP (44Hz)
    → Drive (tanh) → DiodeLadder (4-pole AudioWorklet, tanh saturation)
      ↑ FilterLFO (BPM-synced) ↑ FilterEnv (bipolar, accent-modulated)
    → VCA (2ms attack) → Dry + Distortion (Rat asymmetric)
    → Delay (BPM-synced, HP feedback) → Bus (reverb, chorus, limiter)
      → DeckChannel.input → EQ → Fader → MasterBus

  EQ Crossover (Linkwitz-Riley):
    Trim → LP₁→LP₂(250Hz) → lowGain  → merge
    Trim → HP₁→HP₂(250Hz) → LP₃→LP₄(4kHz) → midGain → merge
    Trim → HP₃→HP₄(4kHz)  → highGain → merge
    Kill = gain 0. Other bands 100% unaffected.

MasterBus:
  Gain → MasterFilter → BandSplit (300Hz crossover)
    ├── Sub (<300Hz) → Mono Sum (phase-safe for PA)
    └── High (>300Hz) → Oversampled tanh Waveshaper
  → Parallel Compressor (gain-compensated) → DC Blocker (10Hz)
  → Headroom Pad (-0.3dB) → Brickwall Limiter → destination

HeadphoneBus:
  CueSum + MasterTap → Mix knob → Level → destination
  Split mode: Master → R ear | Cue → L ear

Wasm DSP Path (optional, toggle in Settings):
  Source A → Trim → AudioWorklet input[0] ─┐
  Source B → Trim → AudioWorklet input[1] ──┤→ Rust DSP Engine
    DspEngine: Deck EQ → ColorFX → FX → Fader → Crossfader
    → Master: Filter → Distortion → Punch → Predictive Limiter → DC Blocker
    ← 128 samples @ 44.1kHz, ~10µs per block (99.6% headroom)
```

EQ is a **parallel 3-band isolator** with Linkwitz-Riley 24dB/oct crossovers (two cascaded Butterworth per crossover point). Flat magnitude sum at crossover, zero phase difference between bands. Kill on any band silences only that band — other bands completely unaffected.

The Rust DSP engine (`mixi-core`) runs the full signal chain in an AudioWorklet when enabled: per-deck EQ, color filter, 5 effects, fader, crossfader mixing, master filter, distortion, parallel compression, predictive limiter (0.2ms lookahead), and DC blocker. Parameters flow via a 512-byte SharedArrayBuffer with layout versioning.

The brickwall limiter (threshold -0.5dB, ratio 20:1, attack 1ms) guarantees the output never exceeds 0dBFS regardless of how the faders are handled.

---

## Quick Start

The fastest way to install the desktop app on macOS or Linux is via our terminal installer:

```bash
curl -sL https://raw.githubusercontent.com/fabriziosalmi/mixi/main/install.sh | bash
```

Alternatively, to build and run it locally:

```bash
git clone https://github.com/fabriziosalmi/mixi.git
cd mixi
npm install
npm run dev
```

Open `http://localhost:5173`. Load audio files. Mix.

### Production Build

```bash
npm run build
npm run preview
```

### Electron Desktop App

```bash
npm run build:all
npm run dist            # current OS
npm run dist:mac        # macOS
npm run dist:win        # Windows
npm run dist:linux      # Linux
```

### Python Sidecar (optional)

Extended analysis, file management, and MCP bridge for external agents.

```bash
cd api
pip install -r requirements.txt
python main.py --port 7779
```

---

## Core Modules

| Module | What It Does |
|--------|-------------|
| **Dual Decks** | Independent transport, pitch/tempo, hot cues, loops, scratch emulation. Pluggable deck modes: Track, Groovebox, TurboKick, TurboBass. |
| **TurboKick Deck** | Kick drum synthesizer + 16-step sequencer. THUMP macro, dual valves (tube + punch), filter + LFO, Berghain-style RUMBLE. |
| **TurboBass Deck** | Acid synth with 4-pole diode ladder filter (AudioWorklet, mismatched first pole, per-sample tanh saturation, 2x oversampling). Mathematically derived DSP: VT from pole signal geometry, k_max from Barkhausen criterion, resonance compensation, quadratic curve. Saw + variable duty-cycle pulse wave, sub-oscillator, analog drift, pre-filter drive/HP. Bipolar filter envelope, octave-based env mod, accent with resonance-controlled depth. TIE (legato), gate length, slide time, filter tracking (Devil Fish mod). Rat-style distortion, ducking spring reverb, chorus, BPM-synced delay. ACID macro, copy/paste, pattern mutate/shift, 32 factory patterns (4 banks), 16/32-step sequencer. Two-row knob UI. |
| **3-Band Isolator EQ** | Parallel Linkwitz-Riley 24dB/oct crossover. Kill = gain 0, other bands unaffected. |
| **Deck Effects** | 10 built-in (7 in FX strip + 3 system): Filter (inline bipolar LP/HP), Delay (BPM-synced), Reverb (synthetic IR), Phaser (4-stage allpass), Flanger, Gate (beat-locked chop), Bitcrusher, Echo (dub delay with LP feedback), Tape Stop (LP darkening), Noise (white noise sweep). Parallel sends, gain-compensated. |
| **Master DSP** | Band-split distortion, gain-compensated parallel compression, DC blocker, brickwall limiter. Sub-bass mono sum. |
| **Rust DSP Engine** | Full signal chain in Wasm AudioWorklet. Per-deck EQ/FX/Fader + master chain. 10µs/block, 99.6% headroom. Toggle in Settings. |
| **AutoMixer** | Stateless 50ms-tick arbiter. Reads a Blackboard of deck states. Applies Ghost Mutations — visible, auditable corrections for phase drift, spectral clash, headroom recovery. |
| **Groovebox Deck** | 4-voice step sequencer (kick/snare/hat/perc) with drum synthesis on a decoupled bus. Own panning, mute, solo. Synced to master BPM. |
| **BPM/Key Detection** | Powered by [open-bpm](https://github.com/fabriziosalmi/open-bpm): 7-estimator architecture (IOI + Comb + AC + Spectral FFT + Hopf + Tempogram + Low-band AC), SuperFlux onset detection, metrical fusion for octave resolution. 68.8% Acc1 on GiantSteps, 8.5:1 vs librosa. Two-speed API (fast + full). Goertzel chromagram for key (Camelot). Pure Rust/Wasm — no browser pre-processing. |
| **MIDI** | WebMIDI API. Map any CC/note to any parameter. MIDI Clock Out/In (24 ppqn) for external gear sync. |
| **MIXI Sync** | Binary sync protocol (64-byte UDP packets, port 4303). PID phase lock, auto-discovery, master election, predictive VJ triggers. BroadcastChannel fallback for browser. |
| **Beatmatching** | Aerospace-grade PLL phase correction, harmonic sync, predictive phase, differential phase overlay, variable beatgrid, onset correlation, groove offset, drift compensation, audio clock reconciliation. |
| **Waveform** | Min-max decimation, drag-to-scrub, beatgrid editing (Shift+Click), BPM confidence display, overview viewport drag, energy shadow, zoom sync. Direct DOM writes, no React reconciliation. |
| **Headphone Cue** | Split-stereo or dual-output routing. Mix knob blends cue and master. |
| **Recording** | Crash-proof WAV recording (SPSC ring buffer → disk, 1MB fixed RAM). WebM fallback in browser. Orphan recovery on crash. |
| **WebGPU VFX** | 14-effect GPU shader: spectrum border, beat shockwave, particles, plasma, CRT, Tron floor, feedback loops. Canvas 2D fallback. ESC kill-switch. |
| **Native Audio** | Optional cpal output via N-API addon (Electron). CoreAudio/WASAPI/ALSA bypass. Zero-copy SharedArrayBuffer ring. |
| **17 Skins** | Runtime-switchable. Pure CSS custom properties — zero JavaScript per skin. |

### Available Skins

Acid, Aqua, Arcade Invaders, Blackfluo, Bloodmoon, Casino, Dune, E-Ink, Freetekno, Gold, Hologram, Industrial, Matrix, Nordic, Synthwave, Vaporwave, White.

Each skin is a directory containing `skin.json` (metadata) and `skin.css` (CSS custom properties). To create a new skin, copy any existing one and modify the variables. No TypeScript changes required.

### Mobile

Dedicated touch-optimized UI, code-split so desktop never downloads mobile code. Detects phones (`minDim < 500 + touch`) and loads a purpose-built layout.

- **Portrait** — Single-deck focus: hero BPM display, tall waveform, inline EQ/FX/PADS toolbar. Tap A/B to switch focus. Mini-strip shows the other deck's state. Crossfader pinned at bottom for thumb access.
- **Landscape** — Dual-deck mixing: both decks side-by-side with waveforms, pitch faders, nudge buttons, and a horizontal crossfader.
- **Overlays** — Slide-up glassmorphism panels (spring animation) for EQ, FX grid, performance pads, and headphone routing. Swipe down to dismiss.
- **Haptics** — Vibration feedback: tick on pad tap, snap on crossfader center detent, confirm on cue save, panic on shake reset.
- **Shake-to-panic** — Shake the phone to reset all EQ, FX, loops, and crossfader to defaults.
- **Beat pulse** — Deck card borders flash in sync with the BPM for visual rhythm feedback.
- **PWA** — Installable as a standalone app on iOS and Android. Safe area inset handling for notches.

---

## Architecture

```
src/
  audio/          Core engine, DSP nodes, sample manager, BPM/key detection
    dsp/          Wasm DSP bridge, SharedArrayBuffer param bus, worklet lifecycle
    nodes/        DeckChannel (LR4 EQ), MasterBus, HeadphoneBus, DeckFx
    recording/    Crash-proof WAV recording bridge
    native/       Native audio output bridge (cpal/N-API)
  gpu/            WebGPU VFX renderer, WGSL shaders, GPU detection
  ai/             AutoMixEngine, Blackboard, Ghost Mutations, intents
  decks/          Pluggable deck modes (TurboKick, TurboBass, future instruments)
  sync/           MIXI Sync protocol (packet codec, PID phase lock, bridge)
  groovebox/      Step sequencer engine, drum synthesis, UI
  automixer/      AutoMixer panel, beat utilities
  midi/           WebMIDI manager, controller mapping
  components/     React UI — decks, mixer, browser, HUD, settings
    mobile/       Touch-optimized mobile UI — portrait, landscape, overlays
  store/          Zustand stores — mixer state, settings, MIDI, samples
  hooks/          React hooks — sync bridge, keyboard shortcuts, drag, beatmatching
  bridge/         MCP bridge for external agents
  utils/          Logger, skin loader, watermark
  types/          Shared TypeScript interfaces
mixi-core/        Rust DSP engine (Wasm) — EQ, FX, limiter, analysis
mixi-native/      Rust N-API addon — cpal audio output (Electron)
electron/         Electron main/preload, WAV header, native audio IPC
tests/            Unit tests (vitest) + E2E (Playwright)
```

**Design constraints:**

- React never touches AudioContext directly. A one-way bridge (`useMixiSync`) subscribes to Zustand state changes and pushes them to the audio engine via `setTargetAtTime`.
- High-frequency visuals (VU meters, vectorscopes, waveforms) write to Canvas or DOM refs, bypassing React reconciliation entirely.
- The automixer is stateless by design. It reads a Blackboard snapshot every 50ms and emits deterministic corrections. No FSM, no accumulated state, no drift.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19, TypeScript (strict), vanilla CSS + CSS custom properties |
| State | Zustand 5 with transient selectors |
| Audio | Web Audio API — hand-wired graph, no wrappers |
| DSP | Rust/Wasm (mixi-core) — AudioWorklet, SharedArrayBuffer, zero-alloc |
| GPU | WebGPU (WGSL shaders), Canvas 2D fallback |
| Native I/O | cpal via N-API addon (Electron), CoreAudio/WASAPI/ALSA |
| Bundler | Vite 6 |
| Desktop | Electron 41 |
| Backend | FastAPI + MCP server (Python, optional) |
| Tests | Vitest (555), Playwright (7 E2E), cargo test (196 Rust) — 758 total |
| Docs | VitePress, 24 languages |

---

## Scripts Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server + API sidecar + MCP server |
| `npm run dev:ui` | Vite dev server only |
| `npm run build` | TypeScript check + Vite production build |
| `npm run preview` | Serve production build locally |
| `npm run dev:api` | FastAPI sidecar on port 8000 |
| `npm run dev:mcp` | MCP bridge server |
| `npm run dev:electron` | Electron + Vite in dev mode |
| `npm run dist` | Package desktop app for current OS |
| `npm run docs:dev` | VitePress dev server |
| `npm run docs:build` | Build documentation site |
| `npm test` | Run unit tests (Vitest, 555 tests) |
| `npm run test:watch` | Watch mode for tests |
| `npm run test:coverage` | Test coverage report |
| `npm run test:e2e` | Playwright E2E tests (7 tests: smoke + sync) |
| `cd mixi-core && cargo test` | Rust DSP tests (203 tests) |

---

## Contributing

Contributions are welcome. Please sign the [CLA](CLA.md) on your first pull request — enforced automatically via GitHub Actions.

---

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)

Free for personal use, education, research, hobby projects, and non-commercial performance. The license explicitly permits underground gigs, academic work, and private experimentation.

Commercial use requires a separate license. Contact: fabrizio.salmi@gmail.com

---

## Acknowledgements

- **[js303](https://github.com/thedjinn/js303)** by thedjinn — the original Web Audio TB-303 emulation that inspired the TurboBass deck. Awesome bass.

---

Built by [Fabrizio Salmi](https://github.com/fabriziosalmi)
