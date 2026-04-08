/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileWaveformOverview — Full-track overview bar (8px)
//
// Shows the entire track waveform at a glance with a playhead
// position indicator. Tap to jump to position.
// Uses the same waveformData as the scrolling MobileWaveform.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useCallback, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { themeVar } from '../../theme';
import type { DeckId } from '../../types';

const HEIGHT = 8;
const FRAME_INTERVAL = 66; // ~15 FPS (overview doesn't need 30)

interface MobileWaveformOverviewProps {
  deckId: DeckId;
  color: string;
}

export const MobileWaveformOverview: FC<MobileWaveformOverviewProps> = ({ deckId, color }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Store subscription (refs to avoid re-renders)
  const waveformRef = useRef(useMixiStore.getState().decks[deckId].waveformData);
  const durationRef = useRef(useMixiStore.getState().decks[deckId].duration);

  useEffect(() => {
    return useMixiStore.subscribe(
      (s) => ({ w: s.decks[deckId].waveformData, d: s.decks[deckId].duration }),
      (slice) => { waveformRef.current = slice.w; durationRef.current = slice.d; },
    );
  }, [deckId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let width = container.clientWidth;

    const setup = (w: number) => {
      width = w;
      canvas.width = w * dpr;
      canvas.height = HEIGHT * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    setup(width);

    const COLOR_BG = themeVar('wave-bg', '#0a0a0a');
    const engine = MixiEngine.getInstance();
    let lastDraw = 0;
    let rafId = 0;

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      if (now - lastDraw < FRAME_INTERVAL) return;
      lastDraw = now;

      const waveform = waveformRef.current;
      const duration = durationRef.current;
      const half = HEIGHT / 2;

      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, width, HEIGHT);

      if (!waveform || waveform.length === 0 || duration <= 0) return;

      // Draw full waveform compressed to fit width
      const step = waveform.length / width;
      ctx.fillStyle = `${color}66`;

      for (let x = 0; x < width; x++) {
        const idx = Math.floor(x * step);
        if (idx >= waveform.length) break;
        const point = waveform[idx];
        const amp = Math.max(point.low, point.mid, point.high);
        const h = amp * half;
        ctx.fillRect(x, half - h, 1, h * 2);
      }

      // Playhead position with glow
      const currentTime = engine.isInitialized ? engine.getCurrentTime(deckId) : 0;
      const playheadX = (currentTime / duration) * width;

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#fff';
      ctx.fillRect(playheadX - 0.5, 0, 1, HEIGHT);
      ctx.restore();

      // Soft glow halo
      const phGrad = ctx.createRadialGradient(playheadX, HEIGHT / 2, 0, playheadX, HEIGHT / 2, 8);
      phGrad.addColorStop(0, `${color}33`);
      phGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = phGrad;
      ctx.fillRect(playheadX - 8, 0, 16, HEIGHT);
    };

    rafId = requestAnimationFrame(draw);

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0 && Math.abs(width - w) > 2) setup(w | 0);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [deckId, color]);

  // Tap to seek
  const onTap = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const duration = durationRef.current;
    if (!canvas || duration <= 0) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = ratio * duration;

    const engine = MixiEngine.getInstance();
    if (engine.isInitialized) {
      engine.seek(deckId, seekTime);
    }
  }, [deckId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: HEIGHT,
        borderRadius: 2,
        overflow: 'hidden',
        cursor: 'pointer',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onTap}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
};
