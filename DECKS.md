# Mixi Decks & Instruments Development Guide

Welcome to the **Mixi Engine Ecosystem**. This documentation serves as a bootstrap guide for developers looking to build Custom Decks, Samplers, Grooveboxes, or Virtual Instruments for Mixi.

Mixi operates on an **Open Core / Modular Expansion** model. The core Audio Pipeline, DSP, and global state management are strictly safeguarded in the main repository. However, you can seamlessly plug in new visual components and distinct instrument behaviors by following this standardized Component Integration Architecture.

## 1. Architectural Philosophy
In Mixi, a "Deck" or "Instrument" is simply a React component that:
1. Receives a `deckId` (e.g., `'deckA'`, `'deckB'`).
2. Subscribes to the unified Zustand State (`mixiStore`).
3. Optionally hooks into the Web Audio API context (`MixiEngine`) to process or visualize distinct audio streams.

You do **not** need to worry about global Master output routing, Crossfaders, or OS abstractions; the Core Engine handles all of that. 

## 2. Bootstrapping a New Instrument

### Step 1: Fork and Clone the Core Repository
To develop an instrument, fork and clone the official GitHub mirror repository (`https://github.com/fabriziosalmi/mixi`). This gives you local access to the `mixiStore` types and Web Audio instances you need to hook into.

```bash
git clone https://github.com/fabriziosalmi/mixi.git
```

### Step 2: Component Structure
Navigate to `src/components/instruments/` (or create your own subfolder like `src/components/deck-vinyl/`). 
Create your main entry point, keeping it decoupled from the core UI.

```tsx
// src/components/instruments/MyCustomDeck.tsx
import React, { FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import type { DeckId } from '../../types';

interface MyCustomDeckProps {
  deckId: DeckId;
}

export const MyCustomDeck: FC<MyCustomDeckProps> = ({ deckId }) => {
  // Hook into the global engine state!
  const isPlaying = useMixiStore((state) => state.decks[deckId].isPlaying);
  const setDeckPlaying = useMixiStore((state) => state.setDeckPlaying);
  const playbackRate = useMixiStore((state) => state.decks[deckId].playbackRate);

  return (
    <div className="w-full h-full bg-[var(--srf-mid)] p-4 rounded border border-[var(--brd-default)]">
      <h3 style={{ color: `var(--clr-${deckId.charAt(4).toLowerCase()})` }}>
        Deck {deckId.slice(-1).toUpperCase()} - Custom Synthesizer
      </h3>
      
      <button 
        onClick={() => setDeckPlaying(deckId, !isPlaying)}
        className="px-4 py-2 mt-4 bg-white text-black"
      >
        {isPlaying ? 'PAUSE' : 'PLAY'}
      </button>

      <div>Tempo Multiplier: {playbackRate.toFixed(2)}x</div>
    </div>
  );
};
```

### Step 3: Audio Context Injection (Advanced)
If your instrument synthesizes its own sound (e.g., a Drum Machine or Synth) rather than just pushing an `AudioBuffer` to the core store:
- You must route your final `GainNode` output into `MixiEngine.getDeckChannel(deckId)`.
- Never route directly to `audioContext.destination`. Let the Mixi Core EQ and Crossfader handle your output.

## 3. Submitting to the Main Repository

To guarantee stability, new Decks and Instruments are rigorously reviewed and merged via **Pull Requests**.

1. Commit your self-contained component folder inside the `src/` tree.
2. Ensure your component strictly relies on CSS Variables (refer to `SKINS.md`) so it respects the user's currently selected Theme.
3. Open a PR to the `main` branch of the official GitHub mirror (`https://github.com/fabriziosalmi/mixi`). 
4. Include a detailed description of the memory footprint of your instrument, specifically documenting any WebGL canvas usage or heavy WebAudio scheduling (e.g., `setInterval` audio loops).

*Note: In the future, dynamic dropping of `.jsx`/`.tsx` plugins from the Desktop filesystem (`~/.mixi/plugins/`) will be supported. For now, we manually merge approved instruments into the core bundle to ensure aerospace-grade stability.*
