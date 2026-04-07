# AI AutoMixer

## Architecture

The AutoMixer is a **Utility AI** (not a state machine). Multiple intents can fire simultaneously across different domains. The engine ticks at **50 ms** (20 Hz) — at 170 BPM that's ~5.7 ticks per beat.

### AI Modes

| Mode | Behavior |
|------|----------|
| **OFF** | Engine disabled |
| **CRUISE** | Runs continuously. Any user interaction kills the AI permanently |
| **ASSIST** | Pauses when user interacts. Resumes after configurable inactivity delay |

### Tick Loop

Each tick:
1. Check mode (OFF = skip, ASSIST = check pause/resume)
2. Clear ghost fields from previous tick
3. Compute Blackboard (all deck/master state)
4. Score all 18 intents via `intent.evaluate(blackboard)`
5. Sort by score descending
6. Arbitrate: fire each intent unless its domain is locked by a higher-scoring exclusive intent
7. Execute winners, marking affected controls as "ghost fields"

### Ghost Fields

When the AI manipulates a control, it's marked as a **ghost field** (e.g., `"A.eq.low"`, `"crossfader"`). UI knobs with ghost fields glow purple, showing the user which controls the AI is touching. Ghost fields are stored in a global `Set` outside Zustand to avoid 50 ms re-render storms.

## Blackboard

Variables computed once per tick from the Zustand store and audio engine:

### Deck Roles

| Variable | Description |
|----------|-------------|
| `masterDeck` | Louder deck or only playing deck (default A) |
| `incomingDeck` | The other deck |

### Timing

| Variable | Description |
|----------|-------------|
| `masterCurrentBeat` | Current beat position |
| `masterBeatInPhrase` | Position within 16-beat phrase (0–15.99) |
| `masterOnDownbeat` | Beat mod 4 < 0.5 |
| `beatsToOutroMaster` | Beats remaining to track end |
| `deadAirImminent` | < 8 beats remaining |

### Spectral

| Variable | Description |
|----------|-------------|
| `bassClash` | Both decks' low EQ > -10 dB |
| `midClash` | Both decks' mid EQ > -6 dB |
| `incomingBassKilled` | Incoming EQ low < -15 dB |
| `masterHasFilter` | abs(colorFx) > 0.3 |

### Harmonic

| Variable | Description |
|----------|-------------|
| `masterKey` / `incomingKey` | Camelot notation |
| `isHarmonicMatch` | Camelot ±1 (compatible keys) |

### Phase

| Variable | Description |
|----------|-------------|
| `isPhaseAligned` | Within ±50 ms |
| `phaseDeltaMs` | Signed, positive = incoming behind |

The Blackboard has an optional **Wasm fast path** — if the Rust module is loaded, 18 floats are packed into a `Float64Array` and computed in Wasm.

## All 18 Intents

### Safety Domain

| Intent | Score | Trigger | Action |
|--------|-------|---------|--------|
| **Dead Air Prevention** | 1.0 | < 8 beats to end, no loop | Engages 4-beat auto-loop |
| **Phase Drift Correction** | 0.6–0.9 | Both playing, > 10 ms drift | Proportional pitch nudge (0.5–2%) then restore |
| **Red Line Limiter** | 0.92 | Both volumes > 0.8, EQ boosted | Reduces master volume to 0.7 |
| **EQ Amnesia Recovery** | 0.7–0.85 | Bass killed > 1.6s while solo | Gradually restores bass +2 dB/tick |

### Spectral Domain

| Intent | Score | Trigger | Action |
|--------|-------|---------|--------|
| **Drop Swap** | 0.9 | Both playing, bass killed, phrase boundary | Swap bass: master → -26 dB, incoming → 0 dB |
| **Sub Rumble Control** | 0.7 | Bass clash detected | Incoming low → -15 dB |
| **Hi-Hat Layering** | 0.4 | Incoming bass killed, highs < -2 dB | Incoming high → 0 dB |
| **Vocal Space Carving** | 0.5 | Mid clash detected | Incoming mid → -8 dB |
| **Isolator Sweep** | 0.35 | Solo, EQ flat, near phrase boundary | Sweeps all EQ to -20 dB, snaps back at boundary |

### Dynamics Domain

| Intent | Score | Trigger | Action |
|--------|-------|---------|--------|
| **Filter Washout** | 0.1–0.8 | Bass killed, within 16 beats of phrase | Ramps master colorFx to 0.7 (HPF) |
| **LPF Mud Dive** | 0.05–0.5 | Bass killed, no filter | Ramps master colorFx to -0.5 (LPF underwater) |
| **Pre-Drop Silence** | 0.95 | 0.3–1.0 beats to phrase boundary | Sets BOTH volumes to 0 |
| **Filter Wobble** | 0.55 | 1–8 beats to phrase, no filter | Oscillates colorFx ±0.2 every half-beat |

### Rhythm Domain

| Intent | Score | Trigger | Action |
|--------|-------|---------|--------|
| **Loop Roll Buildup** | 0.75 | Within 16 beats, incoming ready | Cascade: loop(4) → loop(2) → loop(1) → loop(0.5) → exit |
| **Teaser Stab** | 0.45 | Incoming silent, bass killed, every 4th downbeat | Flashes incoming volume to 1.0 for quarter-beat |

### Structure Domain

| Intent | Score | Trigger | Action |
|--------|-------|---------|--------|
| **Outro Riding** | 0.3 | 8–64 beats to end, no clash | No-op: claims domain to prevent premature transitions |
| **Double Drop Align** | 0.2–0.6 | Both have drops, > 32 beats lead | Micro playback rate nudge (±0.5%) to converge drops |
| **Key Clash Defense** | 0.8 | Keys not harmonically compatible | Kills incoming mids to -20 dB; ramps master HPF |

