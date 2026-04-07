# Getting Started

## System Requirements

| Requirement | Minimum |
|---|---|
| **Browser** | Chrome 90+, Edge 90+, Firefox 100+, Safari 16+ |
| **Audio** | Any audio output device |
| **Screen** | 1024×768 minimum (optimized for 1440×900+) |
| **Memory** | 200 MB buffer limit per session |
| **CPU** | Dual-core (quad-core recommended for Wasm DSP) |

MIXI runs entirely in the browser — no installation required for the web version. Desktop builds (Electron) are available for macOS (ARM64 + Intel), Windows, and Linux.

## First Launch

When you open MIXI, a splash screen shows a spinning vinyl record animation (~1.3 seconds). Click anywhere, or press **Enter** or **Space** to skip directly to the main interface.

::: tip
Pressing Enter or Space during the spin animation skips it immediately.
:::

## Interface Overview

The interface is a 3-column grid:

```
┌─────────────────────┬───────────────────┬─────────────────────┐
│      HUD Left       │    HUD Center     │     HUD Right       │  Topbar (48px)
├─────────────────────┼───────────────────┼─────────────────────┤
│   Status Text       │  Symmetric VU     │   Notifications     │  Status Bar (18px)
├─────────────────────┼───────────────────┼─────────────────────┤
│                     │                   │                     │
│      Deck A         │      Mixer        │      Deck B         │
│                     │                   │                     │
└─────────────────────┴───────────────────┴─────────────────────┘
```

**Topbar** — Three HUD panels:
- **HUD Left**: Limiter indicator, master volume/filter/distortion/punch knobs, AI toggle
- **HUD Center**: Deck A telemetry, quantize toggle, master BPM, CPU%, audio out status, MIDI clock, Deck B telemetry
- **HUD Right**: Recording controls, track browser, skin selector, VFX toggle, panic reset, settings

**Status Bar** — Real-time feedback ticker with symmetric L/R master VU meter in the center section.

**Main Area** — Deck A (cyan) on the left, mixer column in the center, Deck B (orange) on the right.

## Loading a Track

Three ways to load audio:

### Drag & Drop
Drag an audio file onto a deck's drop zone. Supported formats: **WAV**, **MP3**, **FLAC**, **OGG**, **AAC/M4A**, **AIFF**. Maximum file size: **200 MB**.

::: warning
AIFF-C (compressed AIFF) is not supported in most browsers.
:::

### File Browser
Click **browse** in the deck drop zone to open a file picker. The input accepts any `audio/*` MIME type.

### SoundCloud URL
Paste a SoundCloud track URL into the URL field and click **LOAD**. The URL is fetched via a proxy API with a 60-second timeout. Track title is read from the `X-Track-Title` response header.

::: tip
Press **Cmd+V** (Mac) or **Ctrl+V** (Windows) anywhere to auto-paste a URL into the field — it will auto-submit after 50ms.
:::

## Analysis Pipeline

After loading, MIXI automatically analyzes the track:

