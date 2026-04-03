/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Play / Pause Button
//
// Large circular CDJ-style button with play/pause icon.
// Glows with the deck accent colour when playing.
// ─────────────────────────────────────────────────────────────

import type { FC } from 'react';
import { useMidiStore } from '../../store/midiStore';

interface PlayButtonProps {
  isPlaying: boolean;
  onToggle: () => void;
  color: string;
  size?: number;
  midiAction?: any;
}

export const PlayButton: FC<PlayButtonProps> = ({
  isPlaying,
  onToggle,
  color,
  size = 56,
  midiAction,
}) => {
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
      onClick={handleClick}
      className="relative rounded-full flex items-center justify-center transition-all duration-150 active:scale-95 focus:outline-none"
      style={{
        width: size,
        height: size,
        background: isPlaying
          ? `linear-gradient(135deg, ${color}33, ${color}11)`
          : 'linear-gradient(135deg, var(--brd-default), var(--srf-mid))',
        border: `2px solid ${isPlaying ? color : 'var(--txt-muted)'}`,
        boxShadow: isPlaying
          ? `0 0 20px ${color}44, inset 0 0 10px ${color}22`
          : '0 2px 8px #00000066',
      }}
    >
      {isPlaying ? (
        // Pause icon: two filled bars + glow
        <svg
          width={size * 0.35}
          height={size * 0.35}
          viewBox="0 0 24 24"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        >
          <rect x="5" y="3" width="5" height="18" rx="1" fill={color} />
          <rect x="14" y="3" width="5" height="18" rx="1" fill={color} />
        </svg>
      ) : (
        // Play icon: outline triangle (stroke only, no fill)
        <svg width={size * 0.35} height={size * 0.35} viewBox="0 0 24 24">
          <polygon
            points="6,3 20,12 6,21"
            fill="none"
            stroke="#888"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
};