## Intent Domains & Exclusivity

Intents are grouped into 5 domains: `safety`, `spectral`, `dynamics`, `rhythm`, `structure`. Within each domain, **exclusive** intents lock the domain — lower-scoring intents in the same domain are blocked. **Non-exclusive** intents can stack freely.

# MIDI

## Device Detection

Uses `navigator.requestMIDIAccess({ sysex: false })`. Hot-plug/unplug handled via `onstatechange`.

## CC Mapping (Learn Mode)

1. UI component calls `window.__MIXIMIDILEARN__()` to enter learn mode
2. Next incoming CC or Note message is captured
3. Mapping stored: `{ portId, type: 'cc'|'note', channel, control, action }`

## Mappable Actions

### CC Actions (Continuous)

| Action | Parameters | Range |
|--------|-----------|-------|
| `CROSSFADER` | — | 0–1 |
| `MASTER_VOL` | — | 0–1 |
| `HEADPHONE_MIX` | — | 0–1 |
| `HEADPHONE_LEVEL` | — | 0–1 |
| `DECK_GAIN` | deck A/B | -12 to +12 dB |
| `DECK_VOL` | deck A/B | 0–1 |
| `DECK_EQ_HIGH` | deck A/B | Scaled by EQ range |
| `DECK_EQ_MID` | deck A/B | Scaled by EQ range |
| `DECK_EQ_LOW` | deck A/B | Scaled by EQ range |
| `DECK_FILTER` | deck A/B | -1 to +1 (bipolar) |
| `DECK_PITCH` | deck A/B | ±8% (hardcoded) |

### Note Actions (Toggle)

| Action | Parameters | Description |
|--------|-----------|-------------|
| `DECK_PLAY` | deck A/B | Toggle play/pause |
| `DECK_SYNC` | deck A/B | Toggle sync |
| `DECK_CUE` | deck A/B | Toggle CUE |
| `GROOVEBOX_PAD` | deck, voice | Trigger drum pad |

::: warning Known Issue
`DECK_PITCH` range is hardcoded to ±8%. A TODO comment mentions adding configurable pitch range, but it's not implemented.
:::

## MIDI Clock

### Output
- **24 ppqn** (standard MIDI clock)
- Look-ahead scheduler: checks every 10 ms, schedules 25 ms ahead with hardware timestamps
- Sends to ALL available MIDI outputs

### Input
- Receives clock ticks, averages last 24 ticks to compute external BPM
- Exposes `externalBpm` and `hasExternalClock`

# Skins

## Built-in Skins (3)

| Skin | Description |
|------|-------------|
| **midnight** | Dark blue theme (default) |
| **freetekno** | Warm rust/earth tones |
| **carbon** | Neutral gray |

## Custom Skins (17 bundled)

Acid, Aqua, Arcade Invaders, Blackfluo, Bloodmoon, Casino, Dune, E-Ink, Gold, Hologram, Industrial, Matrix, Nordic, Synthwave, Vaporwave, White, and a duplicate Freetekno.

## Custom Skin Format

A folder containing two files:

### `skin.json`
```json
{
  "id": "my-skin",
  "name": "My Custom Skin",
  "dotColor": "#ff0088"
}
```

### `skin.css`
CSS file with custom property overrides. Injected as a `<style>` element. Basic security: rejected if it contains `<script`, `javascript:`, or `expression(`.

## Loading Custom Skins

Click the folder icon in the topbar skin selector to open a directory picker. The skin is loaded, validated, and stored in `localStorage` for persistence.

# Groovebox

## Overview

4-voice drum machine with 16-step sequencer, per-voice synthesis, and MIDI input.

## Voices

All voices are **pure WebAudio synthesis** — no sample files required.

| Voice | Method | Duration | Details |
|-------|--------|----------|---------|
| **Kick** | Sine pitch-sweep | 250 ms | 150 → 50 Hz exponential, exp(-12t), gain 0.9 |
| **Snare** | Noise + sine | 180 ms | White noise exp(-20t) at 0.5 + 200 Hz sine exp(-30t) at 0.4 |
| **Hat** | HP filtered noise | 80 ms | First-order difference filter, exp(-50t), gain 0.35 |
| **Perc** | Two detuned sines | 100 ms | 800 Hz + 1127 Hz (metallic), exp(-35t) |

Custom samples can be loaded via drag-and-drop onto sequencer rows.

## Sequencer

16 steps per pattern. Each step is a boolean (on/off) per voice. Per-voice volume (0–1, default 0.8). Swing 0–0.5 applied to odd steps.

Scheduling: 25 ms timer, 50 ms look-ahead, 16th note resolution.

## Per-Voice Mixer

| Control | Range | Description |
|---------|-------|-------------|
| Pan | -1 to +1 | Stereo position |
| Mute | on/off | Silences voice |
| Solo | on/off | Solos voice (mutes others) |
| Volume | 0–1 | Per-voice gain |

## Bus Routing

```
Groovebox voices → per-voice gain/pan/mute → Bus output → DeckChannel.input
→ EQ → ColorFX → Fader → Crossfader → Master
```

The groovebox routes through the standard deck channel, so deck EQ, effects, and crossfader all apply.

## MIDI Input

Receives `GROOVEBOX_PAD` events from the MIDI manager. Velocity (0–1) is applied as gain. Polyphonic — multiple voices can trigger simultaneously.

::: danger Stub Feature
The 8 FX pad buttons in the Groovebox UI (LPF, HPF, DLY, RVB, GATE, DIST, FLG, STT) are **purely visual toggles**. No actual audio FX processing is connected to the groovebox audio graph. Clicking them changes React state only.
:::
