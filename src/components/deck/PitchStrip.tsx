/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Pitch Strip (Right-Edge Fader + Range Toggle + Nudge)
//
// Layout (top to bottom):
//   [▲ nudge faster]
//   [±8/±16 range toggle]
//   [  pitch fader  ]
//   [  % readout    ]
//   [▼ nudge slower]
// ─────────────────────────────────────────────────────────────

import { useCallback, useMemo, useRef, useState, useEffect, type FC } from 'react';
import { useDrag } from '../../hooks/useDrag';
import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { useMidiStore } from '../../store/midiStore';
import type { DeckId } from '../../types';

const RANGE_8 = 0.08;
const RANGE_16 = 0.16;
const TRACK_LEN = 220;
const CAP_LEN = 28;
const CAP_THK = 20;
const TRACK_THK = 6;

/** Number of tick marks on the fader track. */
const TICK_COUNT = 17;

/**
 * Soft-center curve: S-curve that increases resolution near center.
 * Input/output both in [0..1] normalized space.
 * At center (0.5): slope is shallow → more pixels per % change.
 * At extremes: slope is steep → fewer pixels per % change.
 */
function softCurve(t: number): number {
  // Cubic S-curve centered at 0.5
  const x = t - 0.5;
  return 0.5 + 2 * x * x * x + 0.5 * x;
}

/**
 * Inverse of softCurve: maps pitch value back to visual position.
 * Uses Newton's method (3 iterations is enough for < 0.001 error).
 */
function softCurveInverse(y: number): number {
  let t = y; // initial guess
  for (let i = 0; i < 3; i++) { // 3 iterations ≈ <0.001 error, sufficient for UI
    const err = softCurve(t) - y;
    const x = t - 0.5;
    const deriv = 6 * x * x + 0.5;
    t -= err / deriv;
  }
  return Math.max(0, Math.min(1, t));
}

interface PitchStripProps {
  value: number;
  onChange: (v: number) => void;
  color: string;
  deckId: DeckId;
  midiAction?: any;
}

