# TurboBass Acid Synth

## Overview

TurboBass is an acid bass synthesizer with a 4-pole diode ladder filter running as an AudioWorklet. All DSP parameters are mathematically derived from circuit analysis, not arbitrary values.

## Signal Chain

```
Main Oscillator (saw / variable-pulse) ──┐
Sub Oscillator (sine, -1 octave) ────────┤→ Pre-Filter HP (44 Hz)
Drift LFO → Main Osc frequency          │   → Drive (tanh saturation)
                                         │   → Diode Ladder Filter (4-pole AudioWorklet)
                                         │       ↑ Filter LFO (BPM-synced)
                                         │       ↑ Filter Envelope (bipolar)
                                         └→ VCA (2 ms attack)
                                              → Dry + Distortion (Rat asymmetric)
                                              → Delay (BPM-synced, HP feedback)
                                              → Bus (reverb, chorus, auto-pan, limiter)
```

## Diode Ladder Filter

Implemented as an AudioWorklet (`diode-ladder-processor.js`) with 2× internal oversampling.

### Mathematical Constants

| Constant | Value | Derivation |
|----------|-------|------------|
| **VT** | 0.4 | Thermal voltage. Geometric mean of 4 pole input levels: (0.7 · 0.49 · 0.34 · 0.24)^0.25 ≈ 0.41 |
| **K_MAX** | 3.07 | Barkhausen: k_crit = 1/(0.894 × 0.707³) = 3.16, then × 0.97 for stability |
| **Pole 1 scale** | 0.5 | Half capacitance (303 mismatch — "broken 24 dB" slope) |
| **Poles 2–4 scale** | 1.0 | Matched capacitance |

### Derived Coefficients

| Coefficient | Formula | Purpose |
|-------------|---------|---------|
| **g** | `tan(π × fc / (2 × sampleRate))` | TPT integrator gain (exact bilinear transform) |
| **k** | `res² × K_MAX` | Quadratic resonance curve for musical control |
| **compGain** | `√(1 + k)` | Resonance volume compensation |

### Per-Pole Transfer

```
s[i] += g × poleScale × (tanh(input/VT) - tanh(s[i]/VT))
```

Feedback from last pole: `u = input - k × tanh(s[3]/VT)`

### tanh Approximation

Padé 3/3: `x × (27 + x²) / (27 + 9x²)`, hard-clipped at ±3. Max error < 0.004.

### Fallback

If the AudioWorklet fails to load, a BiquadFilter (2-pole lowpass) is used as fallback. Resonance maps to Q = 1 + value × 25.

## Synth Parameters

### Parameter Reference

| ID | Default | Formula | Range |
|----|---------|---------|-------|
| **cutoff** | 0.5 | `20 × 900^x` | 20 Hz – 18 kHz |
| **resonance** | 0.5 | `res² × 3.07` (in worklet) | 0 – 1 |
| **envMod** | 0.5 | `cutoff × 2^(envMod × 7)` | 0 – 7 octaves sweep |
| **decay** | 0.5 | `0.02 × 100^x` | 20 ms – 2 s |
| **accent** | 0.5 | VCA boost: `1 + accent × 0.8` | 0 – 1 |
| **tuning** | 0.5 | `(tuning - 0.5) × 24` semitones | ±12 semitones |
| **waveform** | 0 | 0 = sawtooth, > 0.5 = variable pulse | 0 or 1 |
| **drive** | 0 | `tanh(k×x)/tanh(k)`, k = 1 + drive × 8 | 0 – 1 |
| **subLevel** | 0.3 | Sub oscillator mix gain | 0 – 1 |
| **drift** | 0.3 | Drift LFO depth: `drift × 2.5` Hz | 0 – 1 |
| **gateLength** | 0.75 | Gate fraction: `0.1 + x × 0.9` | 10% – 100% |
| **slideTime** | 0.15 | RC time constant: `0.005 × 60^x` | 5 ms – 300 ms |
| **filterTracking** | 0 | `cutoff × 2^((midi-60) × tracking/12)` | 0 – 1 (off to 1:1) |

### Cutoff

Exponential mapping following Weber-Fechner law. Each 0.1 knob increment ≈ 1 octave.

```
f(x) = 20 × 900^x
```

x=0 → 20 Hz, x=0.5 → 600 Hz, x=1 → 18 kHz.

### Decay

Exponential mapping giving fine control in the acid range (short decays).

```
f(x) = 0.02 × 100^x
```

x=0 → 20 ms, x=0.3 → 170 ms, x=0.5 → 632 ms, x=1 → 2 s.

## Filter Envelope

Bipolar three-phase envelope:

1. **Spike**: Instant jump to `envPeak = cutoff × 2^(envMod × 7 × accentBoost)`
2. **Decay**: Exponential ramp down to `undershoot = cutoff × 0.85` (15% below steady-state)
3. **Recovery**: `setTargetAtTime` back to cutoff, τ = `decaySec × 0.6`

The undershoot creates the characteristic pump/breathing effect.

## Accent Behavior

Three independent interactions:

| Interaction | Formula | Effect |
|-------------|---------|--------|
| Filter depth | `√(1 + resonance × 3)` | More resonance → deeper envelope sweep |
| Decay snap | `0.02 + baseDec × 0.1` | Forces ~20 ms decay regardless of knob |
| VCA boost | `1 + accent × 0.8` | Independent amplitude increase |
| Resonance boost | `+0.2` absolute, decays back in `decaySec × 0.4` | Momentary squelch |

