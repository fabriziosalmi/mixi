/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileVuMeter — Thin horizontal RMS level bar
//
// Reads engine.getLevel(deckId) at ~30fps via RAF.
// Color: green → amber → red based on level.
// Renders as a 4px tall bar below the waveform.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import type { DeckId } from '../../types';

interface MobileVuMeterProps {
  deckId: DeckId;
  color: string;
}

const FRAME_INTERVAL = 33; // ~30 FPS

export const MobileVuMeter: FC<MobileVuMeterProps> = ({ deckId, color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d', { alpha: false })!;
    const dpr = window.devicePixelRatio || 1;
    const height = 4;

    let width = container.clientWidth;
    const setup = (w: number) => {
      width = w;
      canvas.width = w * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    setup(width);

    const engine = MixiEngine.getInstance();
    let lastDraw = 0;
    let rafId = 0;
    let peakHold = 0;
    let peakDecay = 0;

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      if (now - lastDraw < FRAME_INTERVAL) return;
      lastDraw = now;

      // Background
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);

      if (!engine.isInitialized) return;

      const level = engine.getLevel(deckId); // 0.0 – 1.0+
      const clamped = Math.min(1, level);

      // Peak hold
      if (clamped > peakHold) {
        peakHold = clamped;
        peakDecay = 0;
      } else {
        peakDecay++;
        if (peakDecay > 30) { // ~1 second hold
          peakHold = Math.max(0, peakHold - 0.02);
        }
      }

      // Level bar with horizontal gradient (deck color → amber → red)
      const barW = clamped * width;
      if (barW > 0) {
        const barGrad = ctx.createLinearGradient(0, 0, width, 0);
        barGrad.addColorStop(0, `${color}99`);
        barGrad.addColorStop(0.65, `${color}88`);
        barGrad.addColorStop(0.8, '#f59e0b88');
        barGrad.addColorStop(1.0, '#ef444499');
        ctx.fillStyle = barGrad;
        ctx.fillRect(0, 0, barW, height);

        // Subtle glow at the bar tip
        if (clamped > 0.1) {
          const tipGrad = ctx.createRadialGradient(barW, height / 2, 0, barW, height / 2, 6);
          tipGrad.addColorStop(0, clamped > 0.9 ? '#ef444466' : `${color}44`);
          tipGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = tipGrad;
          ctx.fillRect(barW - 6, 0, 12, height);
        }
      }

      // Peak indicator with glow
      if (peakHold > 0.01) {
        const peakX = peakHold * width;
        ctx.save();
        ctx.shadowColor = peakHold > 0.9 ? '#ef4444' : color;
        ctx.shadowBlur = 4;
        ctx.fillStyle = peakHold > 0.9 ? '#ef4444' : '#ffffffbb';
        ctx.fillRect(peakX - 1, 0, 2, height);
        ctx.restore();
      }
    };

    rafId = requestAnimationFrame(draw);

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0 && Math.abs(width - w) > 2) {
        setup(w | 0);
      }
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [deckId, color]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: 4, borderRadius: 2, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
};
