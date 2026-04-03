/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – React Hook for AutoMixEngine
//
// Manages the AI engine lifecycle and provides reactive state.
// Registers all intents on first mount.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { AutoMixEngine, type AIEngineState } from './AutoMixEngine';
import { ALL_INTENTS } from './intents';

const INITIAL: AIEngineState = {
  enabled: false,
  activeIntents: [],
  blackboard: null,
  registeredCount: 0,
};

export function useAIEngine() {
  const [state, setState] = useState<AIEngineState>(INITIAL);

  useEffect(() => {
    const engine = AutoMixEngine.getInstance();

    // Register all known intents.
    engine.register(...ALL_INTENTS);

    const unsub = engine.subscribe(setState);
    // Push initial state.
    setState(engine.state);

    return () => {
      unsub();
      engine.stop();
    };
  }, []);

  const toggle = useCallback(() => {
    const engine = AutoMixEngine.getInstance();
    if (engine.enabled) {
      engine.stop();
    } else {
      engine.start();
    }
  }, []);

  return { state, toggle };
}
