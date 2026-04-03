# Mixi Architecture Overview

Mixi is a next-generation browser-based DJ engine powered by React 19, Vite, and the WebAudio API.

## Core Pillars

1. **Strict React 19 Paradigms**
   Mixi is built around absolute strictness regarding React lifecycle, hook arrays, and Refs. Data binding follows unidirectional flow using `Zustand` for state, while audio states are maintained in a parallel engine graph outside of React to prevent performance leaks.

2. **WebAudio API & Scheduling**
   All audio is processed natively within `MixiEngine`. 
   - No React-rendering audio playback. 
   - Uses zero-crossing interpolation arrays to prevent audio clicks when moving sliders/fading.
   - Master Clock uses `requestAnimationFrame` strictly guarded or setInterval outside React logic.

3. **Singleton Store & Bridge (`MixiBridge`)**
   To communicate between React elements and the raw WebAudio `MixiEngine`, Mixi implements `MixiBridge.ts`. It relays real-time AudioContext parameter changes (gain, eq, filters, Isolators) flawlessly into the hardware-accelerated nodes.

## Component Hierarchy

- **DeckSection**: Handles rendering Waveforms, track lengths, play/pause (neon transport), and Pitch.
- **MixerSection**: Manages EQ Isolators (3-band total kills), High-pass/Low-pass filters per channel, and the Crossfader.
- **GrooveboxDeck**: Complete 16-pad drum machine handling MIDI devices directly via WebMIDI API.
- **AI AutoMixEngine**: Constantly reading the Blackboard, evaluating Drop intervals, Key Clashes, and resolving transitions autonomously.

## Watermarking Subsystem

Mixi includes a three-tier zero-impact watermarking system (`src/utils/watermark.ts`) that protects intellectual property without any audio quality degradation:

- **Tier 1 — UI Fingerprint**: An invisible `<canvas>` overlay renders a per-session build hash at sub-1% opacity. Recoverable via image forensics on screenshots. Zero visual impact.
- **Tier 2 — Code & Skin Fingerprint**: Zero-Width Character (ZWC) steganography can be injected into compiled CSS and skin JSON files at build time. Invisible in editors and browsers; identifies leaked builds.
- **Tier 3 — Audio Container Metadata**: Exported recordings carry encrypted build and session metadata appended to the audio container. No audio samples are modified — the watermark exists entirely in the container layer.

All three tiers operate independently and asynchronously. None intercept the real-time audio thread. Combined, they provide full traceability across the UI, source code, and audio output.