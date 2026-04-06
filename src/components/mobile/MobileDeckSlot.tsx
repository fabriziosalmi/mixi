/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileDeckSlot — Mobile deck mode router
//
// Routes to the appropriate mobile component based on deck mode:
//   - 'track'      → returns null (layout handles track UI inline)
//   - custom deck   → lazy-loads mobileComponent if available
//   - no mobile ver → shows fallback with "back to track" button
// ─────────────────────────────────────────────────────────────

import { Suspense, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { HOUSE_DECKS } from '../../decks';
import type { DeckId } from '../../types';

interface MobileDeckSlotProps {
  deckId: DeckId;
  color: string;
}

export const MobileDeckSlot: FC<MobileDeckSlotProps> = ({ deckId, color }) => {
  const mode = useMixiStore((s) => s.deckModes[deckId]);
  const setDeckMode = useMixiStore((s) => s.setDeckMode);

  // Track mode → handled by the layout (DeckRow / DeckCard)
  if (mode === 'track') return null;

  const deck = HOUSE_DECKS.find((d) => d.mode === mode);

  // Has mobile component → lazy render
  if (deck?.mobileComponent) {
    const Comp = deck.mobileComponent;
    return (
      <Suspense fallback={<div style={{ height: 120, background: '#0a0a0a' }} />}>
        <Comp
          deckId={deckId}
          color={color}
          onSwitchToTrack={() => setDeckMode(deckId, 'track')}
        />
      </Suspense>
    );
  }

  // No mobile component → fallback
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 20,
        background: '#111',
        borderRadius: 8,
        border: `1px solid ${deck?.accentColor ?? '#444'}33`,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: deck?.accentColor ?? '#888',
          fontFamily: 'var(--font-mono)',
          letterSpacing: 2,
        }}
      >
        {deck?.label ?? mode.toUpperCase()}
      </span>
      <span style={{ fontSize: 11, color: '#555' }}>
        Not available on mobile yet
      </span>
      <button
        onClick={() => setDeckMode(deckId, 'track')}
        style={{
          height: 32,
          padding: '0 16px',
          border: '1px solid #444',
          borderRadius: 4,
          background: '#1a1a1a',
          color: '#999',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        TRACK PLAYER
      </button>
    </div>
  );
};
