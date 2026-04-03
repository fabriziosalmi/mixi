# AI AutoMixEngine

The `AutoMixEngine` is a pioneering feature in Mixi, utilizing an autonomous state machine (the `Blackboard`) to execute DJ transitions dynamically based on waveform analysis, bpm detection, and musical key.

## Intention Architecture (`Intents`)
Instead of hard-coded fade curves, the AutoMixer employs "Intents" which dictate how a transition plays out over multiple beats/bars.

Examples from `src/ai/intents/`:
- `FilterWashoutIntent.ts`: Drops the bass, adds resonance, and washes the track out sequentially on the out-beat.
- `DropSwapIntent.ts`: Detects a structural drop via `DropDetector` and instantly swaps the low-EQ to the incoming deck precisely on count 1.
- `KeyClashDefenseIntent.ts`: Adjusts pitch curves dynamically if both tracks are clashing harmonically (`KeyDetector`).
- `RedLineLimiterIntent.ts`: Safety mechanic preventing master output clipping during heavy layering.
- `LoopRollBuildupIntent.ts`: Auto-segments the playing loop fractionally (1/4 -> 1/8 -> 1/16) towards the crescendo before executing the mix.

## The Blackboard
The `Blackboard.ts` system evaluates variables in real-time, assigning priorities to intents (e.g., if a track is 10 seconds from ending, the `OutroRidingIntent` priority spikes to resolve a fast mix).

## Usage
The system runs via a lazy-loaded singleton. Inside React:
```tsx
import { useAutoMixer } from '../automixer/useAutoMixer';

const { state, toggle } = useAutoMixer();
// Simply toggle AutoMix to see the Engine parse the Blackboard visually.
```