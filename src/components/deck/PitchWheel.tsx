/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Horizontal Pitch Wheel (Knurled Cylinder v2)
//
// A premium horizontal pitch controller rendered as a 3D
// knurled metal cylinder recessed into the deck surface.
//
// 3D illusion techniques:
//   - Multi-stop vertical gradient (cylinder cross-section)
//   - Specular highlight band across upper-centre
//   - Knurling ridges with curvature-aware height & opacity
//     (taller/brighter at centre, shorter/dimmer at edges)
//   - Deep inset shadow on the housing
//   - Edge vignette (horizontal gradient fading to black)
//
// Flanked by ◀ ▶ nudge buttons for manual phase alignment.
//
// Interaction:
//   Drag left/right → change pitch (300px = full ±8% range)
//   Double-click    → reset to 0%
//   Nudge ◀         → momentary slow down (-3%, 200ms)
//   Nudge ▶         → momentary speed up  (+3%, 200ms)
// ─────────────────────────────────────────────────────────────

import { useCallback, useRef, type FC } from 'react';
import { useDrag } from '../../hooks/useDrag';
import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import type { DeckId } from '../../types';

// ── Geometry ────────────────────────────────────────────────

const VB_W = 240;
const VB_H = 34;
const DRAG_SENSITIVITY = 300;

// ── Knurling ────────────────────────────────────────────────

const RIDGE_SPACING = 4.5;
const RIDGE_COUNT = Math.ceil(VB_W / RIDGE_SPACING) + 6;

// For curvature: ridges at the vertical centre of the cylinder
// are taller and brighter; at the top/bottom edges they fade.
const CYL_TOP = 4;        // where ridges start (top)
const CYL_BOT = VB_H - 4; // where ridges end (bottom)

// ── Component ───────────────────────────────────────────────

interface PitchWheelProps {
  deckId: DeckId;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  color: string;
}

