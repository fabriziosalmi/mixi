/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Waveform Overview (Static Full-Track Bar)
//
// A thin horizontal bar showing the ENTIRE track compressed
// into a single strip.  A moving cursor shows the current
// playback position.
//
// Unlike the scrolling WaveformDisplay, this is drawn ONCE
// when waveform data arrives, then only the cursor is updated
// per frame — extremely cheap.
//
// Click anywhere on the bar to seek to that position.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import type { DeckId } from '../../types';
import { CUE_COLORS, themeVar } from '../../theme';

// ── Constants ────────────────────────────────────────────────

const COLOR_PLAYED = 'rgba(0, 0, 0, 0.3)';

interface WaveformOverviewProps {
  deckId: DeckId;
  height?: number;
  /** Shared zoom ref from WaveformDisplay — used for dynamic viewport */
  zoomRef?: React.RefObject<number>;
}

export const WaveformOverview: FC<WaveformOverviewProps> = ({
  deckId,
  height = 16,
  zoomRef: externalZoomRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<ImageData | null>(null);
  const rafRef = useRef(0);
  const [width, setWidth] = useState(400);
  /** Viewport drag state */
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(0);

  // ── Measure container width ────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // #49: Debounce resize to avoid blank canvas flicker.
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) {
        const rounded = Math.floor(w);
        clearTimeout(timer);
        timer = setTimeout(() => {
          setWidth((prev) => Math.abs(prev - rounded) > 2 ? rounded : prev);
        }, 200);
      }
    });
    ro.observe(el);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, []);

  // ── Draw static waveform once when data or size changes ────
  const waveformData = useMixiStore((s) => s.decks[deckId].waveformData);
  const duration = useMixiStore((s) => s.decks[deckId].duration);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData || waveformData.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    ctx.scale(dpr, dpr);

    // Mono overview tinted with deck color — clean, readable silhouette
    const deckColor = deckId === 'A'
      ? themeVar('clr-a', '#00f0ff')
      : themeVar('clr-b', '#ff6a00');
    const COLOR_BG = themeVar('wave-bg', '#111');

    // Clear
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, width, height);

    const halfH = height / 2;
    const pointsPerPixel = waveformData.length / width;

    // Single-color mono bar: max energy across all bands, tinted with deck color at 50%
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = deckColor;
    for (let x = 0; x < width; x++) {
      const startIdx = Math.floor(x * pointsPerPixel);
      const endIdx = Math.min(Math.floor((x + 1) * pointsPerPixel), waveformData.length);
      // Min-Max decimation: peak energy across all bands
      let maxE = 0;
      for (let i = startIdx; i < endIdx; i++) {
        const e = Math.max(waveformData[i].low, waveformData[i].mid, waveformData[i].high);
        if (e > maxE) maxE = e;
      }
      const h = maxE * halfH;
      ctx.fillRect(x, halfH - h, 1, h * 2);
    }
    ctx.globalAlpha = 1;

    // Cache the static image so we don't redraw every frame.
    staticRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [waveformData, width, height, deckId]);

  // ── Animate cursor at 30 FPS ───────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    const dpr = window.devicePixelRatio || 1;
    const engine = MixiEngine.getInstance();
    const COLOR_CURSOR = themeVar('wave-playhead', '#fff');
    const WAVE_DROP = themeVar('wave-drop', '#ff0044');
    const CLR_A = themeVar('clr-a', '#00f0ff');
    const CLR_B = themeVar('clr-b', '#ff6a00');
    const WAVE_LOOP = themeVar('wave-loop', '74, 222, 128');

    let lastFrame = 0;

    function tick() {
      const now = performance.now();
      // 30 FPS is enough for a thin cursor.
      if (now - lastFrame > 33) {
        lastFrame = now;

        // Restore static waveform.
        if (staticRef.current) {
          ctx.putImageData(staticRef.current, 0, 0);
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        const state = useMixiStore.getState().decks[deckId];
        const dur = state.duration;
        if (dur > 0 && engine.isInitialized) {
          const bpm = state.bpm;
          const offset = state.firstBeatOffset;

          // ── Drop markers (red ticks) ─────────────────────
          if (bpm > 0 && state.dropBeats.length > 0) {
            const beatPeriod = 60 / bpm;
            for (let i = 0; i < Math.min(state.dropBeats.length, 4); i++) {
              const dropTime = offset + state.dropBeats[i] * beatPeriod;
              const dx = Math.floor((dropTime / dur) * width);
              ctx.fillStyle = i === 0 ? WAVE_DROP : WAVE_DROP + '88';
              ctx.fillRect(dx, 0, 2, height);
            }
          }

          // ── Hot cue markers (coloured ticks) ─────────────
          const CUE_C = CUE_COLORS;
          for (let i = 0; i < state.hotCues.length; i++) {
            const t = state.hotCues[i];
            if (t === null) continue;
            const cx = Math.floor((t / dur) * width);
            ctx.fillStyle = CUE_C[i] || '#fff';
            ctx.fillRect(cx, 0, 2, height);
          }

          // ── Loop region (green overlay) ──────────────────
          const loop = state.activeLoop;
          if (loop) {
            const lx1 = Math.floor((loop.start / dur) * width);
            const lx2 = Math.floor((loop.end / dur) * width);
            ctx.fillStyle = `rgba(${WAVE_LOOP}, 0.25)`;
            ctx.fillRect(lx1, 0, lx2 - lx1, height);
          }

          // ── Played region ────────────────────────────────
          const currentTime = engine.getCurrentTime(deckId);
          const progress = currentTime / dur;
          const cursorX = Math.floor(progress * width);

          ctx.fillStyle = COLOR_PLAYED;
          ctx.fillRect(0, 0, cursorX, height);

          // ── Viewport rectangle (what's visible in main waveform)
          // Estimate ~4s visible window, playhead at 1/3
          // viewSec scales with zoom: at zoom 1 = ~4s, zoom 0.25 = ~16s, zoom 4 = ~1s
          const zoom = externalZoomRef?.current ?? 1;
          const viewSec = 4 / zoom;
          const viewStartT = Math.max(0, currentTime - viewSec / 3);
          const viewEndT = Math.min(dur, currentTime + (viewSec * 2) / 3);
          const vx1 = Math.floor((viewStartT / dur) * width);
          const vx2 = Math.floor((viewEndT / dur) * width);
          const deckCol = deckId === 'A' ? CLR_A : CLR_B;
          // Viewport fill
          ctx.fillStyle = `${deckCol}08`;
          ctx.fillRect(vx1, 0, vx2 - vx1, height);
          // Viewport border lines — white handles on left/right edges
          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.fillRect(vx1, 0, 1, height);
          ctx.fillRect(vx2, 0, 1, height);

          // ── Cursor line with deck-colour glow ───────────
          ctx.fillStyle = `${deckCol}33`;
          ctx.fillRect(cursorX - 2, 0, 5, height);
          ctx.fillStyle = COLOR_CURSOR;
          ctx.fillRect(cursorX, 0, 1, height);

          // ── Track ending warning (< 30s) ────────────────
          const remaining = dur - currentTime;
          if (remaining > 0 && remaining < 30) {
            // Pulsing red border — intensity varies with time
            const pulse = 0.3 + 0.3 * Math.sin(performance.now() / 300);
            ctx.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, width, height);
          }
        }

        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [deckId, width, height, externalZoomRef]);

  // ── Click to seek / viewport drag ───────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const progress = x / rect.width;
      const clickTime = progress * duration;

      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;

      const currentTime = engine.getCurrentTime(deckId);
      const zoom = externalZoomRef?.current ?? 1;
      const viewSec = 4 / zoom;
      const viewStart = currentTime - viewSec / 3;
      const viewEnd = currentTime + (viewSec * 2) / 3;
      const isInsideViewport = clickTime >= viewStart && clickTime <= viewEnd;

      if (!isInsideViewport) {
        // Click outside viewport: instant seek
        engine.seek(deckId, Math.max(0, Math.min(duration, clickTime)));
        return;
      }

      // Drag mode: remember offset from cursor to current playback time
      isDraggingRef.current = true;
      dragOffsetRef.current = currentTime - clickTime;
      let lastSeek = 0;

      const onMouseMove = (me: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const now = performance.now();
        if (now - lastSeek < 66) return; // throttle to ~15Hz
        lastSeek = now;
        const mx = me.clientX - rect.left;
        const mp = mx / rect.width;
        const targetTime = mp * duration + dragOffsetRef.current;
        engine.seek(deckId, Math.max(0, Math.min(duration, targetTime)));
      };

      const onMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [deckId, duration, externalZoomRef],
  );

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        className="w-full rounded-lg cursor-crosshair shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]"
        style={{ height }}
      />
    </div>
  );
};
