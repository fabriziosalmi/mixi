# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-04-03

### Added

- **MIDI Presets**: Akai MIDI Mix factory CC preset (`src/midi/presets/akaiMidiMix.ts`)
- **MIDI Actions**: `MASTER_VOL`, `HEADPHONE_MIX`, `HEADPHONE_LEVEL` added to MidiManager
- **MIDI Settings Tab**: Full interactive parameter-by-parameter Learn UI in Settings
  - 24 mappable parameters organized by section (Deck A, Deck B, Master)
  - Per-parameter Learn button with visual feedback ("⏳ Move control…")
  - Per-parameter delete (✕) and global Clear All
  - Preset dropdown (Manual / Akai MIDI Mix)
- **MIDI Store**: `loadPreset()`, `exportMappings()`, `activePreset` tracking
- **Testing Suite**: 33 unit tests across 3 test files
  - `mixiStore.test.ts` — 16 assertions (crossfader, EQ, volume, gain, play guard, CUE, headphones)
  - `settingsStore.test.ts` — 8 assertions (EQ range, BPM, FPS, skin, quantize)
  - `midiStore.test.ts` — 9 assertions (CRUD, presets, export, learn state)
- **Dynamic Version**: `__APP_VERSION__` injected from `package.json` via Vite `define`
- **Type Declaration**: `src/vite-env.d.ts` for Vite client types

### Changed

- **Empty Deck Overlay**: Reduced from opaque black/blur to subtle frosted-glass (`bg-black/30 backdrop-blur-sm`, `opacity-60 blur-[2px]`)
- **Demo Track Loading**: Now loads every session (not one-shot); `loadDemoTrack` removed from localStorage persistence
- **WS Bridge Logging**: Only first connection attempt logged; subsequent reconnects silent until success
- **Settings Persistence**: Added explicit `merge` function to strip stale `loadDemoTrack` from localStorage
- **README**: Tech stack corrected (`Tailwind CSS` → `vanilla CSS + CSS custom properties`); test scripts added
- **DECKS.md**: Fixed API mismatches (`playing` → `isPlaying`, `rate` → `playbackRate`, `togglePlay()` → `setDeckPlaying()`)
- **Audio Decode Error**: Now includes browser's native error message and lists supported formats

### Fixed

- **Deck B Crash**: Removed forced `setDeckTrackLoaded('B', true)` at startup that caused `play()` on null buffer
- **Play Buttons Broken**: `loadDemoTrack` was permanently disabled after first boot via localStorage; now defaults to `true` on every session
- **AudioContext Double-Close**: Guard `ctx.state !== 'closed'` prevents crash in React StrictMode dev mode
- **Version String**: SettingsModal no longer shows hardcoded "v0.1.0"; reads from `package.json`
- **ArrayBuffer Consumed**: `decodeAudioData` now receives `arrayBuffer.slice(0)` to prevent consumption

### Removed

- **Tracked Build Artifacts**: `tsconfig.tsbuildinfo` removed from git tracking
- **Stale .gitignore**: Fixed malformed `API.md*.tsbuildinfo` line; added `api/dist/`, `api/build/`, `*.spec`

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
