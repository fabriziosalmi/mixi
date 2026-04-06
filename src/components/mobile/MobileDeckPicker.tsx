/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileDeckPicker — Compact deck mode selector for mobile
//
// Shows current deck mode as a tappable chip. On tap, expands
// to show available modes. Highlights which modes have mobile
// support via the mobileComponent field.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { HOUSE_DECKS } from '../../decks';
import type { DeckId, DeckMode } from '../../types';

interface MobileDeckPickerProps {
  deckId: DeckId;
}

export const MobileDeckPicker: FC<MobileDeckPickerProps> = ({ deckId }) => {
  const [open, setOpen] = useState(false);
  const mode = useMixiStore((s) => s.deckModes[deckId]);
  const setDeckMode = useMixiStore((s) => s.setDeckMode);

  const currentDeck = HOUSE_DECKS.find((d) => d.mode === mode);
  const currentLabel = mode === 'track' ? 'TRACK' : (currentDeck?.label ?? mode.toUpperCase());
  const currentColor = mode === 'track' ? '#888' : (currentDeck?.accentColor ?? '#888');

  const selectMode = useCallback(
    (m: DeckMode) => {
      setDeckMode(deckId, m);
      setOpen(false);
    },
    [deckId, setDeckMode],
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          height: 22,
          padding: '0 6px',
          border: `1px solid ${currentColor}66`,
          borderRadius: 3,
          background: `${currentColor}15`,
          color: currentColor,
          fontSize: 9,
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          whiteSpace: 'nowrap',
        }}
      >
        {currentLabel}
      </button>
    );
  }

  // Expanded picker
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}
      />

      {/* Picker card */}
      <div
        style={{
          position: 'relative',
          background: '#111',
          borderRadius: 8,
          border: '1px solid #333',
          padding: 12,
          minWidth: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ fontSize: 10, color: '#555', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
          DECK {deckId} MODE
        </div>

        {/* Track option */}
        <PickerOption
          label="TRACK"
          color="#888"
          active={mode === 'track'}
          hasMobile
          onSelect={() => selectMode('track')}
        />

        {/* House decks */}
        {HOUSE_DECKS.map((deck) => (
          <PickerOption
            key={deck.mode}
            label={deck.label}
            color={deck.accentColor}
            active={mode === deck.mode}
            hasMobile={!!deck.mobileComponent}
            onSelect={() => selectMode(deck.mode)}
          />
        ))}
      </div>
    </div>
  );
};

// ── Picker option ────────────────────────────────────────────

const PickerOption: FC<{
  label: string;
  color: string;
  active: boolean;
  hasMobile: boolean;
  onSelect: () => void;
}> = ({ label, color, active, hasMobile, onSelect }) => (
  <button
    onClick={onSelect}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 40,
      padding: '0 12px',
      border: `1px solid ${active ? color : '#333'}`,
      borderRadius: 6,
      background: active ? `${color}22` : '#1a1a1a',
      color: active ? color : (hasMobile ? '#aaa' : '#555'),
      fontSize: 12,
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      cursor: 'pointer',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
      width: '100%',
      textAlign: 'left',
    }}
  >
    <span style={{ flex: 1 }}>{label}</span>
    {hasMobile && (
      <span style={{ fontSize: 8, color: '#4ade80', border: '1px solid #4ade8044', borderRadius: 2, padding: '1px 4px' }}>
        MOBILE
      </span>
    )}
    {!hasMobile && label !== 'TRACK' && (
      <span style={{ fontSize: 8, color: '#666' }}>DESKTOP</span>
    )}
  </button>
);
