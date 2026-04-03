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

import { useCallback, useRef, useState, useEffect, type FC } from 'react';
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

  const onDrag = useCallback(
    (_dx: number, dy: number) => {
      const mn = minRef.current;
      const mx = maxRef.current;
      const rng = mx - mn;
      const travelPx = TRACK_LEN - CAP_LEN;
      const delta = (-dy / travelPx) * rng;
      const raw = valueAtDragStart.current + delta;
      onChange(Math.min(mx, Math.max(mn, raw)));
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
      onPointerDown(e);
    },
    [clamped, onPointerDown, midiAction],
  );

  // ── Visual position ──
  const norm = (clamped - rangeMin) / (rangeMax - rangeMin);
  const offset = (1 - norm) * (TRACK_LEN - CAP_LEN);

  const pitchPercent = ((clamped - 1) * 100).toFixed(1);
  const pitchLabel = `${Number(pitchPercent) >= 0 ? '+' : ''}${pitchPercent}%`;

  const handleNudge = useCallback(
    (direction: -1 | 1) => {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;
      const originalRate = useMixiStore.getState().decks[deckId].playbackRate;
      engine.setPlaybackRate(deckId, originalRate + direction * 0.03);
      setTimeout(() => engine.setPlaybackRate(deckId, originalRate), 200);
    },
    [deckId],
  );

  const keyLock = useMixiStore((s) => s.decks[deckId].keyLock);
  const toggleKeyLock = useCallback(() => {
    useMixiStore.getState().setKeyLock(deckId, !keyLock);
  }, [deckId, keyLock]);

  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 shrink-0 py-3 px-2 rounded-md bg-zinc-900/50 border border-zinc-800/40"
      style={{ width: 48 }}
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
            {/* Centre tick */}
            <div className="absolute bg-zinc-700" style={{ width: '100%', height: 1, top: '50%' }} />
          </div>

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
      width: 34,
      height: 24,
      background: 'var(--srf-mid)',
      border: '1px solid var(--srf-light)',
    }}
  >
    <svg width="10" height="8" viewBox="0 0 10 8">
      {direction === 1 ? (
        <path d="M1 6L5 2L9 6" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      ) : (
        <path d="M1 2L5 6L9 2" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      )}
    </svg>
  </button>
);
