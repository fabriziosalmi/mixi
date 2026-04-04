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
  /** Lazy-loaded React component. */
  component: LazyExoticComponent<FC<HouseDeckProps>>;
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
  },
  {
    mode: 'js303',
    label: 'JS-303',
    accentColor: '#00ff88',
    component: lazy(() =>
      import('./turbo303/JS303Deck').then((m) => ({ default: m.JS303Deck })),
    ),
  },
];
