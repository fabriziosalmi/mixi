/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// FX Unit Panel — Traktor-style FX1/FX2 (selector + knob only)
//
// ON/OFF buttons are in PerformancePads (same group as Q button).
// This panel shows: effect name selector + amount knob.
// State shared via fxUnitState.ts pub/sub.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { Knob } from '../controls/Knob';
import { fxUnitState } from './fxUnitState';
import type { DeckId } from '../../types';
import type { FxId } from '../../audio/nodes/DeckFx';

const FX_LIST: FxId[] = ['dly', 'rev', 'pha', 'flg', 'gate', 'crush', 'echo', 'tape', 'noise', 'flt'];
const FX_LABELS: Record<FxId, string> = {
  dly: 'DLY', rev: 'REV', pha: 'PHA', flg: 'FLG', gate: 'GATE',
  crush: 'CRU', echo: 'ECH', tape: 'TAPE', noise: 'NSE', flt: 'FLT',
};

interface FxUnitProps {
  unitKey: 'fx1' | 'fx2';
  deckId: DeckId;
  color: string;
}

const FxUnit: FC<FxUnitProps> = ({ unitKey, deckId, color }) => {
  const [selectedIdx, setSelectedIdx] = useState(unitKey === 'fx1' ? 0 : 1);
  const [amount, setAmount] = useState(0.5);
  const [active, setActive] = useState(false);

  const amountRef = useRef(amount);
  useEffect(() => { amountRef.current = amount; }, [amount]);

  const selectedFx = FX_LIST[selectedIdx];
  const label = FX_LABELS[selectedFx];

  // Sync to shared state
  useEffect(() => {
    fxUnitState.set(deckId, unitKey, { selectedFx, amount, active });
  }, [deckId, unitKey, selectedFx, amount, active]);

  // Listen for external toggle (from PerformancePads buttons)
  useEffect(() => {
    return fxUnitState.subscribe(() => {
      const snap = fxUnitState.get(deckId)[unitKey];
      if (snap.active !== active) {
        setActive(snap.active);
        MixiEngine.getInstance().setDeckFx(deckId, selectedFx, amountRef.current, snap.active);
      }
    });
  }, [deckId, unitKey, selectedFx, active]);

  // Cycle effect selector
  const cycleEffect = useCallback(() => {
    setSelectedIdx((prev) => {
      const oldFx = FX_LIST[prev];
      const nextIdx = (prev + 1) % FX_LIST.length;
      const newFx = FX_LIST[nextIdx];
      const engine = MixiEngine.getInstance();
      engine.setDeckFx(deckId, oldFx, 0, false);
      if (active) {
        engine.setDeckFx(deckId, newFx, amountRef.current, true);
      }
      fxUnitState.set(deckId, unitKey, { selectedFx: newFx });
      return nextIdx;
    });
  }, [deckId, unitKey, active]);

  // Amount change
  const onAmountChange = useCallback((v: number) => {
    setAmount(v);
    fxUnitState.set(deckId, unitKey, { amount: v });
    if (active) {
      MixiEngine.getInstance().setDeckFx(deckId, selectedFx, v, true);
    }
  }, [deckId, unitKey, selectedFx, active]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      MixiEngine.getInstance().setDeckFx(deckId, FX_LIST[selectedIdx], 0, false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isGate = selectedFx === 'gate';

  return (
    <div className="flex flex-col items-center gap-0.5 w-full">
      {/* Unit label */}
      <span className="text-[6px] font-bold tracking-widest"
        style={{ color: active ? color : 'var(--txt-muted)' }}>
        {unitKey.toUpperCase()}
      </span>

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

export const FxUnitPanel: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => (
  <div
    className="mixi-fx-strip flex flex-col items-center gap-2 shrink-0 py-1.5 px-1 rounded-lg"
    style={{
      width: 48,
      background: 'rgba(20,20,22,0.7)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.02)',
    }}
  >
    <FxUnit unitKey="fx1" deckId={deckId} color={color} />
    <div className="w-6 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
    <FxUnit unitKey="fx2" deckId={deckId} color={color} />
  </div>
);
