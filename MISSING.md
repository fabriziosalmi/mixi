# MIXI -- Feature Gap Analysis & Competitor Matrix

> Updated after v0.2.9 session -- April 2026

---

## Feature Matrix: mixi vs Competitors

Legend: **Y** = implemented, **P** = partial, **-** = missing

| Feature | mixi | Traktor 4 | rekordbox 7 | Serato 3 | VirtualDJ 2026 | djay Pro 5 | Mixxx 2.5 |
|---------|------|-----------|-------------|----------|----------------|------------|-----------|
| **DECKS & PLAYBACK** | | | | | | | |
| 2-deck mixing | Y | Y | Y | Y | Y | Y | Y |
| 4-deck mixing | - | Y | Y | Y | Y | Y | Y |
| Beat detection (BPM) | Y | Y | Y | Y | Y | Y | Y |
| Beatgrid editing | - | Y | Y | Y | Y | Y | Y |
| Elastic/dynamic beatgrids | - | Y | - | - | Y | Y | - |
| Key detection (Camelot) | Y | Y | Y | Y | Y | Y | Y |
| Key lock (pitch-independent tempo) | Y | Y | Y | Y | Y | Y | Y |
| Hot cues (8 slots) | Y | Y | Y | Y | Y | Y | Y |
| Auto loops (beat-quantized) | Y | Y | Y | Y | Y | Y | Y |
| Slip mode | **Y** | Y | Y | Y | Y | Y | - |
| Beat jump | **Y** | Y | Y | Y | Y | Y | Y |
| Loop roll / slicer | **Y** | Y | Y | Y | Y | Y | Y |
| Vinyl brake effect | **Y** | Y | - | Y | Y | - | Y |
| Scratch emulation | - | Y | - | Y | Y | - | Y |
| Waveform display (RGB) | Y | Y | Y | Y | Y | Y | Y |
| Waveform overview | Y | Y | Y | Y | Y | Y | Y |
| Drop detection | Y | - | - | - | - | - | - |
| Jog wheel (visual) | Y | Y | Y | Y | Y | Y | Y |
| Jog wheel (velocity/scratch) | - | Y | Y | Y | Y | Y | Y |
| Click-to-seek on waveform | **Y** | Y | Y | Y | Y | Y | Y |
| **MIXER** | | | | | | | |
| 3-band EQ | Y | Y | Y | Y | Y | Y | Y |
| EQ isolator (full kill) | Y | Y | Y | Y | Y | Y | Y |
| Multiple EQ models | **Y (3)** | Y (6) | Y (3) | Y (2) | Y (4) | - | Y (3) |
| Master EQ (3-band) | **Y** | Y | Y | Y | Y | - | Y |
| Channel gain/trim | Y | Y | Y | Y | Y | Y | Y |
| Auto-gain on load | Y | Y | Y | Y | Y | Y | Y |
| Crossfader (smooth/sharp) | Y | Y | Y | Y | Y | Y | Y |
| Crossfader curve selector | Y | Y | Y | Y | Y | Y | Y |
| Headphone PFL/CUE | Y | Y | Y | Y | Y | Y | Y |
| Headphone split mode | Y | Y | Y | Y | Y | Y | Y |
| Master limiter | Y | Y | Y | Y | Y | Y | Y |
| Master filter (bipolar) | Y | Y | Y | Y | Y | Y | Y |
| Master distortion | Y | - | - | - | - | - | - |
| Master punch compressor | Y | - | - | - | - | - | - |
| VU metering (per-channel + master) | Y | Y | Y | Y | Y | Y | Y |
| Master EQ (3-band) | **Y** | Y | Y | Y | Y | - | Y |
| FX send/return buses | - | Y | Y | Y | Y | - | Y |
| **EFFECTS** | | | | | | | |
| Filter (bipolar LPF/HPF) | Y | Y | Y | Y | Y | Y | Y |
| Delay (tempo-synced) | Y | Y | Y | Y | Y | Y | Y |
| Reverb | Y | Y | Y | Y | Y | Y | Y |
| Phaser | Y | Y | Y | Y | Y | Y | Y |
| Flanger | Y | Y | Y | Y | Y | Y | Y |
| Gate (beat-locked) | Y | Y | Y | Y | Y | - | Y |
| Color FX per channel | Y | - | Y | - | Y | - | - |
| FX chaining (serial) | - | Y | Y | Y | Y | - | Y |
| FX beat-sync | P | Y | Y | Y | Y | Y | Y |
| Macro FX (one-knob) | P | Y | Y | - | Y | Y | - |
| Total built-in FX | 6 | 40+ | 20+ | 50+ | 122+ | 30+ | 20+ |
| **AI & AUTOMATION** | | | | | | | |
| AI auto-mix engine | Y | - | - | - | P | Y | - |
| AI intent system (20 intents) | Y | - | - | - | - | - | - |
| Utility AI arbiter (multi-intent) | Y | - | - | - | - | - | - |
| Phase drift correction | Y | - | - | - | - | - | - |
| Key clash defense | Y | - | - | - | - | - | - |
| Drop alignment | Y | - | - | - | - | - | - |
| EQ amnesia (auto-reset) | Y | - | - | - | - | - | - |
| Red-line limiter intent | Y | - | - | - | - | - | - |
| Vocal space carving | Y | - | - | - | - | - | - |
| AI track suggestions | - | - | Y | - | Y | Y | - |
| AI-generated transitions | - | - | - | - | Y | Y | - |
| **STEM SEPARATION** | | | | | | | |
| Real-time stem separation | - | Y (4) | Y (4) | Y (4) | Y (5+) | Y (4) | P |
| Stem mute/solo per deck | - | Y | Y | Y | Y | Y | P |
| Stem FX (per-stem effects) | - | Y | Y | Y | Y | Y | - |
| Stem swap between tracks | - | - | - | - | Y | - | - |
| **SYNTH MODULES** | | | | | | | |
| Drum machine (groovebox) | Y | - | - | - | - | - | - |
| Kick synthesizer (TurboKick) | Y | - | - | - | - | - | - |
| Bass synth (JS303) | Y | - | - | - | - | - | - |
| House deck registry (plug-and-play) | Y | - | - | - | - | - | - |
| Remix decks / sample grid | - | Y | Y | - | Y | - | Y |
| Pattern player | - | Y | - | - | - | - | - |
| **LIBRARY & BROWSING** | | | | | | | |
| Track browser (sortable table) | Y | Y | Y | Y | Y | Y | Y |
| Full-text search | Y | Y | Y | Y | Y | Y | Y |
| Drag & drop file loading | Y | Y | Y | Y | Y | Y | Y |
| URL import (SoundCloud/YouTube) | Y | - | - | - | - | - | - |
| Playlists / crates | **Y** | Y | Y | Y | Y | Y | Y |
| Smart playlists (auto-filter) | - | Y | Y | Y | Y | - | Y |
| Track rating / tags | **Y** | Y | Y | Y | Y | - | Y |
| Cloud library sync | - | - | Y | Y | - | Y | - |
| iTunes/Music.app integration | - | Y | Y | Y | Y | Y | Y |
| Related tracks suggestion | - | - | Y | - | Y | Y | - |
| BPM/key batch analysis | **Y** | Y | Y | Y | Y | Y | Y |
| **STREAMING SERVICES** | | | | | | | |
| SoundCloud | Y | - | Y | Y | Y | Y | - |
| YouTube (via yt-dlp) | Y | - | - | - | - | - | - |
| Tidal | - | - | Y | Y | Y | Y | - |
| Beatport / Beatsource | - | Y | Y | Y | Y | Y | - |
| Spotify | - | - | P | Y | - | Y | - |
| Apple Music | - | - | - | Y | - | Y | - |
| **RECORDING & OUTPUT** | | | | | | | |
| Set recording (WAV) | Y | Y | Y | Y | Y | Y | Y |
| Crash-proof recording | Y | - | - | - | - | - | - |
| Live broadcasting (Shoutcast) | - | - | Y | - | Y | - | Y |
| Session save/load | **Y** | Y | Y | Y | Y | Y | Y |
| Automation recording | - | Y | - | - | Y | - | - |
| **MIDI & HARDWARE** | | | | | | | |
| WebMIDI support | Y | N/A | N/A | N/A | N/A | N/A | N/A |
| MIDI learn mode | Y | Y | Y | Y | Y | Y | Y |
| MIDI clock output | Y | Y | Y | Y | Y | - | Y |
| Ableton Link | - | Y | Y | - | Y | Y | Y |
| DVS (timecode vinyl) | - | Y | Y | Y | Y | - | Y |
| HID controller support | - | Y | Y | Y | Y | - | Y |
| Controller presets | **Y (45)** | Y | Y | Y | Y | Y | Y |
| **VISUAL & UI** | | | | | | | |
| Skins / themes | Y (16+) | Y (3) | Y (2) | Y (2) | Y (100+) | Y (3) | Y (4) |
| Custom skin import | Y | - | - | - | Y | - | Y |
| WebGPU VFX (audio-reactive) | Y | - | - | - | - | - | - |
| Video mixing | - | - | - | - | Y | Y | - |
| Wasm DSP (optional) | Y | N/A | N/A | N/A | N/A | N/A | N/A |
| **PLATFORM** | | | | | | | |
| Web browser | Y | - | - | - | - | - | - |
| macOS | Y | Y | Y | Y | Y | Y | Y |
| Windows | Y | Y | Y | Y | Y | Y | Y |
| Linux | Y | - | - | - | Y | - | Y |
| iOS / Android | - | - | Y | - | - | Y | - |
| VR (Vision Pro / Quest) | - | - | - | - | - | Y | - |

