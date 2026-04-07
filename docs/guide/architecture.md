# Architecture Overview

## Application Layout

MIXI uses a CSS Grid with 3 columns and 3 rows:

```
gridTemplateColumns: '1fr auto 1fr'
gridTemplateRows:    'auto auto 1fr'
```

| Row | Height | Content |
|-----|--------|---------|
| 1 | 48px (`h-12`) | Topbar — 3 HUD panels via CSS subgrid |
| 2 | 18px | Status bar — feedback ticker + symmetric VU |
| 3 | Remaining | Main — Deck A, Mixer, Deck B via subgrid |

The topbar and main content both use `gridTemplateColumns: subgrid` to share column tracks with the parent, ensuring pixel-perfect alignment between HUD panels and their corresponding deck/mixer columns.

## Audio Engine

### Singleton Pattern

`MixiEngine` is a singleton with private constructor:

```
MixiEngine.getInstance() → creates AudioContext(44100 Hz) on first call
```

The AudioContext runs at a fixed **44,100 Hz** sample rate.

### Top-Level Signal Flow

```
Deck A Source → DeckChannel A → XfaderGain A ──┐
                                                ├→ MasterBus → Output
Deck B Source → DeckChannel B → XfaderGain B ──┘

DeckChannel A → CueGain A ──┐
                              ├→ HeadphoneBus → Headphone Output
DeckChannel B → CueGain B ──┘
```

### Optional Wasm DSP Path

When `useWasmDsp` is enabled in Settings, audio routes through a Rust AudioWorklet (`mixi-dsp-processor`) that implements the full signal chain in WebAssembly, bypassing the WebAudio EQ/FX/MasterBus nodes.

- Parameter bus: 512-byte SharedArrayBuffer
- Metering bus: 28-byte SharedArrayBuffer for VU output

## Deck Channel

Each deck has a `DeckChannel` with this signal chain:

```
Source → Trim (GainNode, default 1.0)
       → EQ Model (selectable, see below)
       → Color FX (BiquadFilterNode)
       → DeckFx (effects chain)
       → Fader (GainNode)
       → Analyser (fftSize=256, smoothing=0.8)
       → XfaderGain (GainNode) → Master Bus

DeckFx output also taps to:
       → CueGain (GainNode, default 0) → Headphone Bus
```

CUE is a **pre-fader listen** — it taps the signal after effects but before the volume fader.

### EQ Models

Three selectable EQ models, hot-swappable at runtime:

#### LR4 Isolator (Default)

Linkwitz-Riley 24 dB/octave parallel isolator.

| Band | Topology | Crossover |
|------|----------|-----------|
| Low | 2× cascaded LP (Q=0.707 each) | **250 Hz** |
| Mid | 2× HP @ 250 Hz → 2× LP @ 4000 Hz | **250 Hz / 4000 Hz** |
| High | 2× cascaded HP (Q=0.707 each) | **4000 Hz** |

Kill switch: when gain ≤ range minimum, band gain is set to **0** (hard kill). Other bands are 100% unaffected — parallel topology guarantees zero interaction between bands.

#### DJ Peak (Pioneer DJM-style)

Serial shelving/peaking EQ — **no kill capability**.

| Band | Type | Frequency | Q |
|------|------|-----------|---|
| Low | Low shelf | **80 Hz** | — |
| Mid | Peaking | **1000 Hz** | 0.7 |
| High | High shelf | **12000 Hz** | — |

#### Xone Kill (Allen & Heath-style)

48 dB/octave full-kill isolator with slight resonance at crossover points.

| Band | Topology | Crossover | Order |
|------|----------|-----------|-------|
| Low | 4× cascaded LP (Q=1.0) | **200 Hz** | 8th order |
| Mid | 4× HP @ 200 Hz → 4× LP @ 2500 Hz | **200 / 2500 Hz** | 8th order |
| High | 4× cascaded HP (Q=1.0) | **2500 Hz** | 8th order |

### Color FX

Bipolar knob from -1 to +1:

| Range | Effect | Frequency |
|-------|--------|-----------|
| -1 → 0 | Lowpass sweep | 20 Hz → 20 kHz (exponential) |
| 0 | Bypass | 20 kHz (fully open) |
| 0 → +1 | Highpass sweep | 20 Hz → 20 kHz (exponential) |

Default Q = 0.707 (Butterworth). Q increases with depth for more aggressive filtering at extremes.

## Master Bus

Full signal chain from input to output:

```
Input (GainNode)
  → Master EQ (3-band: 80 Hz / 1 kHz / 12 kHz, ±12 dB)
  → Master Filter (bipolar LP/HP sweep, 3-path crossfade)
  → Band-Split Distortion (300 Hz crossover)
  → Punch Compressor (parallel, 8:1 ratio)
  → DC Blocker (10 Hz highpass)
  → Headroom Pad (-0.3 dB)
  → Limiter (brickwall, -0.5 dB threshold)
  → Analyser → Channel Splitter → L/R Analysers
```

### Master EQ