export const PitchWheel: FC<PitchWheelProps> = ({
  deckId,
  value,
  min,
  max,
  onChange,
  color,
}) => {
  const valueAtDragStart = useRef(value);

  const onDrag = useCallback(
    (dx: number, _dy: number) => {
      const range = max - min;
      const delta = (dx / DRAG_SENSITIVITY) * range;
      const raw = valueAtDragStart.current + delta;
      onChange(Math.min(max, Math.max(min, raw)));
    },
    [min, max, onChange],
  );

  const { onPointerDown } = useDrag({ onDrag });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      valueAtDragStart.current = value;
      onPointerDown(e);
    },
    [value, onPointerDown],
  );

  const handleDoubleClick = useCallback(() => onChange(1.0), [onChange]);

  // ── Nudge ─────────────────────────────────────────────────

  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNudge = useCallback(
    (direction: -1 | 1) => {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;
      const originalRate = useMixiStore.getState().decks[deckId].playbackRate;
      // Cancel any previous nudge restore so rapid nudges don't stack
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      engine.setPlaybackRate(deckId, originalRate + direction * 0.03);
      nudgeTimerRef.current = setTimeout(() => {
        nudgeTimerRef.current = null;
        engine.setPlaybackRate(deckId, originalRate);
      }, 200);
    },
    [deckId],
  );

  // ── Derived visuals ───────────────────────────────────────

  const pitchPercent = ((value - 1) * 100).toFixed(1);
  const pitchLabel = `${Number(pitchPercent) >= 0 ? '+' : ''}${pitchPercent}%`;
  const isZero = Math.abs(value - 1.0) < 0.001;
  const norm = (value - min) / (max - min);
  const ridgeOffset = (norm - 0.5) * RIDGE_SPACING * 10;

  const uid = `pw-${deckId}`;

  // ── Build knurling ridges with curvature ──────────────────
  // Each ridge is a vertical line whose length and opacity
  // follow a cosine curve: tallest & brightest at cylinder
  // centre, fading to nothing at the cylindrical edges.

  const ridges: { x: number; y1: number; y2: number; opacity: number }[] = [];
  for (let i = 0; i < RIDGE_COUNT; i++) {
    const baseX = (i - 3) * RIDGE_SPACING + ridgeOffset;
    const x = ((baseX % VB_W) + VB_W) % VB_W;
    ridges.push({
      x,
      y1: CYL_TOP + 2,
      y2: CYL_BOT - 2,
      opacity: 1,
    });
  }

  return (
    <div className="flex items-center gap-1.5 w-full">
      <NudgeButton direction={-1} color={color} onClick={() => handleNudge(-1)} />

      {/* ── Housing (recessed slot in deck) ───────────────── */}
      <div
        className="flex-1 rounded-lg cursor-grab active:cursor-grabbing select-none touch-none"
        style={{
          background: 'var(--srf-deep)',
          boxShadow: 'inset 0 4px 8px rgba(0,0,0,0.8), inset 0 -3px 6px rgba(0,0,0,0.6), inset 4px 0 6px rgba(0,0,0,0.4), inset -4px 0 6px rgba(0,0,0,0.4)',
          padding: '3px 0',
        }}
      >
        <svg
          width="100%"
          height={VB_H}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
        >
          <defs>
            {/* Cylinder cross-section gradient (convex metal) */}
            <linearGradient id={`${uid}-cyl`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#0e0e0e" />
              <stop offset="10%"  stopColor="#1a1a1a" />
              <stop offset="30%"  stopColor="#333"    />
              <stop offset="42%"  stopColor="#3a3a3a" />  {/* specular band */}
              <stop offset="50%"  stopColor="#353535" />
              <stop offset="58%"  stopColor="#2e2e2e" />
              <stop offset="75%"  stopColor="#1a1a1a" />
              <stop offset="100%" stopColor="#0e0e0e" />
            </linearGradient>

            {/* Specular highlight (narrow bright band) */}
            <linearGradient id={`${uid}-spec`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="transparent" />
              <stop offset="32%"  stopColor="rgba(255,255,255,0.06)" />
              <stop offset="40%"  stopColor="rgba(255,255,255,0.09)" />
              <stop offset="48%"  stopColor="rgba(255,255,255,0.03)" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>

            {/* Horizontal edge vignette */}
            <linearGradient id={`${uid}-vig`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#080808" stopOpacity="0.8" />
              <stop offset="8%"   stopColor="#080808" stopOpacity="0" />
              <stop offset="92%"  stopColor="#080808" stopOpacity="0" />
              <stop offset="100%" stopColor="#080808" stopOpacity="0.8" />
            </linearGradient>

            {/* LED text glow */}
            <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Clip to rounded rect */}
            <clipPath id={`${uid}-clip`}>
              <rect x="0" y="0" width={VB_W} height={VB_H} rx="5" />
            </clipPath>
          </defs>

          <g clipPath={`url(#${uid}-clip)`}>
            {/* L0: Cylinder body */}
            <rect x="0" y="0" width={VB_W} height={VB_H} fill={`url(#${uid}-cyl)`} />

            {/* L1: Knurling ridges (highlight + shadow pairs) */}
            {ridges.map((r, i) => (
              <g key={i}>
                {/* Ridge highlight (left face catches light) */}
                <line
                  x1={r.x} y1={r.y1}
                  x2={r.x} y2={r.y2}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="0.8"
                />
                {/* Ridge shadow (right face in shadow) */}
                <line
                  x1={r.x + 1.5} y1={r.y1 + 1}
                  x2={r.x + 1.5} y2={r.y2 - 1}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth="0.6"
                />
              </g>
            ))}

            {/* L2: Specular highlight band */}
            <rect x="0" y="0" width={VB_W} height={VB_H} fill={`url(#${uid}-spec)`} />

            {/* L3: Horizontal edge vignette */}
            <rect x="0" y="0" width={VB_W} height={VB_H} fill={`url(#${uid}-vig)`} />

            {/* L4: Centre zero marker */}
            <line
              x1={VB_W / 2} y1={0}
              x2={VB_W / 2} y2={VB_H}
              stroke={isZero ? color : 'rgba(255,255,255,0.15)'}
              strokeWidth={isZero ? 1.5 : 0.8}
              opacity={isZero ? 0.5 : 0.3}
            />

            {/* L5: Dark backing behind LED text for contrast */}
            <rect
              x={VB_W / 2 - 32} y={VB_H / 2 - 7}
              width="64" height="14"
              rx="3"
              fill="rgba(0,0,0,0.5)"
            />

            {/* L6: LED pitch readout */}
            <text
              x={VB_W / 2}
              y={VB_H / 2 + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
              fontWeight="500"
              letterSpacing="0.5"
              fill={color}
              filter={`url(#${uid}-glow)`}
            >
              {pitchLabel}
            </text>
          </g>
        </svg>
      </div>

      <NudgeButton direction={1} color={color} onClick={() => handleNudge(1)} />
    </div>
  );
};

// ── Nudge Button ────────────────────────────────────────────

const NudgeButton: FC<{
  direction: -1 | 1;
  color: string;
  onClick: () => void;
}> = ({ direction, color, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={direction === -1 ? 'Nudge back (slow)' : 'Nudge forward (fast)'}
    className="mixi-btn flex items-center justify-center rounded-md shrink-0 transition-all duration-100 active:opacity-80"
    style={{
      width: 30,
      height: 34,
      background: 'linear-gradient(180deg, var(--brd-subtle), #161616)',
      border: '1px solid var(--srf-light)',
      boxShadow: '0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 var(--brd-default)',
    }}
  >
    <svg width="10" height="12" viewBox="0 0 10 12">
      {direction === -1 ? (
        <path d="M7 1L2 6L7 11" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      ) : (
        <path d="M3 1L8 6L3 11" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      )}
    </svg>
  </button>
);