---

## Completed in This Session

| # | Feature | Status |
|---|---------|--------|
| 3 | Slip mode | DONE |
| 4 | Beat jump (8 pads + keyboard) | DONE |
| 5 | Loop roll (momentary + slip) | DONE |
| 6 | Playlists / crates (sidebar + drag-to-add) | DONE |
| 7 | Click-to-seek on waveform | ALREADY EXISTED |
| 8 | Session save/load (named snapshots) | DONE |
| 14 | BPM/key batch analysis (Rust/Wasm, yielded queue) | DONE |
| 15 | Vinyl brake effect | DONE |
| 16 | Master EQ (3-band) | DONE |
| 19 | Controller presets (45 controllers) | DONE |
| 20 | Track rating (5 stars) + color tags (8 colors) | DONE |
| -- | Multiple EQ models (3: LR4, DJ Peak, Xone Kill) | DONE |

---

## Remaining Priority Gaps

### Tier 1 -- High Impact, Still Missing

| # | Feature | Effort | Impact | Notes |
|---|---------|--------|--------|-------|
| 1 | **Real-time stem separation** | High | Critical | The #1 feature in DJ software 2025-2026. Every paid competitor has it. Requires ML model (Demucs/HTDemucs) running in Wasm or WebWorker. |
| 2 | **4-deck mode** | Medium | High | All competitors support 4 decks. mixi is hardcoded to DeckId = 'A' \| 'B'. |
| 9 | **Beatgrid editing** | Medium | Medium | Manual grid adjustment when auto-detection is wrong. |
| 10 | **FX chaining** | Medium | Medium | Serial FX chain (e.g., filter -> delay -> reverb). Currently parallel sends only. |

