/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Master LED Screen (Stereo Spatializer / Vectorscope)
//
// Canvas-based Lissajous display of the master stereo field.
// Plots (L+R) vs (R-L) from real-time time-domain data.
//
// With clean audio: tight vertical line (mono) or oval (stereo).
// With distortion active: explodes into wild patterns — magnetic.
//
// Also shows: LIM LED (limiter active) and stereo correlation.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useCallback, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { themeVar } from '../../theme';
import noiseUrl from '../../../assets/noise.png';

// ── Constants ──────────────────────────────────────────────

const DOT_ALPHA = 0.55;          // per-dot opacity
const DECAY = 0.12;              // trail fade per frame (lower = longer trails)
const GAIN = 3.5;                // visual amplification (wider spread for bass-heavy content)

const DOT_COLOR_R = 168;         // #a855f7 → R
const DOT_COLOR_G = 85;          //          → G
const DOT_COLOR_B = 247;         //          → B

// ── Component ──────────────────────────────────────────────

export const MasterLedScreen: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const bufLRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const bufRRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const corrRef = useRef(0);
  const levelLRef = useRef(0);
  const levelRRef = useRef(0);

  const drawRef = useRef<() => void>(undefined);
  const lastDrawRef = useRef(0);
  const draw = useCallback(() => {
    if (!drawRef.current) return;

    // Throttle to ~30fps (skip every other frame)
    const now = performance.now();
    if (now - lastDrawRef.current < 30) {
      rafRef.current = requestAnimationFrame(drawRef.current);
      return;
    }
    lastDrawRef.current = now;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const engine = MixiEngine.getInstance();
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    // Fade previous frame (trail effect)
    ctx.fillStyle = `rgba(5, 5, 5, ${DECAY})`;
    ctx.fillRect(0, 0, w, h);

    if (!engine.isInitialized) {
      // Draw faint MIXI logo when no audio engine
      ctx.fillStyle = `rgba(5, 5, 5, ${DECAY})`;
      ctx.fillRect(0, 0, w, h);
      ctx.font = `bold ${Math.round(h * 0.28)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(168, 85, 247, 0.06)';
      ctx.fillText('MIXI', cx, cy);
      rafRef.current = requestAnimationFrame(drawRef.current);
      return;
    }

    // Allocate buffers once
    const size = engine.stereoAnalyserSize;
    if (!bufLRef.current || bufLRef.current.length !== size) {
      bufLRef.current = new Float32Array(size);
      bufRRef.current = new Float32Array(size);
    }

    const bufL = bufLRef.current;
    const bufR = bufRRef.current!;
    const count = engine.getMasterStereoData(bufL, bufR);

    // Limiter state

    // ── Draw crosshair (very faint) ──────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    // Vertical (mono axis)
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
    // Horizontal (side axis)
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    // Diagonal guides (L and R axes)
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(0, h);
    ctx.stroke();

    // ── Plot Lissajous dots ──────────────────────────────────
    // Standard vectorscope: X = (R-L)/√2, Y = -(L+R)/√2
    const scale = Math.min(cx, cy) * GAIN;
    const invSqrt2 = 0.7071;

    // Pre-compute 256-entry RGBA string LUT — eliminates ~2048
    // template string allocations per frame (61k allocs/sec saved).
    const alphaLUT: string[] = new Array(256);
    for (let a = 0; a < 256; a++) {
      alphaLUT[a] = `rgba(${DOT_COLOR_R},${DOT_COLOR_G},${DOT_COLOR_B},${(a / 255).toFixed(3)})`;
    }

    let sumCorr = 0;
    let sumL2 = 0;
    let sumR2 = 0;

    for (let i = 0; i < count; i++) {
      const l = bufL[i];
      const r = bufR[i];

      const x = (r - l) * invSqrt2;
      const y = -(l + r) * invSqrt2;

      // Correlation accumulator
      sumCorr += l * r;
      sumL2 += l * l;
      sumR2 += r * r;

      const px = cx + x * scale;
      const py = cy + y * scale;

      // Distance from center → intensity (quantized to LUT index)
      const dist = Math.sqrt(x * x + y * y);
      const alphaIdx = Math.min(255, (DOT_ALPHA + dist * 0.8) * 255) | 0;

      ctx.fillStyle = alphaLUT[alphaIdx];
      ctx.fillRect(px - 0.5, py - 0.5, 1.5, 1.5);
    }

    // Stereo correlation
    const denom = Math.sqrt(sumL2 * sumR2);
    corrRef.current = denom > 0.0001 ? sumCorr / denom : 0;

    // L/R RMS levels (0–1)
    levelLRef.current = Math.min(1, Math.sqrt(sumL2 / count) * 1.414);
    levelRRef.current = Math.min(1, Math.sqrt(sumR2 / count) * 1.414);

    if (drawRef.current) rafRef.current = requestAnimationFrame(drawRef.current);
  }, []);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas resolution to match CSS size
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Init background
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) {
      ctx.fillStyle = themeVar('srf-deep', '#050505');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />
      {/* Noise overlay — matches global chassis grain so it doesn't look like a sticker */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.035,
          backgroundImage: `url(${noiseUrl})`,
          backgroundSize: '64px 64px',
          backgroundRepeat: 'repeat',
          borderRadius: 'inherit',
        }}
      />

      {/* ── Stereo level bars (bottom) ──────────────────────── */}
      <StereoLevelBars levelLRef={levelLRef} levelRRef={levelRRef} />
    </div>
  );
};


// ── Stereo Level Bars (bottom of HUD) ──────────────────────
// Two rows of LED segments growing from center outward.
// L grows left, R grows right. Grey → white with glow at peaks.

const STEREO_SEGS = 8; // segments per channel (from center to edge)

const StereoLevelBars: FC<{
  levelLRef: React.RefObject<number>;
  levelRRef: React.RefObject<number>;
}> = ({ levelLRef, levelRRef }) => {
  const rowLRef = useRef<HTMLDivElement>(null);
  const rowRRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const lL = levelLRef.current;
      const lR = levelRRef.current;
      updateRow(rowLRef.current, lL);
      updateRow(rowRRef.current, lR);
    }, 50);
    return () => clearInterval(interval);
  }, [levelLRef, levelRRef]);

  return (
    <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-[1px] px-0.5 pb-0.5">
      {/* L channel — segments grow from right (center) to left (edge) */}
      <div ref={rowLRef} className="flex flex-row-reverse gap-[1px]" style={{ height: 3 }}>
        {Array.from({ length: STEREO_SEGS }, (_, i) => (
          <div
            key={i}
            className="flex-1 rounded-[0.5px]"
            style={{ background: 'var(--led-off)', transition: 'background 0.06s, box-shadow 0.06s' }}
          />
        ))}
      </div>
      {/* R channel — segments grow from left (center) to right (edge) */}
      <div ref={rowRRef} className="flex flex-row gap-[1px]" style={{ height: 3 }}>
        {Array.from({ length: STEREO_SEGS }, (_, i) => (
          <div
            key={i}
            className="flex-1 rounded-[0.5px]"
            style={{ background: 'var(--led-off)', transition: 'background 0.06s, box-shadow 0.06s' }}
          />
        ))}
      </div>
    </div>
  );
};

function updateRow(row: HTMLDivElement | null, level: number): void {
  if (!row) return;
  const segs = row.children;
  const lit = Math.round(level * STEREO_SEGS);
  for (let i = 0; i < segs.length; i++) {
    const el = segs[i] as HTMLElement;
    if (i < lit) {
      const intensity = i / STEREO_SEGS;
      if (intensity > 0.75) {
        el.style.background = 'var(--txt-white)';
        el.style.boxShadow = '0 0 3px rgba(255,255,255,0.4)';
      } else {
        el.style.background = `rgb(${120 + intensity * 135}, ${120 + intensity * 135}, ${120 + intensity * 135})`;
        el.style.boxShadow = 'none';
      }
    } else {
      el.style.background = 'var(--led-off)';
      el.style.boxShadow = 'none';
    }
  }
}
