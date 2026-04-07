# WebAudio Engine

## MixiEngine

Singleton audio engine at 44,100 Hz. See [Architecture](/guide/architecture) for the complete signal chain.

### Memory Management

- **Buffer limit**: 200 MB max per session
- **Node pooling**: `AudioBufferSourceNode` instances are stopped, disconnected, and dereferenced after use
- **Waveform cache**: Analyzed waveform data cached after first analysis to avoid re-computation

### Audio Analysis Queue

Track analysis (waveform, BPM, key) is serialized via a queue to avoid hitting the browser's limit of ~6 concurrent `OfflineAudioContext` instances.

## Wasm DSP Bridge

Optional Rust/WebAssembly signal chain running entirely on the audio thread.

### Initialization

1. Check `SharedArrayBuffer` + `Atomics` support (requires COOP/COEP headers)
2. Register AudioWorklet processor (`mixi-dsp-worklet.js`)
3. Create 2-input worklet node (Deck A = input 0, Deck B = input 1)
4. Create shared buffers (audio ring + param bus + metering bus)
5. Fetch and compile Wasm module
6. Send compiled module to worklet via `postMessage`
7. Wait for `ready` confirmation (5 second timeout, fallback to native WebAudio)

### Shared Memory Layout

| Buffer | Size | Direction | Purpose |
|--------|------|-----------|---------|
| **audioRing** | 32,776 bytes | Main → Worklet | SPSC ring buffer (~93 ms at 44.1 kHz) |
| **paramBus** | 512 bytes | Bidirectional | All DSP parameters (see below) |
| **meteringBus** | 28 bytes | Worklet → Main | 7 floats: peakL, rmsL, peakR, rmsR, masterPeak, masterRms, limiterGR |

### Parameter Bus Layout (512 bytes)

**Per-Deck (bytes 0–127 for A, 128–255 for B):**

| Offset | Parameter | Default |
|--------|-----------|---------|
| +0 | Trim | 1.0 |
| +4 | EQ Low | 0 dB |
| +8 | EQ Mid | 0 dB |
| +12 | EQ High | 0 dB |
| +16 | Fader | 1.0 |
| +20 | Crossfader Gain | (computed) |
| +24 | Color FX Frequency | Hz |
| +28 | Color FX Resonance | Q |
| +32 | CUE Active | 0/1 |
| +36 | Playback Rate | 1.0 |
| +40–96 | FX params (filter, delay, reverb, phaser, flanger, gate) | per-FX |

**Master (bytes 256–383):**

| Offset | Parameter | Default |
|--------|-----------|---------|
| 256 | Gain | 1.0 |
| 260 | Filter | 0 (bypass) |
| 264 | Distortion | 0 |
| 272 | Punch | 0 |
| 280 | Limiter Active | 1 |
| 284 | Limiter Threshold | -1 dB |

**Global (bytes 384–511):**

| Offset | Parameter |
|--------|-----------|
| 384 | Crossfader position |
| 388 | Crossfader curve (0=smooth, 1=sharp, 2=constant) |
| 392 | Headphone mix |
| 396 | Headphone level |
| 400 | Sample rate |
| 508 | Layout version (must match Rust) |

### DSP Modules in Wasm

The Rust engine implements the full signal chain:
- 3-band EQ (per deck)
- Color FX filter (per deck)
- Per-deck FX: Filter, Delay, Reverb, Phaser, Flanger, Gate
- Master: Gain, Filter, Distortion, Punch compressor, Limiter
- Crossfader with 3 curve types
- Headphone/CUE monitoring
- Auto-gain per deck
- Metering: per-channel peak/RMS, master peak/RMS, limiter gain reduction

::: info Opt-in
The Wasm DSP path defaults to **off**. Enable it in Settings. When active, it bypasses the native WebAudio EQ/FX/MasterBus nodes entirely.
:::

## AudioWorklets

| Worklet | File | Purpose |
|---------|------|---------|
| `mixi-dsp-processor` | `mixi-dsp-worklet.js` | Full Rust/Wasm signal chain |
| `diode-ladder-processor` | `diode-ladder-processor.js` | TurboBass 4-pole diode ladder filter |
| `recording-tap` | `recording-tap.js` | Disk recording bridge (WAV, crash-proof) |

## Recording

### Format
WAV, 32-bit float PCM, stereo, 44,100 Hz. Tapped post-limiter from master bus output.

### Architecture
Crash-proof ring buffer design:
- 131,072 frames capacity (~3 seconds)
- Fixed ~1 MB RAM regardless of recording length
- Flush interval: 500 ms
- Temp file survives crashes; orphan recovery available

### Features
- Start/stop/cancel
- Save As via native dialog
- Cue marks during recording
- Orphan recovery for crashed sessions

::: info Electron Only
Recording requires the Electron desktop app with SharedArrayBuffer support.
:::
