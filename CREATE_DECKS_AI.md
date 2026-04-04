# Creating Deck Plugins for MIXI — AI Developer Guide

> This document tells an AI everything it needs to know to build a new
> instrument/deck plugin for MIXI that integrates with zero friction.
> Follow this spec exactly and the result drops into the codebase
> with a one-line registration.

## What Is a Deck Plugin?

MIXI has two deck slots (A and B). Each slot can run one of several **modes**:
- `track` — standard DJ deck (audio file playback, waveform, hot cues, loops)
- `groovebox` — 4-voice drum machine step sequencer
- `turbokick` — real-time kick drum synthesizer + 16-step sequencer

A deck plugin is a self-contained folder under `src/decks/<your-deck>/` that
provides an audio engine, an audio bus, and a React UI component. The plugin
connects its audio output to the standard MIXI mixer chain (EQ, fader,
crossfader, master bus) so it integrates seamlessly with the rest of the app.

---

## File Structure (Required)

Create a folder: `src/decks/<your-deck>/`

```
src/decks/<your-deck>/
  types.ts            — Type definitions, constants, default values
  <YourDeck>Engine.ts — Audio scheduling, transport, sequencer, sync
  <YourDeck>Bus.ts    — WebAudio node chain (synth → FX → output)
  <YourDeck>Synth.ts  — Sound generator (oscillators, noise, samples)
  <YourDeck>Deck.tsx  — React UI component (knobs, pads, display)
  index.ts            — Re-exports
```

---

## 1. types.ts — Types & Defaults

Define all parameter IDs, step count, and default state generators.

```typescript
/** Number of steps in one pattern. */
export const STEP_COUNT = 16;

/** Synth parameter identifiers (all values 0-1 normalized). */
export type SynthParamId = 'param1' | 'param2' | 'param3';

/** FX knob identifiers (all values 0-1 normalized). */
export type FxKnobId = 'filter' | 'resonance' | 'delay' | 'reverb';

/** Runtime snapshot exposed to the UI. */
export interface YourDeckSnapshot {
  isPlaying: boolean;
  currentStep: number;        // 0–15, -1 when stopped
  bpm: number;
  syncToMaster: boolean;
  steps: boolean[];           // length = STEP_COUNT
  synth: Record<SynthParamId, number>;
  fx: Record<FxKnobId, number>;
  masterVolume: number;       // 0–1
  swing: number;              // 0–0.5
}

/** Default synth state. */
export function defaultSynth(): Record<SynthParamId, number> {
  return { param1: 0.5, param2: 0.5, param3: 0 };
}

/** Default FX state. */
export function defaultFx(): Record<FxKnobId, number> {
  return { filter: 0.75, resonance: 0, delay: 0, reverb: 0 };
}

/** Default step pattern. */
export function defaultSteps(): boolean[] {
  return Array.from({ length: STEP_COUNT }, (_, i) => i % 4 === 0);
}
```

**Rules:**
- ALL parameters are 0-1 normalized. The engine/bus maps to actual values.
- Export `default*()` factory functions (not objects) so each instance gets fresh state.
- The snapshot interface drives the React UI via `useState`.

---

## 2. Engine — Transport, Sequencer, Sync

The engine owns playback state, the step sequencer clock, and sync to master BPM.

### Required Interface

```typescript
export class YourDeckEngine {
  readonly deckId: DeckId;

  // Lifecycle
  init(): void              // Create AudioContext refs, start timers
  destroy(): void           // Stop everything, clear intervals

  // Transport
  engage(): void            // Start (quantize to next downbeat if synced)
  stop(): void
  get isPlaying(): boolean
  get currentStep(): number // 0-15, -1 when stopped

  // BPM
  get bpm(): number
  get syncToMaster(): boolean
  set syncToMaster(v: boolean)
  get swing(): number
  set swing(v: number)      // 0-0.5

  // Volume
  get masterVolume(): number
  set masterVolume(v: number)

  // Pattern
  get steps(): boolean[]
  toggleStep(step: number): void
  clearPattern(): void
  resetPattern(): void

  // Synth params
  get synthParams(): Record<SynthParamId, number>
  setSynthParam(id: SynthParamId, value: number): void

  // FX
  setFx(id: FxKnobId, value: number): void

  // Callbacks (set by UI component)
  onStepChange?: (step: number) => void
  onTrigger?: (step: number) => void
}
```

