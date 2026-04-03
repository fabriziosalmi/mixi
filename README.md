<p align="center">
  <img src="screenshot.png" alt="MIXI — Browser-native DJ workstation" width="100%" />
</p>

<h1 align="center"><a href="https://www.mixidaw.com/app/">MIXI</a></h1>

<p align="center">
  Deterministic audio workstation. Browser-native. Zero install.<br>
  Dual decks, groovebox, automixer, 17 skins, MIDI, headphone cue — all Web Audio API.
</p>

<p align="center">
  <a href="https://github.com/fabriziosalmi/mixi/actions/workflows/docs.yml"><img src="https://github.com/fabriziosalmi/mixi/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-blue" alt="License"></a>
</p>

---

## What This Is

MIXI is a dual-deck DJ engine and step sequencer that runs entirely inside a web browser. Every DSP node — EQ, compression, limiting, effects — is built directly on the Web Audio API with deterministic scheduling. No Tone.js. No third-party audio wrappers. No server required.

Load two tracks. Mix them. The groovebox runs in parallel on its own bus. The automixer watches phase, spectrum, and headroom on a 50ms tick and applies corrections as visible, non-destructive mutations. Plug in a MIDI controller and it maps to anything. Pick one of 17 skins or write your own in pure CSS.

It ships as a static site. It also packages as an Electron desktop app for macOS, Windows, and Linux. An optional Python sidecar handles heavier analysis offline.

---

## Signal Chain

```
Deck A/B:
  BufferSource -> Trim -> 3-Band Kill-EQ -> ColorFX -> DeckFX [FLT|DLY|REV|PHA|FLG|GATE]
    ├── Fader -> Crossfader -> MasterBus
    └── CueGain -> HeadphoneBus

MasterBus:
  Gain -> MasterFilter -> BandSplit (300Hz crossover)
    ├── Sub (<300Hz) -> Mono Sum (phase-safe for PA)
    └── High (>300Hz) -> Oversampled tanh Waveshaper
  -> Parallel Compressor -> Headroom Pad (-0.3dB) -> Brickwall Limiter -> destination

HeadphoneBus:
  CueSum + MasterTap -> Mix knob -> Level -> destination

Split mode:
  Master -> Right channel | Headphones -> Left channel
```

EQ is modeled on analog kill mixers: Lowshelf at 250Hz, Peaking at 1kHz (Q=1), Highshelf at 4kHz. Range from -32dB kill to +6dB boost. All parameter changes are scheduled via `setTargetAtTime` with a 12ms smoothing constant — no zipper noise, no clicks.

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
| **Dual Decks** | Independent transport, pitch/tempo, hot cues, loops, scratch emulation. Timeline-scheduled via AudioContext. |
| **3-Band Kill-EQ** | Analog-modeled lowshelf/peaking/highshelf. Full kill at -32dB. |
| **Deck Effects** | Filter, Delay, Reverb, Phaser, Flanger, Gate. BPM-synced where applicable. |
| **Master DSP** | Band-split distortion, parallel compression, brickwall limiter. Sub-bass mono sum. |
| **AutoMixer** | Stateless 50ms-tick arbiter. Reads a Blackboard of deck states. Applies Ghost Mutations — visible, auditable corrections for phase drift, spectral clash, headroom recovery. |
| **Groovebox** | 8-voice step sequencer with drum synthesis on a decoupled bus. Own panning, mute, solo. Synced to master BPM. |
| **BPM/Key Detection** | Autocorrelation + onset detection for BPM. Chromagram for key. Runs in-browser. |
| **MIDI** | WebMIDI API. Map any CC/note to any parameter — decks, mixer, groovebox, transport. |
| **Waveform** | Canvas-rendered waveform with zoom, scroll, and hot cue overlays. Direct DOM writes, no React reconciliation. |
| **Headphone Cue** | Split-stereo or dual-output routing. Mix knob blends cue and master. |
| **Recording** | Capture master output to WAV or WebM with embedded metadata. |
| **17 Skins** | Runtime-switchable. Pure CSS custom properties — zero JavaScript per skin. |

### Available Skins

Acid, Aqua, Arcade Invaders, Blackfluo, Bloodmoon, Casino, Dune, E-Ink, Freetekno, Gold, Hologram, Industrial, Matrix, Nordic, Synthwave, Vaporwave, White.

Each skin is a directory containing `skin.json` (metadata) and `skin.css` (CSS custom properties). To create a new skin, copy any existing one and modify the variables. No TypeScript changes required.

---

## Architecture

```
src/
  audio/        Core engine, DSP nodes, sample manager, BPM/key detection
  ai/           AutoMixEngine, Blackboard, Ghost Mutations, intents
  groovebox/    Step sequencer engine, drum synthesis, UI
  automixer/    AutoMixer panel, beat utilities
  midi/         WebMIDI manager, controller mapping
  components/   React UI — decks, mixer, browser, HUD, settings
  store/        Zustand stores — mixer state, settings, MIDI, samples
  hooks/        React hooks — sync bridge, keyboard shortcuts, drag
  bridge/       MCP bridge for external agents
  utils/        Logger, skin loader, watermark
  types/        Shared TypeScript interfaces
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
| Bundler | Vite |
| Desktop | Electron 41 |
| Backend | FastAPI + MCP server (Python, optional) |
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
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Watch mode for tests |
| `npm run test:coverage` | Test coverage report |

---

## Contributing

Contributions are welcome. Please sign the [CLA](CLA.md) on your first pull request — enforced automatically via GitHub Actions.

---

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)

Free for personal use, education, research, hobby projects, and non-commercial performance. The license explicitly permits underground gigs, academic work, and private experimentation.

Commercial use requires a separate license. Contact: fabrizio.salmi@gmail.com

---

Built by [Fabrizio Salmi](https://github.com/fabriziosalmi)
