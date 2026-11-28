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
  color: _color,
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

  const playRingColor = isPlaying ? 'var(--status-ok, #22c55e)' : 'rgba(74, 222, 128, 0.35)';

  return (
    <button
      type="button"
      onClick={handleClick}
      title={isPlaying ? 'Pause' : 'Play'}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      aria-pressed={isPlaying}
      className="relative rounded-full flex items-center justify-center transition-all duration-150 mixi-btn focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      style={{
        width: size,
        height: size,
        background: isPlaying
          ? 'radial-gradient(circle at 50% 35%, #232826, #121514)'
          : 'radial-gradient(circle at 50% 30%, #222328, #141418)',
        border: `2px solid ${playRingColor}`,
        boxShadow: isPlaying
          ? 'inset 0 0 12px rgba(74, 222, 128, 0.22), 0 0 10px rgba(74, 222, 128, 0.35), 0 0 24px rgba(74, 222, 128, 0.16)'
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.65)',
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        style={isPlaying ? { filter: 'drop-shadow(0 0 5px rgba(74, 222, 128, 0.75))' } : undefined}
      >
        {isPlaying ? (
          <>
            <rect x="5" y="3" width="5" height="18" rx="1" fill="var(--status-ok, #4ade80)" />
            <rect x="14" y="3" width="5" height="18" rx="1" fill="var(--status-ok, #4ade80)" />
          </>
        ) : (
          <polygon
            points="6,3 20,12 6,21"
            fill="var(--txt-bright)"
            stroke="none"
          />
        )}
      </svg>
    </button>
  );
};

// ── CDJ Cue Button (Sacred left-of-Play hardware button) ────

interface CueButtonProps {
  hasCue: boolean;
  isPreviewing: boolean;
  disabled?: boolean;
  onPointerDown: () => void;
  onPointerUp: () => void;
  size?: number;
  midiAction?: any;
}

export const NeonCueButton: FC<CueButtonProps> = ({
  hasCue,
  isPreviewing,
  disabled = false,
  onPointerDown,
  onPointerUp,
  size = 72,
  midiAction,
}) => {
  const cueColor = 'var(--clr-cue, #f59e0b)';
  const ringColor = isPreviewing
    ? cueColor
    : hasCue
      ? 'rgba(245, 158, 11, 0.78)'
      : 'rgba(245, 158, 11, 0.35)';

  const handleDown = (e: React.PointerEvent) => {
    if (disabled) return;
    if (midiAction && (window as any).__MIXIMIDILEARN__ && useMidiStore.getState().isLearning) {
      e.preventDefault();
      e.stopPropagation();
      (window as any).__MIXIMIDILEARN__(midiAction);
      return;
    }
    onPointerDown();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={handleDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerCancel={onPointerUp}
      title="CUE — Playing: return to cue & pause. Paused: set cue or hold to preview."
      aria-label="Cue"
      aria-pressed={isPreviewing}
      className="relative rounded-full flex items-center justify-center transition-all duration-150 mixi-btn disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 select-none touch-none"
      style={{
        width: size,
        height: size,
        background: isPreviewing
          ? 'radial-gradient(circle at 50% 35%, #2b2416, #16120b)'
          : 'radial-gradient(circle at 50% 30%, #222328, #141418)',
        border: `2px solid ${ringColor}`,
        boxShadow: isPreviewing
          ? 'inset 0 0 12px rgba(245, 158, 11, 0.28), 0 0 12px rgba(245, 158, 11, 0.45), 0 0 24px rgba(245, 158, 11, 0.18)'
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.65)',
      }}
    >
      <span
        className="text-[12px] font-mono font-black tracking-[0.14em] uppercase"
        style={{
          color: isPreviewing || hasCue ? cueColor : 'var(--txt-bright)',
          textShadow: isPreviewing ? '0 0 8px rgba(245, 158, 11, 0.8)' : 'none',
        }}
      >
        CUE
      </span>
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
      aria-label={isSynced ? 'Unsync' : 'Sync'}
      aria-pressed={isSynced}
      className="relative rounded-full flex flex-col items-center justify-center gap-0.5 transition-all duration-150 mixi-btn disabled:opacity-25 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      style={{
        width: size,
        height: size,
        background: isSynced
          ? 'radial-gradient(circle at 50% 35%, #23242b, #121216)'
          : 'radial-gradient(circle at 50% 30%, #222328, #141418)',
        border: `2px solid ${isSynced ? color : `${color}45`}`,
        boxShadow: isSynced
          ? neonShadow(color, true)
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.65)',
      }}
    >
      <svg
        width={iconSize * 0.82}
        height={iconSize * 0.82}
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
            <path d="M4 12a8 8 0 0 1 14-5.3" fill="none" stroke="var(--txt-bright)" strokeWidth="2" strokeLinecap="round" />
            <path d="M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="var(--txt-bright)" strokeWidth="2" strokeLinecap="round" />
            <polygon points="18,3 22,7 14,7" fill="none" stroke="var(--txt-bright)" strokeWidth="2" strokeLinejoin="round" />
            <polygon points="6,21 2,17 10,17" fill="none" stroke="var(--txt-bright)" strokeWidth="2" strokeLinejoin="round" />
          </>
        )}
      </svg>
      <span
        className="text-[7px] font-mono font-bold tracking-widest uppercase leading-none"
        style={{ color: isSynced ? color : 'var(--txt-secondary)' }}
      >
        SYNC
      </span>
    </button>
  );
};