### Scheduling Pattern

Use AudioContext look-ahead scheduling (NOT `setTimeout` for audio timing):

```typescript
const LOOK_AHEAD_S = 0.05;  // 50ms
const TICK_MS = 25;          // scheduler tick

private tick = () => {
  const ctx = this.ctx;
  while (this.nextStepTime < ctx.currentTime + LOOK_AHEAD_S) {
    if (this._steps[this._currentStep]) {
      this.triggerNote(this.nextStepTime);  // schedule on audio thread
    }
    this.advanceStep();
  }
};

// Start with setInterval(this.tick, TICK_MS)
```

### Sync to Master BPM

```typescript
private getSyncBpm(): number {
  const state = useMixiStore.getState();
  const deck = this.deckId === 'A' ? 'B' : 'A'; // sync to OTHER deck
  return state.decks[deck].bpm || this._bpm;
}
```

### Quantized Start (snap to next downbeat)

```typescript
engage(): void {
  if (this._syncToMaster) {
    const state = useMixiStore.getState();
    const other = this.deckId === 'A' ? 'B' : 'A';
    const otherDeck = state.decks[other];
    if (otherDeck.isPlaying && otherDeck.bpm > 0) {
      // Wait for next downbeat
      const beatPeriod = 60 / otherDeck.bpm;
      const now = this.ctx.currentTime;
      const elapsed = now - otherDeck.firstBeatOffset;
      const nextBeat = otherDeck.firstBeatOffset +
        Math.ceil(elapsed / beatPeriod) * beatPeriod;
      this.nextStepTime = nextBeat;
    }
  }
  this._playing = true;
  this.startTimer();
}
```

---

## 3. Bus — Audio Chain

The bus creates the WebAudio node graph. Its `output` GainNode connects to
`DeckChannel.input`.

### Required Interface

```typescript
export class YourDeckBus {
  readonly output: GainNode;   // → DeckChannel.input
  readonly input: GainNode;    // ← synth output connects here

  constructor(ctx: AudioContext) { ... }
  destroy(): void

  setFx(id: FxKnobId, value: number): void
}
```

### Audio Chain Pattern

```
SynthOutput → InputGain → [Effects Chain] → OutputGain → DeckChannel.input
```

**The output GainNode is your contract with MIXI.** Everything before it is yours.
After it, the signal flows through MIXI's mixer:

```
YourBus.output → DeckChannel:
  Trim → LR4 EQ (3 band) → ColorFX → DeckFX → Fader → Crossfader → MasterBus
```

### Parameter Smoothing

NEVER set `node.gain.value = x` directly. Always use exponential ramp:

```typescript
function smooth(param: AudioParam, value: number, ctx: AudioContext, tau = 0.012) {
  param.cancelScheduledValues(ctx.currentTime);
  param.setTargetAtTime(value, ctx.currentTime, tau);
}
```

---

## 4. Synth — Sound Generator

The synth creates sound. It receives an `AudioContext` and connects to the bus input.

### Pattern: Self-Destructing Nodes

For percussive sounds, create temporary node graphs per trigger:

```typescript
trigger(time: number, destination: AudioNode) {
  const osc = this.ctx.createOscillator();
  const gain = this.ctx.createGain();

  osc.connect(gain);
  gain.connect(destination);

  // Schedule envelope
  gain.gain.setValueAtTime(1, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + this.decay);

  osc.start(time);
  osc.stop(time + this.decay + 0.01);

  // Self-destruct
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}
```

### Pattern: Persistent Oscillator

For continuous synths (303, pads), keep oscillators alive:

