/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// OverlayEQ — Mobile EQ panel (3-band + kill + gain + color FX)
//
// Reuses the desktop Knob component with scale={1.4} for
// touch-friendly 67px knobs. All store actions are identical
// to the desktop mixer — zero duplicated logic.
// ─────────────────────────────────────────────────────────────

import { useCallback, useState, type FC } from 'react';
import { useMixiStore } from '../../../store/mixiStore';
import { Knob } from '../../controls/Knob';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../../theme';
import type { DeckId } from '../../../types';

interface OverlayEQProps {
  deckId: DeckId;
}

const EQ_MIN = -32;
const EQ_MAX = 12;
const GAIN_MIN = -12;
const GAIN_MAX = 12;

type EqBand = 'high' | 'mid' | 'low';

const BANDS: { band: EqBand; label: string }[] = [
  { band: 'high', label: 'HI' },
  { band: 'mid', label: 'MID' },
  { band: 'low', label: 'LO' },
];

export const OverlayEQ: FC<OverlayEQProps> = ({ deckId }) => {
  const color = deckId === 'A' ? COLOR_DECK_A : COLOR_DECK_B;

  const eq = useMixiStore((s) => s.decks[deckId].eq);
  const gain = useMixiStore((s) => s.decks[deckId].gain);
  const colorFx = useMixiStore((s) => s.decks[deckId].colorFx);
  const setDeckEq = useMixiStore((s) => s.setDeckEq);
  const setDeckGain = useMixiStore((s) => s.setDeckGain);
  const setDeckColorFx = useMixiStore((s) => s.setDeckColorFx);

  // Kill state (saved values per band)
  const [killed, setKilled] = useState<Record<EqBand, number | null>>({ high: null, mid: null, low: null });

  const toggleKill = useCallback(
    (band: EqBand) => {
      const saved = killed[band];
      if (saved !== null) {
        // Un-kill: restore saved value
        setDeckEq(deckId, band, saved);
        setKilled(k => ({ ...k, [band]: null }));
      } else {
        // Kill: save current, cut to min
        setKilled(k => ({ ...k, [band]: eq[band] }));
        setDeckEq(deckId, band, EQ_MIN);
      }
    },
    [deckId, eq, setDeckEq, killed],
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-around',
        gap: 8,
        padding: '8px 0',
      }}
    >
      {/* EQ bands */}
      {BANDS.map(({ band, label }) => (
        <div key={band} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Knob
            value={eq[band]}
            min={EQ_MIN}
            max={EQ_MAX}
            onChange={(v) => {
              setDeckEq(deckId, band, v);
              // Un-kill if user moves knob while killed
              if (killed[band] !== null) killed[band] = null;
            }}
            label={label}
            bipolar
            center={0}
            color={color}
            scale={1.4}
          />
          <button
            onClick={() => toggleKill(band)}
            style={{
              width: 40,
              height: 24,
              border: `1px solid ${killed[band] !== null ? '#ef4444' : '#444'}`,
              borderRadius: 3,
              background: killed[band] !== null ? '#ef444433' : 'transparent',
              color: killed[band] !== null ? '#ef4444' : '#666',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            KILL
          </button>
        </div>
      ))}

      {/* Separator */}
      <div style={{ width: 1, height: 80, background: '#222', flexShrink: 0 }} />

      {/* Gain */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <Knob
          value={gain}
          min={GAIN_MIN}
          max={GAIN_MAX}
          onChange={(v) => setDeckGain(deckId, v)}
          label="GAIN"
          bipolar
          center={0}
          color={color}
          scale={1.4}
        />
      </div>

      {/* Color FX */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <Knob
          value={colorFx}
          min={-1}
          max={1}
          onChange={(v) => setDeckColorFx(deckId, v)}
          label="FX"
          bipolar
          center={0}
          color={color}
          scale={1.4}
        />
      </div>
    </div>
  );
};
