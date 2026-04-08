/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileInitGate — Premium splash + AudioContext init on tap
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
        gap: 32,
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {/* Background radial glow */}
      <div
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,240,255,0.04) 0%, rgba(168,85,247,0.02) 40%, transparent 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      {/* Spinning vinyl rings */}
      {!loading && (
        <div style={{ position: 'relative', width: 120, height: 120 }}>
          {/* Outer ring — slow spin */}
          <svg
            width="120" height="120" viewBox="0 0 120 120"
            style={{
              position: 'absolute',
              animation: 'm-gate-vinyl-spin 8s linear infinite',
            }}
          >
            <circle cx="60" cy="60" r="56" fill="none" stroke="#ffffff08" strokeWidth="0.5" />
            <circle cx="60" cy="60" r="48" fill="none" stroke="#ffffff06" strokeWidth="0.5" />
            <circle cx="60" cy="60" r="40" fill="none" stroke="#ffffff04" strokeWidth="0.5" />
            <circle cx="60" cy="60" r="32" fill="none" stroke="#ffffff06" strokeWidth="0.5" />
            {/* Groove lines */}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <line
                key={deg}
                x1="60" y1="8" x2="60" y2="16"
                stroke="#ffffff0a"
                strokeWidth="0.5"
                transform={`rotate(${deg} 60 60)`}
              />
            ))}
          </svg>

          {/* Inner ring — counter spin */}
          <svg
            width="60" height="60" viewBox="0 0 60 60"
            style={{
              position: 'absolute',
              left: 30,
              top: 30,
              animation: 'm-gate-vinyl-spin 4s linear infinite reverse',
            }}
          >
            <circle cx="30" cy="30" r="26" fill="none" stroke="#00f0ff11" strokeWidth="1" />
            <circle cx="30" cy="30" r="18" fill="none" stroke="#00f0ff08" strokeWidth="0.5" />
            <circle cx="30" cy="30" r="4" fill="#00f0ff22" stroke="none" />
          </svg>

          {/* Expanding pulse rings */}
          <div
            style={{
              position: 'absolute',
              inset: -20,
              borderRadius: '50%',
              border: '1px solid #00f0ff11',
              animation: 'm-gate-rings 3s ease-out infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: -20,
              borderRadius: '50%',
              border: '1px solid #ff6a0011',
              animation: 'm-gate-rings 3s ease-out infinite 1.5s',
            }}
          />
        </div>
      )}

      {/* MIXI logo with shimmer */}
      <span
        style={{
          fontSize: 42,
          fontWeight: 900,
          letterSpacing: 16,
          fontFamily: 'var(--font-mono)',
          background: loading
            ? '#444'
            : 'linear-gradient(135deg, #00f0ff 0%, #a855f7 50%, #ff6a00 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          animation: loading ? 'none' : 'm-gate-shimmer 4s ease-in-out infinite',
          filter: loading ? 'none' : 'drop-shadow(0 0 20px rgba(0,240,255,0.15))',
        }}
      >
        MIXI
      </span>

      {/* Tap prompt */}
      <span
        style={{
          fontSize: 13,
          color: loading ? '#444' : '#666',
          fontFamily: 'var(--font-ui)',
          letterSpacing: 4,
          transition: 'color 200ms',
        }}
      >
        {loading ? 'STARTING…' : 'TAP TO START'}
      </span>

      {/* Loading spinner */}
      {loading && (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: '2px solid #333',
            borderTopColor: '#00f0ff',
            animation: 'mobileLoaderSpin 800ms linear infinite',
          }}
        />
      )}

      <style>{`
        @keyframes mobileLoaderSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
