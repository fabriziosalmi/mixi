/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – VFX Visual Engine
//
// Audio-reactive visual layer. When VFX is active:
//   1. Beat flash — screen-wide glow on kick hits
//   2. Neon grid — Tron-style perspective floor
//   3. Scanlines — retro CRT aesthetic
//   4. Circular oscilloscopes around each jog wheel
//
// Performance:
//   - requestAnimationFrame at display refresh
//   - Jog positions cached (updated every 60 frames)
//   - Audio buffers reused (zero GC pressure)
//   - pointer-events:none, mix-blend-mode:screen
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useCallback, type FC } from 'react';
import { MixiEngine } from '../audio/MixiEngine';
import { useMixiStore } from '../store/mixiStore';
import type { DeckId } from '../types';

interface JogPos { cx: number; cy: number; r: number }

export const VfxCanvas: FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const beatEnergyRef = useRef(0);
  const prevLevelRef = useRef(0);
  const hueRef = useRef(0);
  const frameRef = useRef(0);

  // Reusable buffers — allocated once
  const freqBufRef = useRef<Uint8Array | null>(null);
  const waveBufA = useRef<Uint8Array | null>(null);
  const waveBufB = useRef<Uint8Array | null>(null);

  // Cached jog positions — updated every 60 frames
  const jogCacheRef = useRef<JogPos[]>([]);

  const updateJogPositions = useCallback(() => {
    const positions: JogPos[] = [];
    const wheels = document.querySelectorAll('.mixi-chassis svg[viewBox]');
    wheels.forEach((svg) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 150) {
        positions.push({
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          r: rect.width / 2,
        });
      }
    });
    jogCacheRef.current = positions;
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const frame = frameRef.current++;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ── Audio analysis (reused buffer) ───────────────────────
    const engine = MixiEngine.getInstance();
    let level = 0;
    let isBeat = false;

    if (engine.isInitialized) {
      const state = useMixiStore.getState();
      let analyser: AnalyserNode | null = null;
      if (state.decks.A.isPlaying) analyser = engine.channels.A.analyser;
      else if (state.decks.B.isPlaying) analyser = engine.channels.B.analyser;

      if (analyser) {
        if (!freqBufRef.current || freqBufRef.current.length !== analyser.frequencyBinCount) {
          freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqBufRef.current as Uint8Array<ArrayBuffer>);
        const data = freqBufRef.current;
        const bassEnd = Math.floor(data.length * 0.15);
        let sum = 0;
        for (let i = 0; i < bassEnd; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / bassEnd) / 255;
        let fullSum = 0;
        for (let i = 0; i < data.length; i++) fullSum += data[i];
        level = fullSum / (data.length * 255);
        isBeat = rms > 0.4 && rms - prevLevelRef.current > 0.15;
        prevLevelRef.current = rms;
      }
    }

    if (isBeat) beatEnergyRef.current = 1;
    else beatEnergyRef.current *= 0.92;
    const beat = beatEnergyRef.current;

    hueRef.current = (hueRef.current + 0.5 + level * 2) % 360;
    const hue = hueRef.current;

    // ── Clear ────────────────────────────────────────────────
    ctx.clearRect(0, 0, w, h);

    // ── 1. Beat flash ────────────────────────────────────────
    if (beat > 0.1) {
      ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${beat * 0.06})`;
      ctx.fillRect(0, 0, w, h);
    }

    // ── 2. Circular oscilloscopes around jog wheels ──────────
    // Update cached positions every 60 frames (~1s)
    if (frame % 60 === 0) updateJogPositions();
    const jogPositions = jogCacheRef.current;
    const deckIds: DeckId[] = ['A', 'B'];

    if (engine.isInitialized) {
      jogPositions.forEach((jog, idx) => {
        const deckId = deckIds[idx] || 'A';
        const state = useMixiStore.getState();
        if (!state.decks[deckId].isPlaying) return;

        const analyser = engine.channels[deckId].analyser;
        // Reuse waveform buffer
        const bufRef = idx === 0 ? waveBufA : waveBufB;
        if (!bufRef.current || bufRef.current.length !== analyser.frequencyBinCount) {
          bufRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteTimeDomainData(bufRef.current as Uint8Array<ArrayBuffer>);
        const waveData = bufRef.current;

        const oscR = jog.r + 2; // snug to wheel edge
        const bandWidth = 13; // black band width
        const deckColor = idx === 0 ? '#00e5ff' : '#ff9100';

        // Bass-reactive band behind oscilloscope
        const bandIntensity = beat; // 0→1, fast attack slow decay
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(jog.cx, jog.cy, oscR + bandWidth / 2, 0, Math.PI * 2);
        // Dark base → bright yellow flash on bass
        const r = Math.floor(40 + bandIntensity * 215);  // 40→255
        const g = Math.floor(10 + bandIntensity * 220);   // 10→230
        const b2 = Math.floor(5 + bandIntensity * 5);     // stays dark (5→10)
        ctx.strokeStyle = `rgb(${r},${g},${b2})`;
        ctx.lineWidth = bandWidth;
        if (bandIntensity > 0.3) {
          ctx.shadowColor = `rgba(255, 230, 0, ${bandIntensity * 0.4})`;
          ctx.shadowBlur = bandIntensity * 15;
        }
        ctx.stroke();
        ctx.restore();

        // Oscilloscope waveform
        ctx.save();
        ctx.globalAlpha = 0.6 + beat * 0.3;
        ctx.strokeStyle = deckColor;
        ctx.lineWidth = 2.5 + beat * 1.5;
        ctx.shadowColor = deckColor;
        ctx.shadowBlur = 6 + beat * 10;
        ctx.beginPath();

        const len = waveData.length;
        for (let i = 0; i < len; i++) {
          const angle = (i / len) * Math.PI * 2 - Math.PI / 2;
          const amplitude = (waveData[i] - 128) / 128;
          const r = oscR + amplitude * 9;
          const x = jog.cx + Math.cos(angle) * r;
          const y = jog.cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      });
    }

    // ── 3. Scanlines ─────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.025;
    ctx.fillStyle = '#000';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();

    // ── 4. Vignette ──────────────────────────────────────────
    const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
    rafRef.current = requestAnimationFrame(render);
  }, [updateJogPositions]);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      updateJogPositions(); // refresh positions on resize
    };
    resize();
    window.addEventListener('resize', resize);

    beatEnergyRef.current = 0;
    prevLevelRef.current = 0;
    frameRef.current = 0;
    updateJogPositions();

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      window.removeEventListener('resize', resize);
    };
  }, [active, render, updateJogPositions]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9996,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
      }}
    />
  );
};
