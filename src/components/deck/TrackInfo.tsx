/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Track Info (Time Counter)
//
// When compact=true: renders only the elapsed/remaining timer
// (for inline use in the unified deck header).
//
// When compact=false: renders full info bar (name, key, time).
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import type { DeckId } from '../../types';

interface TrackInfoProps {
  deckId: DeckId;
  color: string;
  /** If true, render only the time counter (no name/key). */
  compact?: boolean;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const TrackInfo: FC<TrackInfoProps> = ({ deckId, color, compact = false }) => {
  const duration = useMixiStore((s) => s.decks[deckId].duration);
  /** Direct DOM refs — zero re-renders for time updates. */
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    let lastUpdate = 0;
    function tick() {
      const now = performance.now();
      if (now - lastUpdate > 100) {
        const engine = MixiEngine.getInstance();
        if (engine.isInitialized) {
          const t = engine.getCurrentTime(deckId);
          const rem = duration - t;
          if (elapsedRef.current) elapsedRef.current.textContent = formatTime(t);
          if (remainRef.current) {
            remainRef.current.textContent = `-${formatTime(rem)}`;
            const ending = rem > 0 && rem < 30;
            remainRef.current.style.color = ending ? 'var(--status-error)' : '';
            remainRef.current.style.animation = ending ? 'pulse 1s ease-in-out infinite' : '';
          }
        }
        lastUpdate = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [deckId, duration]);

  if (compact) {
    return (
      <div className="shrink-0 flex items-baseline gap-1 font-mono text-[10px] font-light">
        <span ref={elapsedRef} className="text-zinc-400">0:00</span>
        <span className="text-zinc-500/80">/</span>
        <span ref={remainRef}>-0:00</span>
      </div>
    );
  }

  // Full mode (unused now but kept for flexibility).
  const trackName = useMixiStore.getState().decks[deckId].trackName;
  const musicalKey = useMixiStore.getState().decks[deckId].musicalKey;
  const displayName = trackName ? trackName.replace(/\.[^.]+$/, '') : 'No Track';

  return (
    <div className="flex items-center gap-2 w-full px-1 min-h-[20px]">
      <span className="flex-1 truncate text-[11px] text-zinc-300 font-medium">{displayName}</span>
      {musicalKey && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider"
          style={{ background: `${color}15`, border: `1px solid ${color}44`, color }}>
          {musicalKey}
        </span>
      )}
      <div className="shrink-0 flex items-baseline gap-1 font-mono text-[11px]">
        <span ref={elapsedRef} className="text-zinc-400">0:00</span>
        <span className="text-zinc-500/80">/</span>
        <span ref={remainRef} className="text-zinc-500">-0:00</span>
      </div>
    </div>
  );
};
