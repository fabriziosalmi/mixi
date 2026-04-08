/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileTapTempo — Tap to detect BPM, apply to active deck
//
// Tap 4+ times → calculates average BPM → sets playback rate
// to match. Resets after 2 seconds of inactivity.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { useHaptics } from '../../hooks/useHaptics';
import type { DeckId } from '../../types';

interface MobileTapTempoProps {
  deckId: DeckId;
  color: string;
}

export const MobileTapTempo: FC<MobileTapTempoProps> = ({ deckId, color }) => {
  const [tappedBpm, setTappedBpm] = useState(0);
  const [tapCount, setTapCount] = useState(0);
  const tapsRef = useRef<number[]>([]);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);
  const setPlaybackRate = useMixiStore((s) => s.setDeckPlaybackRate);
  const haptics = useHaptics();

  const onTap = useCallback(() => {
    haptics.tick();
    const now = performance.now();

    // Reset if > 2s since last tap
    if (tapsRef.current.length > 0 && now - tapsRef.current[tapsRef.current.length - 1] > 2000) {
      tapsRef.current = [];
    }

    tapsRef.current.push(now);
    setTapCount(tapsRef.current.length);

    // Need at least 2 taps to calculate BPM
    if (tapsRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapsRef.current.length; i++) {
        intervals.push(tapsRef.current[i] - tapsRef.current[i - 1]);
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const detected = 60000 / avgMs;
      const clamped = Math.max(60, Math.min(200, detected));
      setTappedBpm(Math.round(clamped * 10) / 10);
    }

    // Auto-reset after 2s
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      tapsRef.current = [];
      setTapCount(0);
      setTappedBpm(0);
    }, 3000);
  }, [haptics]);

  const applyBpm = useCallback(() => {
    if (tappedBpm <= 0 || bpm <= 0) return;
    const ratio = tappedBpm / bpm;
    setPlaybackRate(deckId, ratio);
    haptics.confirm();
  }, [tappedBpm, bpm, deckId, setPlaybackRate, haptics]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button
        onClick={onTap}
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          border: `2px solid ${tapCount >= 4 ? color : '#444'}`,
          background: tapCount >= 2 ? `${color}15` : '#151515',
          color: tapCount >= 2 ? color : '#666',
          fontSize: 12,
          fontWeight: 900,
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <span>TAP</span>
        {tappedBpm > 0 && (
          <span style={{ fontSize: 16, fontWeight: 900 }}>{tappedBpm.toFixed(1)}</span>
        )}
      </button>

      {tapCount >= 4 && tappedBpm > 0 && bpm > 0 && (
        <button
          onClick={applyBpm}
          style={{
            height: 32,
            padding: '0 16px',
            border: `1px solid ${color}`,
            borderRadius: 6,
            background: `${color}22`,
            color,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          APPLY TO {deckId}
        </button>
      )}

      <span style={{ fontSize: 8, color: '#444', fontFamily: 'var(--font-mono)' }}>
        {tapCount > 0 ? `${tapCount} taps` : 'tap to detect BPM'}
      </span>
    </div>
  );
};