| Band | Type | Frequency | Q | Range |
|------|------|-----------|---|-------|
| Low | Low shelf | **80 Hz** | — | ±12 dB |
| Mid | Peaking | **1000 Hz** | 0.7 | ±12 dB |
| High | High shelf | **12000 Hz** | — | ±12 dB |

### Master Filter

Bipolar knob -1 to +1. Three parallel signal paths (bypass, LP, HP) with gain crossfading.

Frequency mapping: `20 × 1000^(1 - |knob|)` — exponential sweep from 20 Hz to 20 kHz.

### Band-Split Distortion

| Parameter | Value |
|-----------|-------|
| Crossover | **300 Hz** |
| Sub behavior | Summed to **mono** below 300 Hz (phase-safe for PA) |
| Waveshaper | `tanh(k·x) / tanh(k)`, k = amount² × 80 + 1 |
| Oversampling | 4× when active, none when off |
| Curve resolution | 2048 samples |

### Punch Compressor

Parallel compression — dry signal is always present, compressed signal is mixed in.

| Parameter | Value |
|-----------|-------|
| Threshold | **-18 dB** |
| Ratio | **8:1** |
| Attack | **5 ms** |
| Release | **150 ms** |
| Knee | 6 dB |
| Wet mix | `amount × 0.5` |

### DC Blocker

Highpass BiquadFilter at **10 Hz**, Q = 0.707. Removes DC offset from distortion and compression.

### Headroom Pad

Fixed **-0.3 dB** gain reduction before the limiter.

### Limiter

| Parameter | Value |
|-----------|-------|
| Threshold | **-0.5 dB** |
| Ratio | **20:1** |
| Attack | **2 ms** |
| Release | **50 ms** |
| Knee | **0 dB** (hard) |

Visual feedback via LimiterDot:
- **Idle** (< 0.3 dB reduction): dark
- **Gentle** (0.3–3 dB): amber glow
- **Emergency** (> 3 dB): red flash + clip border

## Headphone Bus

### Stereo Mode (Default)
Both master and headphone output to all speakers.

### Split Mode
Master output → right ear, CUE → left ear (via `ChannelMergerNode`).

### CUE Mix
Knob from 0 to 1: 0 = 100% CUE (pre-fader), 1 = 100% MASTER.

## Crossfader

| Curve | Formula | Character |
|-------|---------|-----------|
| `smooth` | `gainA = cos(pos × π/2)`, `gainB = sin(pos × π/2)` | Equal-power, no center dip |
| `sharp` | Linear cut | Fast cuts, scratch style |

Position 0 = full Deck A, position 1 = full Deck B.

## State Management

MIXI uses **Zustand** stores:

| Store | Key State |
|-------|-----------|
| `mixiStore` | Deck states (2), master, crossfader, headphones, AI mode, deck modes |
| `settingsStore` | EQ model, EQ range, Wasm DSP, demo tracks, skin, update check |
| `browserStore` | Track browser visibility, file list, sort order |
| `sessionStore` | Recording state, session persistence |

### Deck State Shape

Each deck tracks: transport (`isPlaying`, `playbackRate`, `isSynced`, `syncMode`), audio (`gain`, `volume`, `eq`, `colorFx`), analysis (`bpm`, `originalBpm`, `bpmConfidence`, `musicalKey`, `dropBeats`), waveform data, performance (`hotCues[8]`, `activeLoop`, `quantize`, `keyLock`, `slipModeActive`, `cueActive`), and track info (`trackName`, `duration`, `loadingStage`).

## Pluggable Deck Modes

| Mode | Key | Label | Color | Component |
|------|-----|-------|-------|-----------|
| Track | `track` | — | Deck color | `DeckSection` |
| Groovebox | `groovebox` | GROOVEBOX | `#a855f7` | `GrooveboxDeck` (lazy) |
| TurboKick | `turbokick` | TURBOKICK | `#ef4444` | `TurboKickDeck` (lazy) |
| TurboBass | `js303` | TURBOBASS | `#00ff88` | `JS303Deck` (lazy) |

## Performance Patterns

### Direct DOM Mutation
VU meters, phase meter, and limiter dot update at 30fps via `requestAnimationFrame` with frame-skipping, writing directly to DOM refs — zero React re-renders.

### AudioWorklet Usage

| Worklet | File | Purpose |
|---------|------|---------|
| `mixi-dsp-processor` | `mixi-dsp-worklet.js` | Full Rust/Wasm signal chain |
| `diode-ladder-processor` | `diode-ladder-processor.js` | TurboBass 4-pole diode ladder filter |
| `recording-tap` | `recording-tap.js` | Disk recording bridge |

### React Bridge
`useMixiSync` and `useMixiBridge` hooks synchronize the Zustand store with the audio engine bidirectionally.

## Watermarking

Three-tier system (all zero-impact on audio quality):

1. **UI Fingerprint** — Invisible canvas overlay with per-session build hash at sub-1% opacity
2. **Code Fingerprint** — Zero-Width Character steganography in compiled CSS/skin files
3. **Audio Container** — Encrypted build metadata appended to exported recording containers (no audio samples modified)
