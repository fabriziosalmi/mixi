# Mixer & Deck Control

The UI handles real-time audio playback using a dual Deck layout (Deck A / Deck B) bound entirely to the `MixiBridge.ts` module with React bindings resolving exclusively via `requestAnimationFrame` loops (like `drawRef`).

## The `PitchStrip` & `PitchWheel`
- **Dynamic Ranging**: Pitch can be mapped linearly for precise track synchronization.
- **Hardware Bindings**: Strictly avoids rendering loops by tying directly to WebAudio's `.playbackRate`.

## 3-Band Isolator EQ & Filters
Each channel (Deck A, Deck B, Groovebox) leverages its own isolated FX nodes:
1. **Low, Mid, High**: Built using Web Audio Biquad filters strictly set to specific rolloffs.
2. **Kills**: Real-time kill switches (`killRef`) mapped sequentially to effect nodes.
3. **LPF / HPF Washouts**: A specialized bipolar filter knob spanning seamlessly from low-pass cutoff to high-pass boost with a small resonance parameter (Q) in the center.

## Crossfader Logic
Driven by custom React hooks (`useDrag.ts`). The faders are safeguarded against Web Audio "clicks" by clamping and smoothing delta times via `requestAnimationFrame` and checking for node presence inside the strict React effects closures.