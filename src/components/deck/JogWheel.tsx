/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Jog Wheel
//
// Animated circular platter. Rotates when playing.
// ─────────────────────────────────────────────────────────────

import type { FC } from 'react';

interface JogWheelProps {
  isPlaying: boolean;
  color: string;
  size?: number;
}

export const JogWheel: FC<JogWheelProps> = ({
  isPlaying,
  color,
  size = 180,
}) => {
  return (
    <div
      className="relative rounded-full border-2 flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderColor: `${color}33`,
        background: 'radial-gradient(circle at 40% 35%, #2a2a2a, #111 70%)',
      }}
    >
      {/* Platter with rotation */}
      <div
        className="absolute inset-2 rounded-full border border-zinc-800"
        style={{
          background: 'radial-gradient(circle at 45% 40%, #222, #0a0a0a)',
          animation: isPlaying ? 'spin 2s linear infinite' : 'none',
        }}
      >
        {/* Grooves */}
        <div className="absolute inset-4 rounded-full border border-zinc-800/40" />
        <div className="absolute inset-8 rounded-full border border-zinc-800/30" />
        <div className="absolute inset-12 rounded-full border border-zinc-800/20" />

        {/* Centre dot */}
        <div
          className="absolute rounded-full"
          style={{
            width: size * 0.18,
            height: size * 0.18,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${color}22, #111)`,
            border: `1px solid ${color}33`,
          }}
        />

        {/* Position marker */}
        <div
          className="absolute rounded-full bg-white/60"
          style={{ width: 4, height: 4, top: 12, left: '50%', transform: 'translateX(-50%)' }}
        />
      </div>

      {/* Outer glow when playing */}
      {isPlaying && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ boxShadow: `0 0 15px ${color}22, inset 0 0 15px ${color}11` }}
        />
      )}
    </div>
  );
};
