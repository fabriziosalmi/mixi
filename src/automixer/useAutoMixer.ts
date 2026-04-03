/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – React Hook for AutoMixer
//
// Provides a singleton AutoMixer instance and reactive state.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { AutoMixer } from './AutoMixer';
import type { AutoMixState } from './types';

const INITIAL_STATE: AutoMixState = {
  enabled: false,
  intent: 'MONITORING',
  roles: { outgoing: 'A', incoming: 'B' },
  progress: 0,
  intentStartBeat: 0,
};

export function useAutoMixer() {
  const [mixer] = useState(() => new AutoMixer());
  const [state, setState] = useState<AutoMixState>(INITIAL_STATE);

  useEffect(() => {
    const unsub = mixer.subscribe(setState);
    return () => {
      unsub();
      mixer.stop();
    };
  }, [mixer]);

  const toggle = useCallback(() => {
    if (mixer.state.enabled) {
      mixer.stop();
    } else {
      mixer.start();
    }
  }, [mixer]);

  return { state, toggle };
}
