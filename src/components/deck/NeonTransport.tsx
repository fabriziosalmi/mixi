/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Neon Transport Buttons (Play, Sync)
//
// Ultra-premium transport controls with "neon tube" glow effect.
//
// Inactive: dark slate (#1e1e1e), muted icon (#666), no border.
// Active:   neon border, icon in deck colour, double box-shadow
//           (inner inset + outer spread) for diffused glow.
//
// The Play button is circular (CDJ-style).
// The Sync button is a rounded pill with an inline SVG icon.
// ─────────────────────────────────────────────────────────────

import { useCallback, type FC } from 'react';
import { useMidiStore } from '../../store/midiStore';

// ── Shared neon glow helper ─────────────────────────────────

function neonShadow(color: string, active: boolean): string {
  if (!active) return '0 2px 6px rgba(0,0,0,0.5)';
  return [
    `inset 0 0 8px ${color}22`,   // inner soft glow
    `0 0 6px ${color}33`,         // close outer
    `0 0 20px ${color}20`,        // diffused spread
  ].join(', ');
}

// ── Play Button ─────────────────────────────────────────────

interface PlayButtonProps {
  isPlaying: boolean;
  onToggle: () => void;
  color: string;
  size?: number;
  midiAction?: any;
}

export const NeonPlayButton: FC<PlayButtonProps> = ({
  isPlaying,
  onToggle,
  color,
  size = 52,
  midiAction,
}) => {
  const iconSize = size * 0.35;

  const handleClick = (e: React.MouseEvent) => {
    if (midiAction && (window as any).__MIXIMIDILEARN__ && useMidiStore.getState().isLearning) {
      e.preventDefault();
      e.stopPropagation();
      (window as any).__MIXIMIDILEARN__(midiAction);
      return;
    }
    onToggle();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={isPlaying ? 'Pause' : 'Play'}
      className="relative rounded-full flex items-center justify-center transition-all duration-150 mixi-btn focus:outline-none"
      style={{
        width: size,
        height: size,
        background: isPlaying
          ? `linear-gradient(145deg, var(--srf-raised), #141414)`
          : 'var(--srf-raised)',
        border: `1.5px solid ${isPlaying ? `${color}88` : 'var(--srf-light)'}`,
        boxShadow: neonShadow(color, isPlaying),
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        style={isPlaying ? { filter: `drop-shadow(0 0 4px ${color}88)` } : undefined}
      >
        {isPlaying ? (
          <>
            <rect x="5" y="3" width="5" height="18" rx="1" fill={color} />
            <rect x="14" y="3" width="5" height="18" rx="1" fill={color} />
          </>
        ) : (
          <polygon
            points="6,3 20,12 6,21"
            fill="var(--txt-secondary)"
            stroke="none"
          />
        )}
      </svg>
    </button>
  );
};

// ── Sync Button ─────────────────────────────────────────────

interface SyncButtonProps {
  isSynced: boolean;
  canSync: boolean;
  onToggle: () => void;
  color: string;
  size?: number;
  midiAction?: any;
}

export const NeonSyncButton: FC<SyncButtonProps> = ({
  isSynced,
  canSync,
  onToggle,
  color,
  size = 52,
  midiAction,
}) => {
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (midiAction && (window as any).__MIXIMIDILEARN__ && useMidiStore.getState().isLearning) {
      e.preventDefault();
      e.stopPropagation();
      (window as any).__MIXIMIDILEARN__(midiAction);
      return;
    }
    if (canSync) onToggle();
  }, [canSync, onToggle, midiAction]);

  const iconSize = size * 0.4;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canSync}
      title={isSynced ? 'Unsync' : 'Sync'}
      className="relative rounded-full flex items-center justify-center transition-all duration-150 mixi-btn disabled:opacity-20 disabled:cursor-not-allowed focus:outline-none"
      style={{
        width: size,
        height: size,
        background: isSynced
          ? `linear-gradient(145deg, var(--srf-raised), #141414)`
          : 'var(--srf-raised)',
        border: `1.5px solid ${isSynced ? `${color}88` : 'var(--srf-light)'}`,
        boxShadow: neonShadow(color, isSynced),
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        style={isSynced ? { filter: `drop-shadow(0 0 4px ${color}88)` } : undefined}
      >
        {isSynced ? (
          <>
            <path d="M4 12a8 8 0 0 1 14-5.3" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
            <path d="M20 12a8 8 0 0 1-14 5.3" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
            <polygon points="18,3 22,7 14,7" fill={color} />
            <polygon points="6,21 2,17 10,17" fill={color} />
          </>
        ) : (
          <>
            <path d="M4 12a8 8 0 0 1 14-5.3" fill="none" stroke="var(--txt-primary)" strokeWidth="2" strokeLinecap="round" />
            <path d="M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="var(--txt-primary)" strokeWidth="2" strokeLinecap="round" />
            <polygon points="18,3 22,7 14,7" fill="none" stroke="var(--txt-primary)" strokeWidth="2" strokeLinejoin="round" />
            <polygon points="6,21 2,17 10,17" fill="none" stroke="var(--txt-primary)" strokeWidth="2" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </button>
  );
};
