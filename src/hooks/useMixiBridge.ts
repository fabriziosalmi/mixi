/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – React Hook for MCP WebSocket Bridge
//
// Activates the WebSocket connection to the Python backend.
// The AI agent can then send commands to control the mixer.
//
// Call once at the app root, after the audio engine is ready.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { MixiBridge } from '../bridge/MixiBridge';

export function useMixiBridge() {
  const bridgeRef = useRef<MixiBridge | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const bridge = new MixiBridge();
    bridgeRef.current = bridge;
    bridge.connect();

    // Poll connection status (WebSocket has no reactive state).
    const interval = setInterval(() => {
      const now = bridge.isConnected;
      setConnected((prev) => prev === now ? prev : now);
    }, 1000);

    return () => {
      clearInterval(interval);
      bridge.disconnect();
      bridgeRef.current = null;
    };
  }, []);

  return { connected };
}
