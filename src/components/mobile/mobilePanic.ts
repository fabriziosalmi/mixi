/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// mobilePanic — Emergency reset for mobile
//
// Same logic as the desktop panic handler in App.tsx:
//   - Reset EQ flat, gain to 0, color FX off
//   - Exit all loops
//   - Reset all per-deck FX
//   - Reset master filter/distortion/punch
//   - Center crossfader
//
// Extracted as a standalone function so it can be called from:
//   - Shake-to-panic (MobileApp.tsx)
//   - PANIC button (MobileLandscape / MobilePortrait)
// ─────────────────────────────────────────────────────────────

import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import type { DeckId } from '../../types';

const FX_IDS = ['flt', 'dly', 'rev', 'pha', 'flg', 'gate', 'crush', 'echo', 'tape', 'noise'] as const;

export function mobilePanic(): void {
  const store = useMixiStore.getState();
  const engine = MixiEngine.getInstance();

  for (const d of ['A', 'B'] as DeckId[]) {
    // Reset EQ flat
    store.setDeckEq(d, 'high', 0);
    store.setDeckEq(d, 'mid', 0);
    store.setDeckEq(d, 'low', 0);

    // Reset gain & color FX
    store.setDeckGain(d, 0);
    store.setDeckColorFx(d, 0);

    // Exit loops
    if (store.decks[d].activeLoop) store.exitLoop(d);
  }

  // Reset per-deck FX via engine
  if (engine.isInitialized) {
    for (const d of ['A', 'B'] as DeckId[]) {
      for (const fx of FX_IDS) {
        engine.setDeckFx(d, fx, 0, false);
      }
    }
  }

  // Reset master controls
  store.setMasterFilter(0);
  store.setMasterDistortion(0);
  store.setMasterPunch(0);

  // Center crossfader
  store.setCrossfader(0.5);
}
