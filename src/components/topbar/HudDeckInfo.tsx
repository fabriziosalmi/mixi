/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// HUD Deck Info — Per-deck sync/BPM/phase telemetry
//
// Compact display showing real-time deck state:
//   - Deck label (A/B) with color
//   - BPM (synced indicator)
//   - Phase offset (ms)
//   - Play state dot
//
// Uses direct DOM mutation for zero re-renders at 30fps.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import type { DeckId } from '../../types';

const CYAN = 'var(--clr-a, #06b6d4)';
const ORANGE = 'var(--clr-b, #f97316)';

interface HudDeckInfoProps {
  deckId: DeckId;
}

export const HudDeckInfo: FC<HudDeckInfoProps> = ({ deckId }) => {
  const color = deckId === 'A' ? CYAN : ORANGE;
  const bpmRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let skip = false;
    let prevBpm = '';
    let prevPlaying = false;

    function tick() {
      skip = !skip;
      if (!skip) {
        const state = useMixiStore.getState();
        const deck = state.decks[deckId];

        // BPM
        const bpmText = deck.bpm > 0 ? deck.bpm.toFixed(1) : '---';
        if (bpmText !== prevBpm && bpmRef.current) {
          bpmRef.current.textContent = bpmText;
          prevBpm = bpmText;
        }

        // Phase offset (sync delta vs other deck)
        if (phaseRef.current) {
          const other = deckId === 'A' ? 'B' : 'A';
          const otherDeck = state.decks[other];
          if (deck.isPlaying && otherDeck.isPlaying && deck.bpm > 0 && otherDeck.bpm > 0) {
            const ratio = deck.bpm / otherDeck.bpm;
            if (Math.abs(ratio - 1) < 0.01) {
              phaseRef.current.textContent = 'SYNC';
              phaseRef.current.style.color = 'var(--status-ok)';
            } else {
              const diff = ((ratio - 1) * 100).toFixed(1);
              phaseRef.current.textContent = `${ratio > 1 ? '+' : ''}${diff}%`;
              phaseRef.current.style.color = 'var(--status-warn)';
            }
          } else {
            phaseRef.current.textContent = deck.isPlaying ? 'LIVE' : '—';
            phaseRef.current.style.color = 'var(--txt-muted)';
          }
        }

        // Play dot
        if (deck.isPlaying !== prevPlaying && dotRef.current) {
          dotRef.current.style.backgroundColor = deck.isPlaying ? color : 'rgba(255,255,255,0.1)';
          dotRef.current.style.boxShadow = deck.isPlaying ? `0 0 6px ${color}` : 'none';
          prevPlaying = deck.isPlaying;
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deckId, color]);

  return (
    <div
      className="flex items-center gap-1.5 rounded-md px-2 py-0.5 h-full"
      style={{
        background: 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
        minWidth: 90,
      }}
    >
      {/* Play dot */}
      <div
        ref={dotRef}
        className="rounded-full shrink-0"
        style={{
          width: 5, height: 5,
          backgroundColor: 'rgba(255,255,255,0.1)',
          transition: 'background-color 0.15s',
        }}
      />

      {/* Deck label */}
      <span
        className="text-[10px] font-black font-mono"
        style={{ color }}
      >
        {deckId}
      </span>

      {/* BPM */}
      <span
        ref={bpmRef}
        className="text-[11px] font-mono font-bold tabular-nums"
        style={{ color: 'var(--txt-secondary)', minWidth: 36 }}
      >
        ---
      </span>

      {/* Phase / sync status */}
      <span
        ref={phaseRef}
        className="text-[8px] font-mono font-bold tracking-wide"
        style={{ color: 'var(--txt-muted)', minWidth: 28 }}
      >
        —
      </span>
    </div>
  );
};
