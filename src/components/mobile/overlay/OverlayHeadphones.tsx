/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// OverlayHeadphones — Mobile headphone / PFL controls
//
// Provides:
//   - PFL/CUE toggle per deck (A / B)
//   - Headphone level knob
//   - Cue/Master mix knob
//   - Split mode toggle
// ─────────────────────────────────────────────────────────────

import { useCallback, type FC } from 'react';
import { useMixiStore } from '../../../store/mixiStore';
import { Knob } from '../../controls/Knob';
import { COLOR_DECK_A, COLOR_DECK_B, COLOR_HP } from '../../../theme';
import { useHaptics } from '../../../hooks/useHaptics';
import type { DeckId } from '../../../types';

export const OverlayHeadphones: FC = () => {
  const hpLevel = useMixiStore((s) => s.headphones.level);
  const hpMix = useMixiStore((s) => s.headphones.mix);
  const splitMode = useMixiStore((s) => s.headphones.splitMode);
  const cueA = useMixiStore((s) => s.decks.A.cueActive);
  const cueB = useMixiStore((s) => s.decks.B.cueActive);
  const setHpLevel = useMixiStore((s) => s.setHeadphoneLevel);
  const setHpMix = useMixiStore((s) => s.setHeadphoneMix);
  const toggleSplitMode = useMixiStore((s) => s.toggleSplitMode);
  const toggleCueStore = useMixiStore((s) => s.toggleCue);
  const haptics = useHaptics();

  const toggleCue = useCallback((deck: DeckId) => {
    toggleCueStore(deck);
    haptics.tick();
  }, [toggleCueStore, haptics]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* PFL / CUE buttons */}
      <div>
        <div style={{ fontSize: 9, color: '#555', fontFamily: 'var(--font-mono)', marginBottom: 8, letterSpacing: 2 }}>
          CUE / PFL
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['A', 'B'] as DeckId[]).map((d) => {
            const active = d === 'A' ? cueA : cueB;
            const color = d === 'A' ? COLOR_DECK_A : COLOR_DECK_B;
            return (
              <button
                key={d}
                onClick={() => toggleCue(d)}
                style={{
                  flex: 1,
                  height: 48,
                  border: `2px solid ${active ? color : '#333'}`,
                  borderRadius: 8,
                  background: active ? `${color}22` : '#151515',
                  color: active ? color : '#666',
                  fontSize: 14,
                  fontWeight: 900,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 9, opacity: 0.6 }}>CUE</span>
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {/* Level + Mix knobs */}
      <div style={{ display: 'flex', justifyContent: 'space-around', gap: 16 }}>
        <Knob
          value={hpLevel}
          min={0}
          max={1}
          onChange={setHpLevel}
          label="LEVEL"
          color={COLOR_HP}
          scale={1.4}
        />
        <Knob
          value={hpMix}
          min={0}
          max={1}
          onChange={setHpMix}
          label="CUE/MST"
          color={COLOR_HP}
          scale={1.4}
        />
      </div>

      {/* Split mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 10, color: '#888', fontFamily: 'var(--font-mono)' }}>
            SPLIT MODE
          </span>
          <div style={{ fontSize: 8, color: '#555', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            L=CUE R=MASTER
          </div>
        </div>
        <button
          aria-label="Toggle split mode"
          onClick={() => { toggleSplitMode(); haptics.snap(); }}
          style={{
            width: 48,
            height: 28,
            borderRadius: 14,
            border: 'none',
            background: splitMode ? '#a855f7' : '#333',
            position: 'relative',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            transition: 'background 150ms',
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: 3,
              left: splitMode ? 23 : 3,
              transition: 'left 150ms',
            }}
          />
        </button>
      </div>
    </div>
  );
};
