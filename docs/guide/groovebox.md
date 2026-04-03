# Groovebox & MIDI

Mixi supports a built-in Groovebox complete with drum synth generation, PCM samplers, and multi-velocity responsive pads. 

## Features
- **16-Pad Interface (`src/groovebox/GrooveboxDeck.tsx`)**: Fully tactile via mouse, touch, keyboard, or hardware pad controllers.
- **Velocity Tracking**: MIDI inputs map dynamic velocities directly into the `GrooveboxBus.ts`.
- **Clock Sync**: Synchronizes seamlessly with the Master Clock using the application's underlying BPM state (`MixiEngine`), ensuring drums never drift from Deck A or Deck B.

## MIDI Implementation
Mixi uses `navigator.requestMIDIAccess` locally, parsing the input channels (via `WebMIDI` port messages), applying polyphony correctly without choking, and routing via Master Output and Headphone Buses.

- NoteOn & NoteOff mapping correctly handle garbage collection for synths.
- Handles external controller velocity via standardized mapping constants.