export const PitchStrip: FC<PitchStripProps> = ({
  value,
  onChange,
  color,
  deckId,
  midiAction,
}) => {
  const [wide, setWide] = useState(false);
  const [softCenter, setSoftCenter] = useState(false);
  const softRef = useRef(false);
  useEffect(() => { softRef.current = softCenter; }, [softCenter]);
  const range = wide ? RANGE_16 : RANGE_8;
  const rangeMin = 1 - range;
  const rangeMax = 1 + range;

  // Clamp value to current range
  const clamped = Math.min(rangeMax, Math.max(rangeMin, value));

  const handleRangeToggle = useCallback(() => {
    setWide((prev) => {
      const nextWide = !prev;
      const nextRange = nextWide ? RANGE_16 : RANGE_8;
      // Clamp current value to new range immediately
      const v = useMixiStore.getState().decks[deckId].playbackRate;
      const c = Math.min(1 + nextRange, Math.max(1 - nextRange, v));
      if (c !== v) onChange(c);
      return nextWide;
    });
  }, [deckId, onChange]);

  const handleDoubleClick = useCallback(() => onChange(1.0), [onChange]);

  // ── Inline pitch fader (avoids stale min/max in shared Fader) ──
  // Uses refs for min/max so the drag callback always has current values.

  const minRef = useRef(rangeMin);
  const maxRef = useRef(rangeMax);
  useEffect(() => { minRef.current = rangeMin; }, [rangeMin]);
  useEffect(() => { maxRef.current = rangeMax; }, [rangeMax]);

  const valueAtDragStart = useRef(clamped);
  const normAtDragStart = useRef(0.5);

  const onDrag = useCallback(
    (_dx: number, dy: number) => {
      const mn = minRef.current;
      const mx = maxRef.current;
      const rng = mx - mn;
      const travelPx = TRACK_LEN - CAP_LEN;

      if (softRef.current) {
        // Soft center: drag in visual (curved) space, then convert back
        const visualDelta = -dy / travelPx;
        const newVisualNorm = Math.max(0, Math.min(1, normAtDragStart.current + visualDelta));
        // Convert visual position → pitch value through the curve
        const pitchNorm = softCurve(newVisualNorm);
        onChange(Math.min(mx, Math.max(mn, mn + pitchNorm * rng)));
      } else {
        // Linear: direct mapping
        const delta = (-dy / travelPx) * rng;
        const raw = valueAtDragStart.current + delta;
        onChange(Math.min(mx, Math.max(mn, raw)));
      }
    },
    [onChange],
  );

  const { onPointerDown } = useDrag({ onDrag });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (midiAction && (window as any).__MIXIMIDILEARN__ && useMidiStore.getState().isLearning) {
        e.preventDefault();
        e.stopPropagation();
        (window as any).__MIXIMIDILEARN__(midiAction);
        return;
      }
      valueAtDragStart.current = clamped;
      // For soft mode: compute visual norm at drag start
      const n = (clamped - minRef.current) / (maxRef.current - minRef.current);
      normAtDragStart.current = softRef.current ? softCurveInverse(n) : n;
      onPointerDown(e);
    },
    [clamped, onPointerDown, midiAction],
  );

  // ── Visual position ──
  const norm = (clamped - rangeMin) / (rangeMax - rangeMin);
  // In soft mode, cap position is in "curved" visual space
  const visualNorm = softCenter ? softCurveInverse(norm) : norm;
  const offset = (1 - visualNorm) * (TRACK_LEN - CAP_LEN);

  // ── Tick marks (perpendicular to fader, memoized to avoid DOM churn) ──
  const ticksJsx = useMemo(() => {
    const result: React.ReactNode[] = [];
    for (let i = 0; i <= TICK_COUNT; i++) {
      const t = i / TICK_COUNT;
      const isCenter = i === Math.floor(TICK_COUNT / 2);
      const tickY = (1 - t) * TRACK_LEN;
      const tickW = isCenter ? 14 : (softCenter ? 6 + 4 * (1 - Math.abs(t - 0.5) * 2) : 8);
      const alpha = isCenter
        ? 0.15
        : softCenter
          ? 0.04 + 0.06 * (1 - Math.abs(t - 0.5) * 2)
          : 0.04;
      result.push(
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            width: tickW,
            height: 1,
            top: tickY,
            left: '50%',
            transform: 'translateX(-50%)',
            background: `rgba(255,255,255,${alpha})`,
          }}
        />,
      );
    }
    return result;
  }, [softCenter]);

  const pitchPercent = ((clamped - 1) * 100).toFixed(1);
  const pitchLabel = `${Number(pitchPercent) >= 0 ? '+' : ''}${pitchPercent}%`;

  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNudge = useCallback(
    (direction: -1 | 1) => {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;
      const originalRate = useMixiStore.getState().decks[deckId].playbackRate;
      engine.setPlaybackRate(deckId, originalRate + direction * 0.03);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = setTimeout(() => engine.setPlaybackRate(deckId, originalRate), 200);
    },
    [deckId],
  );

  useEffect(() => {
    return () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); };
  }, []);

  const keyLock = useMixiStore((s) => s.decks[deckId].keyLock);
  const toggleKeyLock = useCallback(() => {
    useMixiStore.getState().setKeyLock(deckId, !keyLock);
  }, [deckId, keyLock]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 shrink-0 py-3 px-2 rounded-lg"
      style={{
        width: 48,
        background: 'rgba(20,20,22,0.7)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.02)',
      }}
    >
      <NudgeBtn direction={1} color={color} onClick={() => handleNudge(1)} />

      {/* Range toggle */}
      <button
        type="button"
        onClick={handleRangeToggle}
        className="mixi-btn rounded flex items-center justify-center shrink-0 transition-all duration-200 active:scale-95"
        style={{
          width: 34,
          height: 18,
          background: wide ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${wide ? 'var(--txt-muted)55' : 'var(--brd-default)33'}`,
        }}
        title={`Pitch range: ±${wide ? 16 : 8}%`}
      >
        <span
          className="text-[8px] font-mono font-bold tracking-wider"
          style={{
            color: wide ? 'var(--txt-primary)' : 'var(--txt-secondary)',
          }}
        >
          ±{wide ? 16 : 8}
        </span>
      </button>

      {/* Key Lock toggle */}
      <button
        type="button"
        onClick={toggleKeyLock}
        className="mixi-btn rounded flex items-center justify-center shrink-0 transition-all duration-200 active:scale-95"
        style={{
          width: 34,
          height: 18,
          background: keyLock ? `${color}22` : 'rgba(255,255,255,0.04)',
          border: `1px solid ${keyLock ? `${color}66` : 'var(--brd-default)33'}`,
        }}
        title={`Key Lock: ${keyLock ? 'ON' : 'OFF'}`}
      >
        <span
          className="text-[7px] font-bold tracking-wider"
          style={{
            color: keyLock ? color : 'var(--txt-secondary)',
          }}
        >
          🔒
        </span>
      </button>

      {/* Inline pitch fader */}
      <div
        className="flex flex-col items-center gap-1 select-none touch-none"
        onDoubleClick={handleDoubleClick}
      >
        <div className="relative flex items-center justify-center" style={{ width: CAP_THK + 12, height: TRACK_LEN }}>
          {/* Track */}
          <div
            className="absolute rounded-full bg-zinc-900 shadow-[inset_0_2px_4px_rgba(0,0,0,0.7),inset_0_-1px_2px_rgba(0,0,0,0.4)]"
            style={{ width: TRACK_THK, height: TRACK_LEN, left: '50%', transform: 'translateX(-50%)' }}
          >
            {/* Track glow */}
            <div
              className="absolute rounded-full"
              style={{
                width: '70%', left: '15%', bottom: 0,
                height: `${norm * 100}%`,
                background: `linear-gradient(to top, transparent, ${color}22, ${color}33)`,
                filter: 'blur(1.5px)',
              }}
            />
            {/* Centre tick (stronger) */}
            <div className="absolute bg-zinc-700" style={{ width: '100%', height: 1, top: '50%' }} />
          </div>

          {/* Tick marks — perpendicular to fader track (memoized) */}
          {ticksJsx}

          {/* Cap */}
          <div
            className="absolute cursor-grab rounded-sm active:cursor-grabbing"
            style={{
              width: CAP_THK, height: CAP_LEN,
              top: offset, left: '50%', transform: 'translateX(-50%)',
              background: 'linear-gradient(to bottom, var(--txt-muted), var(--brd-subtle))',
              boxShadow: `0 2px 4px rgba(0,0,0,0.8), 0 0 6px ${color}33, inset 0 1px 0 var(--txt-secondary), inset 0 -1px 0 var(--srf-base)`,
            }}
            onPointerDown={handlePointerDown}
          >
            {/* Indicator line shadow */}
            <div className="absolute rounded-full" style={{ width: '65%', height: 1, top: 'calc(50% - 1px)', left: '17.5%', background: 'rgba(0,0,0,0.4)' }} />
            {/* Indicator line */}
            <div className="absolute rounded-full" style={{ width: '65%', height: 1, top: '50%', left: '17.5%', background: 'rgba(255,255,255,0.85)', boxShadow: '0 0 3px rgba(255,255,255,0.4)' }} />
          </div>
        </div>
      </div>

      {/* % readout */}
      <span
        className="text-[8px] font-mono font-medium rounded px-1 py-0.5 cursor-pointer"
        style={{
          background: 'var(--srf-base)',
          border: `1px solid ${color}15`,
          color,
          textShadow: `0 0 6px ${color}44`,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
        }}
        onDoubleClick={handleDoubleClick}
        title="Double-click to reset"
      >
        {pitchLabel}
      </span>

      {/* Soft-center toggle */}
      <button
        type="button"
        onClick={() => setSoftCenter((p) => !p)}
        className="mixi-btn rounded flex items-center justify-center shrink-0 transition-all duration-200 active:scale-95"
        style={{
          width: 34,
          height: 18,
          background: softCenter ? `${color}22` : 'rgba(255,255,255,0.04)',
          border: `1px solid ${softCenter ? `${color}66` : 'var(--brd-default)33'}`,
        }}
        title={`Pitch curve: ${softCenter ? 'Soft center (high-res)' : 'Linear'}`}
      >
        {/* S-curve icon */}
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
          <path
            d={softCenter
              ? 'M1 9 C4 9, 6 1, 8 5 C10 9, 12 1, 15 1'  // S-curve
              : 'M1 9 L15 1'                                 // straight line
            }
            stroke={softCenter ? color : 'var(--txt-secondary)'}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity={softCenter ? 1 : 0.6}
          />
        </svg>
      </button>

      <NudgeBtn direction={-1} color={color} onClick={() => handleNudge(-1)} />
    </div>
  );
};

// ── Nudge Button ────────────────────────────────────────────

const NudgeBtn: FC<{
  direction: -1 | 1;
  color: string;
  onClick: () => void;
}> = ({ direction, color, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={direction === 1 ? 'Nudge faster' : 'Nudge slower'}
    className="mixi-btn flex items-center justify-center rounded shrink-0 transition-all duration-100 active:opacity-70"
    style={{
      width: 38,
      height: 28,
      background: 'var(--srf-mid)',
      border: '1px solid var(--srf-light)',
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
    }}
  >
    <svg width="14" height="10" viewBox="0 0 14 10">
      {direction === 1 ? (
        <path d="M2 7L7 3L12 7" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      ) : (
        <path d="M2 3L7 7L12 3" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      )}
    </svg>
  </button>
);