```typescript
private osc: OscillatorNode;
private filter: BiquadFilterNode;
private env: GainNode;

init() {
  this.osc = ctx.createOscillator();
  this.filter = ctx.createBiquadFilter();
  this.env = ctx.createGain();
  this.osc.connect(this.filter);
  this.filter.connect(this.env);
  this.env.connect(this.bus.input);
  this.osc.start();
  this.env.gain.value = 0; // silent until triggered
}

noteOn(freq: number, time: number) {
  this.osc.frequency.setValueAtTime(freq, time);
  this.env.gain.cancelScheduledValues(time);
  this.env.gain.setValueAtTime(0, time);
  this.env.gain.linearRampToValueAtTime(1, time + 0.003); // 3ms attack
}

noteOff(time: number) {
  this.env.gain.setTargetAtTime(0, time, this.decayTau);
}
```

---

## 5. React UI Component

### Required Props

```typescript
import type { HouseDeckProps } from '../index';

export const YourDeck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  // deckId: 'A' or 'B'
  // color: accent color (from registry)
  // onSwitchToTrack: callback to exit this mode and return to track deck
};
```

### State Management

Use local React state, NOT Zustand. The deck is self-contained:

```typescript
const [snapshot, setSnapshot] = useState<YourDeckSnapshot>(initialSnapshot);
const engineRef = useRef<YourDeckEngine | null>(null);

useEffect(() => {
  const engine = new YourDeckEngine(deckId);
  engine.init();
  engineRef.current = engine;

  engine.onStepChange = (step) => {
    setSnapshot(s => ({ ...s, currentStep: step }));
  };

  return () => engine.destroy();
}, [deckId]);
```

### Layout Guidelines

The deck component fills the entire deck slot area. Use the same layout zones:

```
┌─ HEADER ──────────────────────────────┐
│ [status] DECK A  170.0 BPM  [SYNC] [×]│
├─ SEQUENCER ───────────────────────────┤
│ [1][2][3][4] [5][6][7][8] [9]...      │
├─ BODY ────────────────────────────────┤
│                                        │
│  [pad/display]  │  [knobs]             │
│                                        │
├─ TRANSPORT ───────────────────────────┤
│ [ENGAGE/STOP]  swing  vol  CLR  PRESET│
└───────────────────────────────────────┘
```

### Knob Component

MIXI provides a reusable Knob component:

```tsx
import { Knob } from '../../components/controls/Knob';

<Knob
  value={value}           // current value
  min={0} max={1}         // range
  center={0.5}            // center point (for bipolar)
  onChange={(v) => engine.setFx('filter', v)}
  color={color}           // accent color
  scale={0.7}             // size multiplier
  bipolar                 // optional: bipolar mode
/>
```

### Styling

Use inline styles or Tailwind classes. Match MIXI's dark theme:
- Background: `rgba(0,0,0,0.3)` to `rgba(0,0,0,0.6)`
- Text: `var(--txt-white)`, `var(--txt-muted)`
- Borders: `var(--brd-default)`
- Use the `color` prop for accent highlights

---

## 6. Registration — ONE Line

### Step 1: Add to `src/types/audio.ts`

Add your mode to the `DeckMode` union:

```typescript
export type DeckMode = 'track' | 'groovebox' | 'turbokick' | 'your-deck';
```

### Step 2: Add to `src/decks/index.ts`

Push an entry to `HOUSE_DECKS`:

```typescript
{
  mode: 'your-deck',
  label: 'YOUR DECK',
  accentColor: '#00ff88',
  component: lazy(() =>
    import('./your-deck/YourDeck').then((m) => ({ default: m.YourDeck })),
  ),
},
```

**That's it.** The deck appears in the mode picker automatically.

---

## What NOT to Do

- **DO NOT** create your own `AudioContext`. Use `MixiEngine.getInstance().getAudioContext()`.
- **DO NOT** connect to `ctx.destination` directly. Connect to `DeckChannel.input` via the bus output.
- **DO NOT** use Zustand for deck-internal state. Use React local state. Only read from `useMixiStore` (BPM, crossfader).
- **DO NOT** import from MIXI internals (engine nodes, master bus, etc.). Only import:
  - `MixiEngine` (for `getAudioContext()`)
  - `useMixiStore` (for reading BPM, crossfader position)
  - `Knob` from `../../components/controls/Knob`
  - Types from `../../types/`
  - `HouseDeckProps` from `../index`
