/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileInitGate — AudioContext initialization on user gesture
//
// iOS Safari and most mobile browsers require a user gesture
// (tap/click) to create/resume an AudioContext. This gate
// displays a full-screen "tap to start" overlay on first launch.
//
// Once tapped, it calls initEngine() from useMixiSync to:
//   1. Create the AudioContext
//   2. Wire the store↔engine subscriptions
//   3. Dismiss the gate
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, type FC, type ReactNode } from 'react';

interface MobileInitGateProps {
  onInit: () => Promise<void>;
  children: ReactNode;
}

export const MobileInitGate: FC<MobileInitGateProps> = ({ onInit, children }) => {
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleTap = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onInit();
    } catch {
      // Still proceed — some features may work without audio
    }
    setStarted(true);
  }, [onInit, loading]);

  if (started) return <>{children}</>;

  return (
    <div
      onClick={handleTap}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        cursor: 'pointer',
      }}
    >
      {/* MIXI logo */}
      <span
        style={{
          fontSize: 36,
          fontWeight: 900,
          color: '#333',
          letterSpacing: 12,
          fontFamily: 'var(--font-mono)',
        }}
      >
        MIXI
      </span>

      {/* Tap prompt */}
      <span
        style={{
          fontSize: 14,
          color: loading ? '#555' : '#888',
          fontFamily: 'var(--font-ui)',
          transition: 'color 200ms',
        }}
      >
        {loading ? 'Starting…' : 'Tap to start'}
      </span>

      {/* Subtle pulse ring */}
      {!loading && (
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            border: '1px solid #333',
            animation: 'mobileGatePulse 2s ease-in-out infinite',
          }}
        />
      )}

      <style>{`
        @keyframes mobileGatePulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.15); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};
