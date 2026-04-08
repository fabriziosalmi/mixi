/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobilePitchFader — Vertical pitch strip for mobile
//
// Soft-center S-curve: higher resolution near center (1.0),
// coarser near extremes. Double-tap to reset to center.
// Shows percentage readout and pitch range.
// ─────────────────────────────────────────────────────────────

import { useCallback, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useHaptics } from '../../hooks/useHaptics';
import type { DeckId } from '../../types';

interface MobilePitchFaderProps {
  deckId: DeckId;
  color: string;
}

export const MobilePitchFader: FC<MobilePitchFaderProps> = ({ deckId, color }) => {
  const playbackRate = useMixiStore((s) => s.decks[deckId].playbackRate);
  const setPlaybackRate = useMixiStore((s) => s.setDeckPlaybackRate);
  const pitchRange = useSettingsStore((s) => s.pitchRange);
  const trackRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const lastTapRef = useRef(0);

  const pointerToRate = useCallback((clientY: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    // Top = faster (1+range), bottom = slower (1-range)
    const raw = 1 - (clientY - rect.top) / rect.height; // 0=bottom, 1=top
    const clamped = Math.max(0, Math.min(1, raw));
    // S-curve for center resolution: more granularity near 0.5
    const curved = 0.5 + Math.sign(clamped - 0.5) * Math.pow(Math.abs(clamped - 0.5) * 2, 0.7) / 2;
    return 1.0 - pitchRange + curved * pitchRange * 2;
  }, [pitchRange]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();

    // Double-tap to reset
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setPlaybackRate(deckId, 1.0);
      haptics.snap();
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;

    setPlaybackRate(deckId, pointerToRate(e.clientY));
    haptics.tick();
  }, [deckId, setPlaybackRate, pointerToRate, haptics]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    const rate = pointerToRate(e.clientY);
    setPlaybackRate(deckId, rate);

    // Haptic snap at center
    if (Math.abs(rate - 1.0) < 0.003) haptics.snap();
  }, [deckId, setPlaybackRate, pointerToRate, haptics]);

  const pct = ((playbackRate - 1.0) * 100);
  const faderPos = ((1.0 - (playbackRate - (1.0 - pitchRange)) / (pitchRange * 2))) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {/* Percentage readout */}
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
        color: Math.abs(pct) < 0.1 ? '#555' : color,
      }}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </span>

      {/* Fader track */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        style={{
          width: 28,
          height: 160,
          background: '#111',
          borderRadius: 6,
          position: 'relative',
          touchAction: 'none',
          cursor: 'ns-resize',
          border: '1px solid #333',
        }}
        role="slider"
        aria-label={`Pitch Deck ${deckId}`}
        aria-valuemin={Math.round((1 - pitchRange) * 100)}
        aria-valuemax={Math.round((1 + pitchRange) * 100)}
        aria-valuenow={Math.round(playbackRate * 100)}
      >
        {/* Center mark */}
        <div style={{
          position: 'absolute', left: 4, right: 4, top: '50%',
          height: 1, background: '#444',
        }} />

        {/* Tick marks */}
        {[0.25, 0.75].map((pos) => (
          <div key={pos} style={{
            position: 'absolute', left: 8, right: 8,
            top: `${pos * 100}%`, height: 1, background: '#222',
          }} />
        ))}

        {/* Fader cap */}
        <div style={{
          position: 'absolute',
          left: 2,
          right: 2,
          top: `calc(${Math.max(0, Math.min(100, faderPos))}% - 8px)`,
          height: 16,
          background: '#555',
          borderRadius: 3,
          border: '1px solid #777',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ width: 14, height: 2, background: '#aaa', borderRadius: 1 }} />
        </div>
      </div>

      {/* Range label */}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#444' }}>
        ±{Math.round(pitchRange * 100)}%
      </span>
    </div>
  );
};
