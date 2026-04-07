/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// FX Unit Panel — Traktor-style FX1/FX2 units
//
// Two independent FX units stacked vertically. Each has:
//   - Effect selector (cycle through 10 effects)
//   - Dry/wet amount knob
//   - ON/OFF toggle
//
// Routes to existing DeckFx via MixiEngine.setDeckFx().
// No audio engine changes — purely a UI abstraction.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { Knob } from '../controls/Knob';
import type { DeckId } from '../../types';
import type { FxId } from '../../audio/nodes/DeckFx';

// ── Effect registry ─────────────────────────────────────────

const FX_LIST: FxId[] = ['dly', 'rev', 'pha', 'flg', 'gate', 'crush', 'echo', 'tape', 'noise', 'flt'];
const FX_LABELS: Record<FxId, string> = {
  dly: 'DLY', rev: 'REV', pha: 'PHA', flg: 'FLG', gate: 'GATE',
  crush: 'CRU', echo: 'ECH', tape: 'TAPE', noise: 'NSE', flt: 'FLT',
};

// ── Single FX Unit ──────────────────────────────────────────

interface FxUnitProps {
  unitId: 'FX1' | 'FX2';
  deckId: DeckId;
  color: string;
}

const FxUnit: FC<FxUnitProps> = ({ unitId, deckId, color }) => {
  const [selectedIdx, setSelectedIdx] = useState(unitId === 'FX1' ? 0 : 1); // FX1=DLY, FX2=REV
  const [amount, setAmount] = useState(0.5);
  const [active, setActive] = useState(false);

  const amountRef = useRef(amount);
  useEffect(() => { amountRef.current = amount; }, [amount]);

  const selectedFx = FX_LIST[selectedIdx];
  const label = FX_LABELS[selectedFx];

  // Toggle ON/OFF
  const toggle = useCallback(() => {
    setActive((prev) => {
      const next = !prev;
      MixiEngine.getInstance().setDeckFx(deckId, selectedFx, amountRef.current, next);
      return next;
    });
  }, [deckId, selectedFx]);

  // Cycle effect selector
  const cycleEffect = useCallback(() => {
    setSelectedIdx((prev) => {
      const oldFx = FX_LIST[prev];
      const nextIdx = (prev + 1) % FX_LIST.length;
      const newFx = FX_LIST[nextIdx];
      const engine = MixiEngine.getInstance();
      // Deactivate old effect
      engine.setDeckFx(deckId, oldFx, 0, false);
      // Activate new effect if unit is ON
      if (active) {
        engine.setDeckFx(deckId, newFx, amountRef.current, true);
      }
      return nextIdx;
    });
  }, [deckId, active]);

  // Amount change
  const onAmountChange = useCallback((v: number) => {
    setAmount(v);
    if (active) {
      MixiEngine.getInstance().setDeckFx(deckId, selectedFx, v, true);
    }
  }, [deckId, selectedFx, active]);

  // Cleanup: deactivate on unmount
  useEffect(() => {
    return () => {
      MixiEngine.getInstance().setDeckFx(deckId, FX_LIST[selectedIdx], 0, false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isGate = selectedFx === 'gate';

  return (
    <div className="flex flex-col items-center gap-0.5 w-full">
      {/* Unit label + ON/OFF toggle */}
      <div className="flex items-center justify-between w-full px-0.5">
        <span className="text-[7px] font-bold tracking-wider"
          style={{ color: active ? color : 'var(--txt-muted)' }}>
          {unitId}
        </span>
        <button
          type="button"
          onClick={toggle}
          className="text-[6px] font-bold px-1 py-px rounded active:scale-90 transition-all"
          style={{
            color: active ? '#000' : 'var(--txt-muted)',
            background: active ? color : 'transparent',
            border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
            boxShadow: active ? `0 0 6px ${color}66` : 'none',
          }}
        >
          {active ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Effect selector — click to cycle */}
      <button
        type="button"
        onClick={cycleEffect}
        className="text-[9px] font-mono font-black tracking-wider w-full rounded py-0.5 transition-all active:scale-95"
        style={{
          color: active ? color : 'var(--txt-muted)',
          background: active ? `${color}15` : 'rgba(255,255,255,0.03)',
          border: `1px solid ${active ? color + '44' : 'rgba(255,255,255,0.06)'}`,
        }}
        title={`Click to cycle effect (current: ${label})`}
      >
        {label}
      </button>

      {/* Amount knob */}
      <Knob
        value={amount}
        min={0}
        max={isGate ? 4 : 1}
        onChange={onAmountChange}
        color={active ? color : 'var(--txt-muted)'}
        scale={0.55}
      />
    </div>
  );
};

// ── FX Unit Panel (two units stacked) ───────────────────────

export const FxUnitPanel: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => (
  <div
    className="mixi-fx-strip flex flex-col items-center gap-2 shrink-0 py-1.5 px-1 rounded-md bg-zinc-900/50"
    style={{
      width: 48,
      border: '1px solid rgba(255,255,255,0.04)',
      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.02)',
    }}
  >
    <FxUnit unitId="FX1" deckId={deckId} color={color} />

    {/* Divider */}
    <div className="w-6 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />

    <FxUnit unitId="FX2" deckId={deckId} color={color} />
  </div>
);
