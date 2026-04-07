# Mixer & EQ

## Channel Strip

Each deck has an independent channel strip with this signal flow:

```
Source → Trim → EQ → Color FX → Effects → Fader → Analyser → Crossfader Gain → Master
                                    ↓
                              CUE Gain → Headphone Bus (pre-fader)
```

### Layout

The mixer is a 3-column CSS grid: Deck A (left), center icons, Deck B (right). From top to bottom:

| Section | Control | Range |
|---------|---------|-------|
| Gain trim | Knob (bipolar) | -12 to +12 dB |
| HI EQ | Knob + Kill button | ±range (configurable) |
| MID EQ | Knob + Kill button | ±range |
| LOW EQ | Knob + Kill button | ±range |
| Color FX | Knob (bipolar) | -1 to +1 |
| Volume | Vertical fader (140px) | 0 to 1 |
| VU Meter | 12-segment LED column | Per-deck |

Deck A controls read left-to-right (value → knob → kill), Deck B is mirrored (kill → knob → value).

## EQ Models

Three models selectable in Settings, hot-swappable at runtime. See [Architecture](/guide/architecture) for exact crossover frequencies.

### LR4 Isolator (Default)

Linkwitz-Riley 24 dB/oct parallel isolator. Crossovers at **250 Hz** and **4000 Hz**. Each band is fully independent — killing one band has zero effect on the others.

### DJ Peak (Pioneer DJM-style)

Serial shelving/peaking EQ at 80 Hz / 1 kHz / 12 kHz. **No kill capability** — this model trades isolation for a smoother, more musical response.

### Xone Kill (Allen & Heath-style)

48 dB/oct full-kill isolator. Crossovers at **200 Hz** and **2500 Hz**. Slight resonance (Q=1.0) at crossover points gives a characteristic bump.

### Kill Switches

On isolator models (LR4, Xone), when the EQ knob reaches the minimum of its range, the band gain snaps to **0** (true silence). This is a hard kill, not a fade — the transition is instant.

## Color FX

Bipolar filter sweep from -1 to +1:

- **Negative**: Lowpass — sweeps from 20 kHz down to 20 Hz
- **Zero**: Bypass (20 kHz, fully open)
- **Positive**: Highpass — sweeps from 20 Hz up to 20 kHz

Frequency follows an exponential curve: `20 × 1000^|knob|`. Q increases toward the extremes for more aggressive filtering.

## Volume Fader

140px vertical fader, range 0 to 1. The volume LCD below shows dB: values below -60 dB display as "-∞".

## VU Meters

### Per-Deck Meters

| Property | Value |
|----------|-------|
| Measurement | **RMS** (√mean of squares × 1.414 scaling) |
| Segments | 12 |
| Width | 6px per column |
| Colors | Segments 0–7: green, 8–9: amber, 10–11: red |
| Attack | Instant (0 ms) |
| Release | Logarithmic decay, factor 0.88/frame (~150 ms to half) |
| Peak hold | 1000 ms, then decays |
| Update rate | ~30 fps (direct DOM, no React re-renders) |

The 1.414× scaling (√2) ensures a full-scale sine wave reads ~1.0 on the meter.

### Master VU Meter

Center column, 2 columns (L/R) × 12 segments × 5px width. Same color scheme as deck meters but with 0.3 off-opacity (vs 0.5 for decks). No ballistics — raw level applied directly.

::: warning Known Issue
Both L and R columns read the same `levels.master` value — true stereo metering is not implemented on the master bus.
:::

## Crossfader

Horizontal fader (260px), labeled A (left) and B (right). Position 0 = full Deck A, position 1 = full Deck B.

### Curves

| Curve | Formula | Character |
|-------|---------|-----------|
| **Smooth** (default) | `cos(pos × π/2)` / `sin(pos × π/2)` | Equal-power, no center dip |
| **Sharp** | Cubic `(1-x)³` / `x³` over 0.02–0.98, with 2% dead zones | Both full at center, fast cuts |

## Headphone Cue

Pre-fader listen (PFL) — taps signal after effects but before the volume fader.

### Controls

| Control | Function |
|---------|----------|
| CUE A / CUE B | Toggle pre-fader listen per deck |
| Mix knob | Blend CUE ↔ Master (equal-power cosine crossfade) |
| Volume | Headphone output level |
| Split | L = CUE, R = Master (mono sum each side) |

Split mode crossfades over 10 ms to prevent clicks when toggling.

## Phase Meter

Located in the mixer HUD (tabbed with SCOPE). Shows beat phase alignment between decks:

| Zone | Delta | Color | Visual |
|------|-------|-------|--------|
| LOCKED | < 2 ms | White | No label |
| NEAR | 2–10 ms | Green | "+5ms" |
| WARN | 10–30 ms | Amber | "-15ms" |
| CRIT | > 30 ms | Red | Shake animation |

## HP / Master EQ Strip

Toggle between two panels below the crossfader:

**HP Panel**: CUE A button, Mix knob, Split toggle, Volume knob, CUE B button

**Master EQ Panel**: Low (80 Hz) / Mid (1 kHz) / High (12 kHz) shelf knobs, ±12 dB

# Effects

## Architecture

Effects are **parallel sends** off a shared filter merge bus, not serial. Each effect has an independent wet gain summed into a gate node before output.