- **DO NOT** manage your own audio thread timing with `setTimeout`. Use AudioContext scheduling with look-ahead.
- **DO NOT** set AudioParam values directly (`param.value = x`). Always use `setTargetAtTime` or `setValueAtTime`.

---

## What TO Do

- **DO** make the deck fully self-contained in its folder. Zero side effects on load.
- **DO** implement `destroy()` that disconnects all nodes and clears all intervals.
- **DO** support sync to master BPM (read from `useMixiStore.getState().decks[otherDeck].bpm`).
- **DO** use self-destructing node graphs for percussive sounds.
- **DO** normalize all parameters to 0-1. Map to actual ranges inside the engine/bus.
- **DO** provide default factory functions (`defaultSynth()`, `defaultFx()`, etc.).
- **DO** add swing support (offset odd steps by swing amount).
- **DO** implement `clearPattern()` and `resetPattern()` for the sequencer.
- **DO** use the `color` prop from `HouseDeckProps` for accent highlights.
- **DO** lazy-load the component in the registry (`lazy(() => import(...))`).

---

## Reference Implementation

The **TurboKick** deck at `src/decks/turbokick/` is the canonical reference:

| File | Lines | What to study |
|------|-------|---------------|
| `types.ts` | 64 | Type definitions, default factories |
| `TurboKickEngine.ts` | ~300 | Scheduling, sync, transport, param management |
| `TurboKickBus.ts` | ~250 | Audio chain, FX, valves, LFO, rumble |
| `kickSynth.ts` | ~120 | Self-destructing oscillator + noise synthesis |
| `TurboKickDeck.tsx` | ~500 | Full React UI with knobs, pads, sequencer |
| `index.ts` | 16 | Re-exports |

Copy TurboKick's structure exactly. Replace the kick-specific logic with your
instrument's synthesis and effects. The scheduling, sync, transport, and UI
patterns stay the same.

---

## Audio Chain Examples

### Kick Drum (TurboKick)
```
Oscillator(sine) + Noise(click) → WaveShaper(drive) → ValveA → ValveB
  → Filter(LP) + LFO → Delay → Rumble(convolver+sidechain) → output
```

### Bass Synth (303-style)
```
Oscillator(saw/square) → Filter(LP, high Q) → Envelope(accent)
  → WaveShaper(distortion) → Delay(dotted 8th) → output
```

### Pad Synth
```
Oscillator×3(detune) → Filter(LP) → Chorus(mod delay) → Reverb → output
```

### Sampler
```
AudioBufferSource → Pitch(playbackRate) → Filter → Amp Envelope → output
```

---

## Checklist Before Delivery

- [ ] Folder structure matches: `src/decks/<name>/` with all 5-6 files
- [ ] `types.ts` has STEP_COUNT, param types, snapshot interface, default factories
- [ ] Engine has init/destroy/engage/stop/toggleStep/setSynthParam/setFx
- [ ] Engine uses AudioContext look-ahead scheduling (NOT setTimeout for timing)
- [ ] Engine syncs to master BPM via `useMixiStore`
- [ ] Bus has `output: GainNode` (the contract) and `input: GainNode`
- [ ] Bus uses `setTargetAtTime` for all parameter changes (no zipper noise)
- [ ] Synth creates self-destructing or persistent nodes (no leaks)
- [ ] UI component accepts `HouseDeckProps` and uses `color` for accents
- [ ] UI uses local React state (no Zustand for internal state)
- [ ] `index.ts` re-exports component, engine, types
- [ ] Mode added to `DeckMode` type in `src/types/audio.ts`
- [ ] Entry added to `HOUSE_DECKS` array in `src/decks/index.ts`
- [ ] All parameters 0-1 normalized
- [ ] `destroy()` cleans up everything (intervals, nodes, listeners)
- [ ] No imports from MIXI internals beyond the allowed list
- [ ] TypeScript compiles with zero errors