1. **Decoding audio** — Browser decodes the file to PCM
2. **Analyzing waveform** — Generates visual waveform data (serialized to avoid concurrent OfflineAudioContext limits)
3. **Detecting BPM & key** — 7-estimator BPM detection via [open-bpm](https://github.com/fabriziosalmi/open-bpm) (IOI, Comb, AC, Spectral FFT, Hopf, Tempogram, Low-band AC), Goertzel chromagram for musical key
4. **Setting cue point** — Auto-seeks to the first energetic downbeat

**Auto-gain**: Track trim is normalized so peaks reach 0 dBFS, clamped to range [0.5×, 2.0×].

## Your First Mix

1. **Load tracks** on both decks (drag & drop or browse)
2. **Press Play** on Deck A (click the play button or press **Space**)
3. **Press Play** on Deck B (press **Shift+B**)
4. **Sync** Deck B to Deck A's tempo (press **Shift+S** or click the sync button)
5. **Use the crossfader** to blend between decks
6. **Tweak EQ** — use the mixer's HI/MID/LOW knobs to shape each deck's tone

## Deck Modes

Each deck slot can run in one of four modes:

| Mode | Label | Color | Description |
|---|---|---|---|
| Track | — | Deck color | Standard audio player with waveform, transport, FX |
| Groovebox | GROOVEBOX | Purple | 4-voice drum machine (kick/snare/hat/perc) |
| TurboKick | TURBOKICK | Red | Kick drum synthesizer with 16-step sequencer |
| TurboBass | TURBOBASS | Green | Acid synth with diode ladder filter |

To switch mode: eject the current track, then click a module button in the deck loader.

::: info
A module can only be loaded on one deck at a time. If TurboBass is active on Deck A, Deck B shows it as "Active on A".
:::

## Eject Safety

When a deck is **live** (playing AND volume > 5%), eject requires a **double-click** within 2 seconds. The first click shows a pulsing red warning. If the deck is stopped or silent, a single click ejects immediately.

## Keyboard Shortcuts

### Transport

| Key | Action |
|---|---|
| **Space** | Play/pause Deck A |
| **Shift+A** | Play/pause Deck A |
| **Shift+B** | Play/pause Deck B |
| **S** | Toggle sync Deck A |
| **Shift+S** | Toggle sync Deck B |
| **Q** | Toggle quantize Deck A |
| **Shift+Q** | Toggle quantize Deck B |

### Pitch & Nudge

| Key | Action |
|---|---|
| **↑** | Nudge Deck A pitch +4% |
| **↓** | Nudge Deck A pitch -4% |
| **Ctrl/Cmd+↑** | Fine nudge Deck A +1% |
| **Ctrl/Cmd+↓** | Fine nudge Deck A -1% |
| **Shift+↑/↓** | Nudge Deck B (same amounts) |

::: tip
Nudge is **hold-to-apply** — the pitch adjusts while the key is held, and returns to normal on release.
:::

### Navigation

| Key | Action |
|---|---|
| **←** | Beat jump Deck A -1 beat |
| **→** | Beat jump Deck A +1 beat |
| **Shift+←** | Beat jump Deck A -4 beats (1 bar) |
| **Shift+→** | Beat jump Deck A +4 beats (1 bar) |
| **[** | Shift beatgrid Deck A -1 beat |
| **]** | Shift beatgrid Deck A +1 beat |
| **Shift+[** / **Shift+]** | Shift beatgrid Deck B |

### Hot Cues

| Key | Action |
|---|---|
| **1–8** | Hot cues Deck A (set if empty, trigger if set) |
| **Shift+1–8** | Hot cues Deck B |

### Performance

| Key | Action |
|---|---|
| **X** | Toggle slip mode Deck A |
| **Shift+X** | Toggle slip mode Deck B |
| **V** | Vinyl brake Deck A |
| **Shift+V** | Vinyl brake Deck B |
| **T** | Tap tempo (averages last 8 taps, resets after 2s gap, range 30–300 BPM) |
| **D** | Align drops (seeks Deck B so drop points coincide) |
| **O** | Toggle phase overlay (ghost deck anaglyph) |

### Global

| Key | Action |
|---|---|
| **Escape** | Panic reset — flatten EQ, kill FX, exit loops, reset crossfader, disable VFX |
| **Tab** | Toggle track browser |

::: warning
All keyboard shortcuts are disabled when focus is in a text input field.
:::

## Demo Tracks

If enabled in Settings, MIXI auto-loads two demo tracks at startup (`v0.1.0.mp3` on Deck A, `v0.1.1.mp3` on Deck B) so you can start mixing immediately.

## BPM Display

BPM values are color-coded by detection confidence:
- **White**: ≥60% confidence (reliable)
- **Yellow**: 30–60% confidence (approximate)
- **Orange**: <30% confidence (unreliable — consider manual entry)

Double-click the BPM value to edit it manually. Use the **/2** and **×2** buttons to halve or double the BPM (valid range: 30–300).

## Per-Deck FX

Each deck has 7 effect slots in a vertical strip:

| Slot | Effect | Type |
|---|---|---|
| DLY | Delay | Time-based |
| REV | Reverb | Space |
| PHA | Phaser | Modulation |
| FLG | Flanger | Modulation |
| GATE | Gate | Rhythm (snaps to 1/32, 1/16, 1/8, 1/4, 1/2) |
| CRU | Bitcrusher | Distortion |
| ECH | Echo | Time-based |

Each effect has an on/off toggle and a dry/wet knob.

## What's Next

- [Architecture Overview](/guide/architecture) — Signal chain, audio nodes, state management
- [Mixer & EQ](/guide/mixer) — Channel strip, crossfader, headphone cue
- [TurboBass Acid Synth](/guide/turbobass) — Diode ladder filter, sequencer, pattern system
