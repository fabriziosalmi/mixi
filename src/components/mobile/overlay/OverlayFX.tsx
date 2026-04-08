/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// OverlayFX — Mobile FX panel (master filter + per-deck FX grid)
//
// Provides:
//   - Master filter knob (low-pass ← 0 → high-pass)
//   - Master distortion knob
//   - Master punch knob
//   - Per-deck FX on/off grid (tap to toggle, hold to adjust amount)
// ─────────────────────────────────────────────────────────────

import { useCallback, type FC } from 'react';
import { useMixiStore } from '../../../store/mixiStore';
import { MixiEngine } from '../../../audio/MixiEngine';
import { Knob } from '../../controls/Knob';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../../theme';
import { useHaptics } from '../../../hooks/useHaptics';
import type { DeckId } from '../../../types';

interface OverlayFXProps {
  deckId: DeckId;
}

const FX_LIST: { id: string; label: string }[] = [
  { id: 'flt', label: 'FLT' },
  { id: 'dly', label: 'DLY' },
  { id: 'rev', label: 'REV' },
  { id: 'echo', label: 'ECHO' },
  { id: 'pha', label: 'PHA' },
  { id: 'flg', label: 'FLG' },
  { id: 'gate', label: 'GATE' },
  { id: 'crush', label: 'CRSH' },
];

export const OverlayFX: FC<OverlayFXProps> = ({ deckId }) => {
  const color = deckId === 'A' ? COLOR_DECK_A : COLOR_DECK_B;

  const masterFilter = useMixiStore((s) => s.master.filter);
  const masterDistortion = useMixiStore((s) => s.master.distortion);
  const masterPunch = useMixiStore((s) => s.master.punch);
  const setMasterFilter = useMixiStore((s) => s.setMasterFilter);
  const setMasterDistortion = useMixiStore((s) => s.setMasterDistortion);
  const setMasterPunch = useMixiStore((s) => s.setMasterPunch);
  const haptics = useHaptics();

  const toggleFx = useCallback((fxId: string) => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;
    // Toggle: if amount > 0 → off, else → on at 0.5
    // We need to track state — for simplicity, always set to 0.5 on activate
    // The engine handles the rest
    haptics.tick();
    engine.setDeckFx(deckId, fxId, 0.5, true);
  }, [deckId, haptics]);

  const resetFx = useCallback((fxId: string) => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;
    haptics.snap();
    engine.setDeckFx(deckId, fxId, 0, false);
  }, [deckId, haptics]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Master FX knobs */}
      <div>
        <div style={{ fontSize: 9, color: '#555', fontFamily: 'var(--font-mono)', marginBottom: 8, letterSpacing: 2 }}>
          MASTER
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8 }}>
          <Knob
            value={masterFilter}
            min={-1}
            max={1}
            onChange={setMasterFilter}
            label="FILTER"
            bipolar
            center={0}
            color="#a855f7"
            scale={1.4}
          />
          <Knob
            value={masterDistortion}
            min={0}
            max={1}
            onChange={setMasterDistortion}
            label="DIST"
            color="#a855f7"
            scale={1.4}
          />
          <Knob
            value={masterPunch}
            min={0}
            max={1}
            onChange={setMasterPunch}
            label="PUNCH"
            color="#a855f7"
            scale={1.4}
          />
        </div>
      </div>

      {/* Per-deck FX grid */}
      <div>
        <div style={{ fontSize: 9, color: '#555', fontFamily: 'var(--font-mono)', marginBottom: 8, letterSpacing: 2 }}>
          DECK {deckId} FX
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {FX_LIST.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => toggleFx(id)}
              onDoubleClick={() => resetFx(id)}
              style={{
                height: 48,
                border: `1px solid ${color}44`,
                borderRadius: 6,
                background: '#151515',
                color: color,
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 8, color: '#444', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
          TAP = ON &nbsp; DOUBLE-TAP = OFF
        </div>
      </div>
    </div>
  );
};
