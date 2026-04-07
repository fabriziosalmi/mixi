/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// FX Unit shared state — bridges FxUnitPanel and PerformancePads
//
// Lightweight pub/sub for FX1/FX2 active state.
// Not in Zustand to avoid re-render overhead.
// ─────────────────────────────────────────────────────────────

import type { FxId } from '../../audio/nodes/DeckFx';
import type { DeckId } from '../../types';

export interface FxUnitSnapshot {
  selectedFx: FxId;
  amount: number;
  active: boolean;
}

type FxStateListener = () => void;

const state: Record<DeckId, { fx1: FxUnitSnapshot; fx2: FxUnitSnapshot }> = {
  A: { fx1: { selectedFx: 'dly', amount: 0.5, active: false }, fx2: { selectedFx: 'rev', amount: 0.5, active: false } },
  B: { fx1: { selectedFx: 'dly', amount: 0.5, active: false }, fx2: { selectedFx: 'rev', amount: 0.5, active: false } },
};

const listeners = new Set<FxStateListener>();

export const fxUnitState = {
  get(deckId: DeckId) { return state[deckId]; },

  set(deckId: DeckId, unit: 'fx1' | 'fx2', snap: Partial<FxUnitSnapshot>) {
    Object.assign(state[deckId][unit], snap);
    for (const fn of listeners) fn();
  },

  subscribe(fn: FxStateListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
