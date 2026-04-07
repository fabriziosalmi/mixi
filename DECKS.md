# MIXI Decks — Architecture and Development Guide

## Overview

MIXI uses a pluggable deck system. Each deck slot (A or B) can load either the standard Track player or a custom instrument module (Groovebox, TurboKick, TurboBass, or community-built decks).

Custom decks live in a separate open-source repository under the MIT license:

- **Custom decks repo**: [github.com/fabriziosalmi/mixi-decks](https://github.com/fabriziosalmi/mixi-decks) (MIT)
- **Main MIXI repo**: [github.com/fabriziosalmi/mixi](https://github.com/fabriziosalmi/mixi) (PolyForm NC)

The standard Track deck and the deck loading infrastructure remain in the main repo.

---

## Deck Types

| Deck | Mode Key | Location | License | Status |
|------|----------|----------|---------|--------|
| **Track** | `track` | `mixi/src/components/deck/` | PolyForm NC | Core (stays in main repo) |
| **Groovebox** | `groovebox` | `mixi/src/groovebox/` | PolyForm NC | Bundled (migrating to mixi-decks) |
| **TurboKick** | `turbokick` | `mixi/src/decks/turbokick/` | PolyForm NC | Bundled (migrating to mixi-decks) |
| **TurboBass** | `js303` | `mixi/src/decks/turbobass/` | PolyForm NC | Bundled (migrating to mixi-decks) |
| **Community** | user-defined | `mixi-decks/decks/` | MIT | Open for contributions |

The Groovebox, TurboKick, and TurboBass decks are currently bundled in the main repo but will be migrated to `mixi-decks` once the SDK interface is finalized.

---

## Architecture

### How Decks Are Loaded

```
App.tsx → DeckSlot
  ├── mode === 'track'     → DeckSection (standard player)
  └── mode === house deck  → lazy(() => import(deckComponent))
```

All custom decks are registered in `src/decks/index.ts`:

```typescript
export const HOUSE_DECKS: HouseDeckEntry[] = [
  { mode: 'groovebox', label: 'GROOVEBOX', accentColor: '#a855f7', component: lazy(() => import(...)) },
  { mode: 'turbokick', label: 'TURBOKICK', accentColor: '#ef4444', component: lazy(() => import(...)) },
  { mode: 'js303',     label: 'TURBOBASS', accentColor: '#00ff88', component: lazy(() => import(...)) },
];
```

The registry is consumed by:
- `App.tsx` — renders the active deck via `DeckSlot` with `Suspense`
- `TrackLoader.tsx` — shows the module picker when the user loads a deck slot

### Component Interface

Every deck component receives `HouseDeckProps`:

```typescript
export interface HouseDeckProps {
  deckId: DeckId;              // 'A' or 'B'
  color: string;               // Hex accent color
  onSwitchToTrack: () => void; // Callback to eject and return to Track mode
}
```

### Audio Lifecycle

Every deck engine follows the same pattern:

```
constructor(deckId)  → stores deck ID
init()               → MixiEngine.getInstance() → AudioContext + DeckChannel
                     → create synth + bus nodes
                     → bus.output.connect(channel.input)
destroy()            → stop playback, disconnect all nodes
```

The deck connects to the mixer chain via `DeckChannel.input`. From there, the main mixer handles EQ, fader, crossfader, and master bus routing. The deck does not route to `audioContext.destination` directly.

### Dependencies

Each deck imports from the main MIXI app:

| Dependency | TurboKick | TurboBass | Groovebox | Source |
|------------|:---------:|:---------:|:---------:|--------|
| `MixiEngine` | x | x | x | `src/audio/MixiEngine.ts` |
| `useMixiStore` | x | x | x | `src/store/mixiStore.ts` |
| `DeckId` type | x | x | x | `src/types/audio.ts` |
| `HouseDeckProps` | x | x | x | `src/decks/index.ts` |
| `Knob` component | x | x | x | `src/components/controls/Knob.tsx` |
| `Fader` component | | | x | `src/components/controls/Fader.tsx` |
| `SampleManager` | | | x | `src/audio/SampleManager.ts` |

---

## Building a Custom Deck

Custom decks are developed in the [mixi-decks](https://github.com/fabriziosalmi/mixi-decks) repository.

### Repo Structure

```
mixi-decks/
  decks/
    your-deck/
      index.ts            ← exports the React component
      YourDeck.tsx         ← UI (receives HouseDeckProps)
      YourEngine.ts        ← audio scheduling + sequencer logic
      YourBus.ts           ← WebAudio node chain
      types.ts             ← TypeScript types and defaults
      deck.json            ← metadata
      README.md            ← documentation
  shared/
    Knob.tsx              ← shared UI components
    Fader.tsx
  sdk/
    index.ts              ← HouseDeckProps, DeckId, SDK interfaces
  LICENSE                 ← MIT
```

### deck.json Metadata

Each deck must include a `deck.json` file:

```json
{
  "id": "my-synth",
  "name": "My Synth",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "A custom synthesizer deck",
  "mode": "my-synth",
  "label": "MY SYNTH",
  "accentColor": "#ff6600",
  "entry": "./index.ts",
  "minMixiVersion": "0.2.9",
  "license": "MIT",
  "tags": ["synth", "instrument"]
}
```

### Step-by-Step

1. **Fork** [mixi-decks](https://github.com/fabriziosalmi/mixi-decks)
2. **Create** a directory under `decks/` with your deck name
3. **Implement** your deck component (must accept `HouseDeckProps`)
4. **Route audio** through `DeckChannel.input` — never directly to `destination`
5. **Use CSS variables** from `skin.css` so your deck respects all 17 MIXI skins
6. **Add** `deck.json` with metadata
7. **Submit** a pull request to `mixi-decks`

### Rules

- Route all audio output to `DeckChannel.input` via the bus pattern
- Use CSS custom properties (not hardcoded colors) for skin compatibility
- Do not import MIXI internals beyond the SDK interface
- Document memory footprint, especially WebGL canvas or audio scheduling loops
- Include at least one screenshot in your deck README

---

## Migration Plan

The migration from bundled decks to the external repo follows these phases:

1. **SDK extraction**: Create a narrow typed interface (`DeckAudioHost`, `DeckStoreHost`) that decks depend on instead of importing `MixiEngine` and `useMixiStore` directly
2. **Refactor imports**: Update Groovebox, TurboKick, and TurboBass to use the SDK interface
3. **Move to mixi-decks**: Copy deck directories, shared components, and SDK types
4. **Dynamic loading**: Replace the hardcoded `HOUSE_DECKS` array with a loader that reads from a git submodule or npm package

Full migration details, checklist, and risk analysis are in [DECKS_MARKETPLACE.md](DECKS_MARKETPLACE.md).

---

## Existing Deck Reference

### Track (Standard Player)
The default deck mode. Loads audio files, provides transport controls (play, pause, cue), waveform display, hot cues, loops, pitch/tempo adjustment. Core product, stays in the main repo permanently.

### Groovebox
4-voice drum machine (kick, snare, hi-hat, perc) with 16-step sequencer, per-voice drum synthesis, mute/solo, pan, independent bus. Synced to master BPM.

### TurboKick
Kick drum synthesizer with 16-step sequencer. Pitch/decay/click/drive synthesis, THUMP macro, dual valve distortion (tube + punch), filter + LFO, Berghain-style RUMBLE (dark reverb + sidechain pump).

### TurboBass
Acid synth v3 (inspired by [js303](https://github.com/thedjinn/js303)), rewritten with circuit-level DSP modeling.

**Filter**: 4-pole diode ladder via AudioWorklet. Mismatched first pole (0.5x capacitance), per-sample tanh saturation, 2x oversampling, TPT zero-delay feedback. VT=0.4 (derived from geometric mean of pole signal levels), k_max=3.07 (Barkhausen criterion at 97%), resonance compensation sqrt(1+k), quadratic resonance curve.

**Oscillator**: Sawtooth + variable duty-cycle pulse wave (derived from Fourier series, pitch-dependent 71%-45%). Sub-oscillator (sine, -1 octave). Analog drift LFO.

**Envelope**: Bipolar filter envelope (spike -> undershoot 85% -> recovery). Octave-based env mod sweep (cutoff * 2^(envMod*7)). Exponential decay mapping (20ms-2s).

**Accent**: Three-way interaction — filter depth boost sqrt(1+res*3), decay snap (20ms+10%), independent VCA boost. Resonance controls accent depth.

**Controls**: Gate length (10%-100%), slide time (5ms-300ms exponential RC), filter tracking (logarithmic, Devil Fish mod), TIE (legato), copy/paste pattern.

**FX**: Pre-filter HP (44Hz), drive (tanh saturation), Rat-style asymmetric distortion, BPM-synced delay with HP feedback, ducking spring reverb (synthetic IR), chorus, auto-pan, BPM-synced filter LFO.

**Sequencer**: 32 factory patterns (4 banks x 8), 16/32 steps, accent/slide/tie/octave per step, scale-aware randomizer, pattern mutate/shift, ghost sequence. ACID macro.

**UI**: Two-row knob layout (SYNTH | CONTROL | ACID + WAVE | TONE | EFFECTS). Filter visualizer, VFD display.

---

*For the AI-oriented deck creation guide, see [CREATE_DECKS_AI.md](CREATE_DECKS_AI.md).*
*For migration planning details, see [DECKS_MARKETPLACE.md](DECKS_MARKETPLACE.md).*
