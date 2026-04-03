# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/fabriziosalmi/mixi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fabriziosalmi/mixi/releases/tag/v0.1.0