```
Input → Filter (inline LP/HP) → Filter Merge
    ├── Dry (gain-compensated) ──────────────┐
    ├── Delay send ──────────────────────────┤
    ├── Reverb send ─────────────────────────┤
    ├── Phaser send ─────────────────────────┤
    ├── Flanger send ────────────────────────┤
    ├── Crusher send ────────────────────────┼→ Gate → Output
    ├── Echo send ───────────────────────────┤
    ├── Tape send ───────────────────────────┤
    └── Noise (independent source) ──────────┘
```

### Gain Compensation

Dry gain is dynamically adjusted based on active wet sends:

```
dryLevel = 1.0 / (1.0 + sumOfAllWetGains)
```

This prevents volume stacking when multiple effects are active simultaneously.

### Parameter Smoothing

All AudioParam changes use `setTargetAtTime()` with τ = **12 ms**. Changes smaller than 1×10⁻⁶ are skipped.

## Effect Reference

### FLT — Bipolar Filter (Inline)

| Parameter | Range | Notes |
|-----------|-------|-------|
| Amount | 0–1 (mapped to -1..+1) | Negative = LP, Positive = HP |
| Frequency | 20 Hz – 20 kHz | `20 × 1000^|knob|` (exponential) |
| Q | 1 (default), max 4 | Tapered toward extremes |

Not a send — processes inline before all other effects.

### DLY — Tempo Delay

| Parameter | Range | Notes |
|-----------|-------|-------|
| Wet | 0 – 0.6 | `amount × 0.6` |
| Feedback | 0.3 – 0.65 | `0.3 + amount × 0.35` |
| Time | BPM-synced | Dotted 8th: `(60/BPM) × 0.75` |

### REV — Reverb

| Parameter | Range | Notes |
|-----------|-------|-------|
| Wet | 0 – 0.5 | `amount × 0.5` |
| IR duration | 1.2s | Synthetic noise decay (x³ envelope) |
| IR | Shared | Single buffer across all decks (saves 211 KB) |

### PHA — 4-Stage Phaser

| Parameter | Range | Notes |
|-----------|-------|-------|
| Wet | 0 – 0.7 | `amount × 0.7` |
| LFO rate | 0.2 – 2.2 Hz | `0.2 + amount × 2` |
| LFO depth | 400 – 1600 Hz | `400 + amount × 1200` |
| Stages | 4 | Allpass chain, Q=5 |

### FLG — Flanger

| Parameter | Range | Notes |
|-----------|-------|-------|
| Wet | 0 – 0.6 | `amount × 0.6` |
| LFO rate | 0.1 – 1.6 Hz | `0.1 + amount × 1.5` |
| LFO depth | 1 – 5 ms | `0.001 + amount × 0.004` |
| Feedback | 0.3 – 0.6 | Capped to prevent resonance > 0 dB |
| Base delay | 5 ms | Reset to 3 ms on activation |

### GATE — Beat-Locked Chop

| Parameter | Values | Notes |
|-----------|--------|-------|
| Divisions | 1/32, 1/16, 1/8, 1/4, 1/2 | Amount selects index 0–4 |
| Duty cycle | 70% open / 30% closed | Fixed |
| Ramp | 2 ms attack, 5 ms release | Prevents clicks |
| BPM sync | **Yes** | Locked to beat grid |

### CRU — Bitcrusher

| Parameter | Range | Notes |
|-----------|-------|-------|
| Wet | 0 – 0.7 | `amount × 0.7` |
| Steps | 16 (mild) → 3 (harsh) | `16 - amount × 13` |
| Curve | 4096-sample staircase | Regenerated only when step count changes |

### ECH — Dub Echo

| Parameter | Range | Notes |
|-----------|-------|-------|
| Wet | 0 – 0.5 | `amount × 0.5` |
| Time | BPM-synced | Half beat: `(60/BPM) × 0.5` |
| Feedback | 0.4 – 0.7 | Capped from 0.85 to prevent low-freq buildup |
| Filter | 3000 → 800 Hz LP | In feedback loop — progressive darkening |
| Filter Q | 0.5 | Fixed |

### TAPE — Tape Stop

::: danger Stub Effect
TAPE is a **non-functional stub**. The implementation is a single GainNode with wet gain up to 0.4 — no filter, no pitch manipulation, no playback rate change. It simply mixes a gained copy of the dry signal, causing a slight volume boost rather than a tape stop effect.
:::

### NOISE — White Noise Sweep

| Parameter | Range | Notes |
|-----------|-------|-------|
| Wet | 0 – 0.35 | `amount × 0.35` |
| Filter | 200 – 12000 Hz LP | `200 + amount × 11800` |
| Filter Q | 1 – 4 | Capped at 4 to prevent violent transients |
| Source | Independent | 2s looping noise buffer (shared, saves 352 KB) |

Not sourced from audio input — generates its own white noise.

## Recording

### Format

| Property | Value |
|----------|-------|
| Format | **WAV** (32-bit float PCM, stereo) |
| Sample rate | Matches AudioContext (44,100 Hz) |
| Tap point | Post-limiter master bus output |

### Architecture

Crash-proof design using SharedArrayBuffer ring buffer (131,072 frames, ~3 seconds at 44.1 kHz). Audio flows: `MasterBus.output → recording-tap AudioWorklet → SharedArrayBuffer → Electron IPC → fs.writeSync`.

Fixed ~1 MB RAM regardless of recording length.

### Features

- Start/stop/cancel recording
- Save As via native dialog
- Orphan recovery (temp files from crashes survive on disk)

::: info Electron Only
Recording requires the Electron desktop app with SharedArrayBuffer support. Not available in browser-only mode.
:::