### Tier 2 -- Differentiators

| # | Feature | Effort | Impact | Notes |
|---|---------|--------|--------|-------|
| 11 | **Ableton Link** | Medium | High | Would make mixi the first web DJ app with Link support. |
| 12 | **More built-in FX** | Medium | Medium | 6 FX vs 40-122 in competitors. Priority: bitcrusher, echo, noise sweep, tape stop. |
| 13 | **Streaming APIs** (Tidal, Beatport) | High | High | Direct integration without yt-dlp backend. |
| 17 | **Remix decks / sample pads** | Medium | Medium | Generic sampler deck (different from groovebox). |
| 18 | **Smart playlists** | Medium | Medium | Auto-filter by BPM range, key, energy, genre. |

---

## mixi Exclusive Features (Not in Any Competitor)

| Feature | Description |
|---------|-------------|
| **AI Intent System (20 intents)** | Utility AI with simultaneous multi-intent evaluation. No other DJ software has this architecture. |
| **Drop Detection** | Automatic identification of drop points in tracks with energy scoring. |
| **Procedural Synth Decks** | TurboKick (kick synth with RUMBLE/THUMP/ENGAGE), JS303 (acid bass), Groovebox -- built-in instruments, not just sample players. |
| **House Deck Registry** | Plug-and-play module architecture for adding new instruments. |
| **RUMBLE Engine** | One-knob Berghain-style sidechain reverb. |
| **Master Punch Compressor** | Parallel compression on master bus. |
| **Master Distortion** | Band-split distortion protecting sub-bass. |
| **WebGPU VFX** | Audio-reactive GPU shaders with stem-aware visuals. |
| **Crash-proof Recording** | SharedArrayBuffer ring buffer with orphan recovery. |
| **Web-native Architecture** | Only serious DJ software that runs entirely in the browser. |
| **16+ Custom Skins** | More skin variety than any competitor except VirtualDJ. |
| **URL Import** | Direct SoundCloud/YouTube loading without account or API key. |
| **45 MIDI Controller Presets** | Largest preset library for a web-based DJ app. |
| **3 EQ Models (hot-swappable)** | LR4 Isolator, DJ Peak, Xone Kill -- switchable at runtime. |
| **Batch Analysis (Rust/Wasm)** | Analyze entire library BPM+key in background, 10-30ms per track via Wasm. |
| **Session Snapshots** | Named mixer state snapshots with full restore (master, EQ, FX, decks). |

---

## Recommended Roadmap (Updated)

### v0.3.0 -- "Performance Release" (DONE)
- ~~Slip mode~~ DONE
- ~~Beat jump~~ DONE
- ~~Loop roll~~ DONE
- ~~Click-to-seek on waveform~~ ALREADY EXISTED
- ~~Vinyl brake effect~~ DONE
- ~~Multiple EQ models~~ DONE
- ~~Master EQ~~ DONE
- ~~45 MIDI controller presets~~ DONE

### v0.4.0 -- "Library Release" (DONE)
- ~~Playlists / crates~~ DONE
- ~~Track rating & color tags~~ DONE
- ~~BPM/key batch analysis~~ DONE
- ~~Session save/load~~ DONE
- Smart playlists (BPM/key/energy filters) — deferred to v0.6.0
- Beatgrid manual editing — deferred to v0.6.0

### v0.5.0 -- "Stems Release"
- Real-time stem separation (Demucs via Wasm or WebWorker)
- Stem mute/solo per deck
- Stem FX routing
- 4-deck mode

### v0.6.0 -- "Connect Release"
- Ableton Link
- Tidal / Beatport streaming
- FX chaining (serial mode)
- More built-in FX (bitcrusher, echo, noise sweep, tape stop)

---

*Generated from codebase audit and competitor analysis (April 2026)*
