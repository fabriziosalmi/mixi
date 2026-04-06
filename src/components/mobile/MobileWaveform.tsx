/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileWaveform — Touch-optimized Canvas waveform for mobile
//
// Reuses the same three-band RGB rendering algorithm as the
// desktop WaveformDisplay, adapted for mobile:
//   - Narrower bars (2px vs 3px) for high-DPI mobile screens
//   - 30 FPS throttle for battery conservation
//   - Touch scrub via pointer events (drag to seek)
//   - No hot cue / loop / beatgrid overlays (kept in Fase 3)
//   - ResizeObserver for dynamic width
//
// Data flow (identical to desktop, zero duplication):
//   MixiEngine.getCurrentTime(deckId) → position in seconds
//   useMixiStore.decks[deckId].waveformData → WaveformPoint[]
//   POINTS_PER_SECOND = 100
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { POINTS_PER_SECOND } from '../../audio/WaveformAnalyzer';
import { themeVar } from '../../theme';
import { useHaptics } from '../../hooks/useHaptics';
import type { DeckId } from '../../types';

// ── Constants ────────────────────────────────────────────────

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const PLAYHEAD_RATIO = 1 / 3;
const FRAME_INTERVAL = 33; // ~30 FPS

// ── Component ────────────────────────────────────────────────

interface MobileWaveformProps {
  deckId: DeckId;
  height?: number;
  color: string;
}

export const MobileWaveform: FC<MobileWaveformProps> = ({
  deckId,
  height = 40,
  color,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Scrub state (refs to avoid re-renders) ──
  const isDraggingRef = useRef(false);
  const scrubTimeRef = useRef<number | null>(null);

  // ── Store subscription (selective, outside render) ──
  const waveformRef = useRef(useMixiStore.getState().decks[deckId].waveformData);
  const durationRef = useRef(useMixiStore.getState().decks[deckId].duration);

  useEffect(() => {
    const unsub = useMixiStore.subscribe(
      (s) => ({
        waveformData: s.decks[deckId].waveformData,
        duration: s.decks[deckId].duration,
      }),
      (slice) => {
        waveformRef.current = slice.waveformData;
        durationRef.current = slice.duration;
      },
    );
    return unsub;
  }, [deckId]);

  // ── Canvas setup + RAF draw loop ──
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let width = container.clientWidth;
    if (width < 1) return;

    const dpr = window.devicePixelRatio || 1;

    const setupCanvas = (w: number) => {
      width = w;
      canvas.width = w * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
    };

    setupCanvas(width);

    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Theme colors (read once)
    const COLOR_LOW = themeVar('wave-low', '#cc2244');
    const COLOR_MID = themeVar('wave-mid', '#dd8822');
    const COLOR_HIGH = themeVar('wave-high', '#3388dd');
    const COLOR_BG = themeVar('wave-bg', '#0a0a0a');

    const engine = MixiEngine.getInstance();
    let lastDraw = 0;
    let rafId = 0;

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);

      // 30 FPS throttle
      if (now - lastDraw < FRAME_INTERVAL) return;
      lastDraw = now;

      const waveform = waveformRef.current;
      const halfHeight = height / 2;
      const playheadX = (width * PLAYHEAD_RATIO) | 0;
      const totalBars = Math.ceil(width / BAR_STEP);

      // Clear
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, width, height);

      if (!waveform || waveform.length === 0) {
        // No track — draw center line
        ctx.fillStyle = '#222';
        ctx.fillRect(0, halfHeight, width, 1);
        return;
      }

      // Current position
      const currentTime =
        scrubTimeRef.current !== null
          ? scrubTimeRef.current
          : engine.isInitialized
            ? engine.getCurrentTime(deckId)
            : 0;

      const currentIndex = currentTime * POINTS_PER_SECOND;
      const barsLeftOfPlayhead = (playheadX / BAR_STEP) | 0;
      const startIndex = currentIndex - barsLeftOfPlayhead;

      // Three-band RGB bars with additive blending
      ctx.globalCompositeOperation = 'screen';

      for (let i = 0; i < totalBars; i++) {
        const dataIdx = (startIndex + i) | 0;
        if (dataIdx < 0 || dataIdx >= waveform.length) continue;

        const point = waveform[dataIdx];
        const x = i * BAR_STEP;

        const hLow = (point.low * halfHeight) | 0;
        const hMid = (point.mid * halfHeight) | 0;
        const hHigh = (point.high * halfHeight) | 0;

        ctx.fillStyle = COLOR_LOW;
        ctx.fillRect(x, halfHeight - hLow, BAR_WIDTH, hLow * 2);

        ctx.fillStyle = COLOR_MID;
        ctx.fillRect(x, halfHeight - hMid, BAR_WIDTH, hMid * 2);

        ctx.fillStyle = COLOR_HIGH;
        ctx.fillRect(x, halfHeight - hHigh, BAR_WIDTH, hHigh * 2);
      }

      // Playhead line
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(playheadX, 0, 1, height);

      // Dim border glow
      ctx.fillStyle = `${color}22`;
      ctx.fillRect(playheadX - 1, 0, 3, height);
    };

    rafId = requestAnimationFrame(draw);

    // ResizeObserver
    let resizeTimer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) {
        const rounded = w | 0;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (Math.abs(width - rounded) > 2) {
            setupCanvas(rounded);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }, 150);
      }
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      ro.disconnect();
    };
  }, [deckId, height, color]);

  // ── Touch scrub handlers ──

  const pointerXToTime = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const width = rect.width;
    const playheadX = width * PLAYHEAD_RATIO;

    const engine = MixiEngine.getInstance();
    const currentTime = engine.isInitialized ? engine.getCurrentTime(deckId) : 0;

    // Offset from playhead position in data points
    const deltaPixels = x - playheadX;
    const deltaBars = deltaPixels / BAR_STEP;
    const deltaTime = deltaBars / POINTS_PER_SECOND;

    const dur = durationRef.current || 1;
    return Math.max(0, Math.min(dur, currentTime + deltaTime));
  };

  const haptics = useHaptics();

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    scrubTimeRef.current = pointerXToTime(e.clientX);
    haptics.tick();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    scrubTimeRef.current = pointerXToTime(e.clientX);
  };

  const onPointerUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    const finalTime = scrubTimeRef.current;
    scrubTimeRef.current = null;

    const engine = MixiEngine.getInstance();
    if (engine.isInitialized && finalTime !== null && finalTime >= 0) {
      engine.seek(deckId, finalTime);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
        borderRadius: 4,
        overflow: 'hidden',
        border: `1px solid ${color}22`,
        touchAction: 'none',
        cursor: 'pointer',
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
};