## Oscillator

### Sawtooth (Default)

Standard `OscillatorNode` sawtooth. Sub-oscillator (sine, -1 octave) mixed via `subLevel` gain.

### Variable Duty-Cycle Pulse

When waveform > 0.5, a `PeriodicWave` is generated from Fourier series with pitch-dependent duty cycle:

- Low notes (55 Hz): 71% duty (fat)
- High notes (880 Hz): 45% duty (thin)
- Recomputed when octave changes (saves CPU)

### Analog Drift

Sine LFO at 0.08–0.13 Hz (random per instance), modulating oscillator frequency. Depth: `drift × 2.5` Hz.

## Sequencer

### Step Format

Each step has 7 properties:

| Property | Type | Description |
|----------|------|-------------|
| `note` | number | MIDI note (36–72 typical) |
| `gate` | boolean | Note on/off |
| `accent` | boolean | Accent flag |
| `slide` | boolean | Glide to next note |
| `tie` | boolean | Legato — gate stays open, no envelope re-trigger |
| `up` | boolean | Octave up (+12 semitones) |
| `down` | boolean | Octave down (-12 semitones) |

### TIE Behavior

When a step has `tie=true`, the previous note's gate stays open — no noteOff, no new noteOn. If slide is also active, pitch glides without re-triggering the envelope.

### Gate Length

Note-off time: `stepDur × (0.1 + gateLength × 0.9)`. Default 0.75 → ~80% of step.

### Swing

Odd steps are delayed by `swing × stepDur × 0.5`. Range: 0 to 0.5.

### Scheduling

25 ms JavaScript timer with 50 ms AudioContext look-ahead. Step duration = `60 / BPM / 4`.

## Pattern System

### Banks

4 banks × 8 patterns = **32 factory patterns**.

| Bank | Style | Patterns |
|------|-------|----------|
| **A** | Classic Acid House | Acid Trax, Hardfloor, Wild Pitch, Pierre, Pump It Up, Sleazy, Da Funk, Mentasm |
| **B** | Techno / Industrial | Surgeon, Berghain, Regis, Monolith, EBM Grind, Warehouse, Ostgut, Schranz |
| **C** | Minimal / Deep | Plastikman, Hypnotic, Deep Space, Microglide, R. Hood, Dub Chord, Looping, Pulse |
| **D** | Experimental | Poly 7, Stutter, Chromatic, Random Feel, Octave Jump, Trance Gate, Acid Rain, Machine |

### Randomize

Scale-aware pattern generator. Default: minor pentatonic, root C2, density 70%.

- Accent: 35% on off-beats, 15% on beats
- Slide: 15% (only if previous step gated)
- Tie: 10% (only if previous gated, no accent, no slide)
- Octave up: 10%, down: 8%

Available scales: chromatic, minor, phrygian, minor pentatonic, blues, dorian.

### Mutate

Progressive random edits. At amount=1, applies ~7 mutations:
- 35%: note shift ±1–5 semitones
- 20%: toggle gate
- 15%: toggle accent
- 15%: toggle slide
- 15%: toggle octave

### Ghost Sequence

After 5 minutes of inactivity, auto-generates a new pattern. Uses the current pattern's root note (most common note class). Any user interaction cancels.

### ACID Macro

Single knob controlling 4 parameters simultaneously:

| Parameter | Range (macro 0→1) |
|-----------|-------------------|
| Cutoff | 0.3 → 0.9 |
| Env Mod | 0.2 → 0.9 |
| Resonance | 0.3 → 0.85 |
| Decay | 0.6 → 0.15 (inverted) |

## Bus Effects

### Spring Reverb (Synthetic IR)

Comb filter reflections at 97, 233, 389, 557 samples for metallic spring character. Pre-delay: 8 ms (L), 12 ms (R). Duration: 0.5–3.0 s. **Ducking**: noteOn ducks to 0.15 (5 ms), noteOff releases to 1.0 (150 ms).

### Chorus

Dual delay lines (12 ms + 18 ms) modulated by sine LFOs (0.7 Hz + 0.9 Hz). Rate range: 0.2–4 Hz.

### Auto-Pan

Stereo panner modulated by 0.25 Hz sine LFO. Depth up to 80%.

### Delay

BPM-synced dotted 8th note: `(60/BPM) × 0.75`. HP filter (200 Hz) in feedback loop. Feedback capped at 85%.

### Distortion

Rat-style asymmetric hard clip: positive side 1.2× harder, negative 0.8×. Oversampled 4×.

### Limiter

Brick-wall: -1 dB threshold, 20:1 ratio, 1 ms attack, 10 ms release.

### Volume Curve

Quadratic: `output = value²`.

## UI Layout

Two-row knob layout:

```
Row 1: [Filter Canvas] │ CUT  RES  ENV  DEC │ GATE SLDT TRK │ ACID
         FILTER          │   SYNTH CORE       │   CONTROL      │ MACRO

Row 2: [SAW/SQR TUNE]  │ ACC  DRV  SUB  DFT │ DST DLY FB REV CHO LFO
         WAVE            │   TONE + CHARACTER  │      EFFECTS
```

Transport: ENGAGE, SWG, VOL, RND, MUT, CPY, PST, CLR, RST, PNC, X↔F.
