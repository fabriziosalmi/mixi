/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – House Decks Registry
//
// Central registry of all "della casa" deck modules.
// Each entry maps a DeckMode string to its metadata and lazy
// component.  App.tsx and TrackLoader read this to render
// and offer the module picker.
// ─────────────────────────────────────────────────────────────

import { lazy, type LazyExoticComponent, type FC } from 'react';
import type { DeckId, DeckMode } from '../types';

/** Props every house-deck component receives. */
export interface HouseDeckProps {
  deckId: DeckId;
  color: string;
  onSwitchToTrack: () => void;
}

export interface HouseDeckEntry {
  /** Machine-readable mode key (must match DeckMode union). */
  mode: DeckMode;
  /** Short display label for the module picker. */
  label: string;
  /** Accent color used in the picker chip. */
  accentColor: string;
  /** Lazy-loaded React component (desktop). */
  component: LazyExoticComponent<FC<HouseDeckProps>>;
  /** Optional mobile-optimized component. If absent, mobile shows fallback. */
  mobileComponent?: LazyExoticComponent<FC<HouseDeckProps>>;
}

/**
 * All house decks, in display order.
 * To add a new deck: create its folder under src/decks/,
 * add its mode to DeckMode in types/audio.ts, and push an
 * entry here.
 */
export const HOUSE_DECKS: HouseDeckEntry[] = [
  {
    mode: 'groovebox',
    label: 'GROOVEBOX',
    accentColor: '#a855f7',
    component: lazy(() =>
      import('../groovebox/GrooveboxDeck').then((m) => ({ default: m.GrooveboxDeck })),
    ),
  },
  {
    mode: 'turbokick',
    label: 'TURBOKICK',
    accentColor: '#ef4444',
    component: lazy(() =>
      import('./turbokick/TurboKickDeck').then((m) => ({ default: m.TurboKickDeck })),
    ),
    mobileComponent: lazy(() =>
      import('./turbokick/TurboKickMobileDeck').then((m) => ({ default: m.TurboKickMobileDeck })),
    ),
  },
  {
    mode: 'js303',
    label: 'TURBOBASS',
    accentColor: '#00ff88',
    component: lazy(() =>
      import('./turbobass/JS303Deck').then((m) => ({ default: m.JS303Deck })),
    ),
  },

  // ── Community Decks (from mixi-decks repo, bundled at build time) ──

  { mode: 'turbo-boid', label: 'TURBOBOID', accentColor: '#ff6b9d',
    component: lazy(() => import('./community/TurboBoid/TurboBoidDeck').then(m => ({ default: m.TurboBoidDeck }))) },
  { mode: 'turbo-brain', label: 'TURBOBRAIN', accentColor: '#c084fc',
    component: lazy(() => import('./community/TurboBrain/TurboBrainDeck').then(m => ({ default: m.TurboBrainDeck }))) },
  { mode: 'turbo-cam', label: 'TURBOCAM', accentColor: '#34d399',
    component: lazy(() => import('./community/TurboCam/TurboCamDeck').then(m => ({ default: m.TurboCamDeck }))) },
  { mode: 'turbo-fm', label: 'TURBO FM', accentColor: '#f97316',
    component: lazy(() => import('./community/TurboFM/TurboFMDeck').then(m => ({ default: m.TurboFMDeck }))) },
  { mode: 'turbo-fire', label: 'TURBOFIRE', accentColor: '#ef4444',
    component: lazy(() => import('./community/TurboFire/TurboFireDeck').then(m => ({ default: m.TurboFireDeck }))) },
  { mode: 'turbo-fractal', label: 'TURBOFRACTAL', accentColor: '#8b5cf6',
    component: lazy(() => import('./community/TurboFractal/TurboFractalDeck').then(m => ({ default: m.TurboFractalDeck }))) },
  { mode: 'turbo-geiger', label: 'TURBOGEIGER', accentColor: '#fbbf24',
    component: lazy(() => import('./community/TurboGeiger/TurboGeigerDeck').then(m => ({ default: m.TurboGeigerDeck }))) },
  { mode: 'turbo-genome', label: 'TURBOGENOME', accentColor: '#10b981',
    component: lazy(() => import('./community/TurboGenome/TurboGenomeDeck').then(m => ({ default: m.TurboGenomeDeck }))) },
  { mode: 'turbo-morse', label: 'TURBOMORSE', accentColor: '#06b6d4',
    component: lazy(() => import('./community/TurboMorse/TurboMorseDeck').then(m => ({ default: m.TurboMorseDeck }))) },
  { mode: 'turbo-nature', label: 'TURBONATURE', accentColor: '#4ade80',
    component: lazy(() => import('./community/TurboNature/TurboNatureDeck').then(m => ({ default: m.TurboNatureDeck }))) },
  { mode: 'turbo-news', label: 'TURBONEWS', accentColor: '#6366f1',
    component: lazy(() => import('./community/TurboNews/TurboNewsDeck').then(m => ({ default: m.TurboNewsDeck }))) },
  { mode: 'turbo-pulsar', label: 'TURBOPULSAR', accentColor: '#a78bfa',
    component: lazy(() => import('./community/TurboPulsar/TurboPulsarDeck').then(m => ({ default: m.TurboPulsarDeck }))) },
  { mode: 'turbo-sonar', label: 'TURBOSONAR', accentColor: '#22d3ee',
    component: lazy(() => import('./community/TurboSonar/TurboSonarDeck').then(m => ({ default: m.TurboSonarDeck }))) },
  { mode: 'turbo-synth', label: 'TURBOSYNTH', accentColor: '#f472b6',
    component: lazy(() => import('./community/TurboSynth/TurboSynthDeck').then(m => ({ default: m.TurboSynthDeck }))) },
  { mode: 'turbo-vox', label: 'TURBOVOX', accentColor: '#fb923c',
    component: lazy(() => import('./community/TurboVox/TurboVoxDeck').then(m => ({ default: m.TurboVoxDeck }))) },
  { mode: 'turbo-weather', label: 'TURBOWEATHER', accentColor: '#2dd4bf',
    component: lazy(() => import('./community/TurboWeather/TurboWeatherDeck').then(m => ({ default: m.TurboWeatherDeck }))) },
];
