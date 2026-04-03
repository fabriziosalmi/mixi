/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – VFX Visual Engine
//
// Audio-reactive visual layer rendered on a fullscreen <canvas>.
// Sits on top of the DJ UI as a transparent overlay.
//
// Effects:
//   1. Particle field — stars that pulse with the beat
//   2. Beat flash — screen-wide glow on kick hits
//   3. Waveform ring — circular oscilloscope
//   4. Scanlines — retro CRT aesthetic
//   5. Neon grid — Tron-style perspective floor
//
// Performance: requestAnimationFrame, GPU-composited canvas,
// pointer-events:none. No impact on audio thread.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useCallback, type FC } from 'react';
import { MixiEngine } from '../audio/MixiEngine';
import { useMixiStore } from '../store/mixiStore';

// ── Particle type ────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  alpha: number;
  life: number;
  maxLife: number;
}

// ── Constants ────────────────────────────────────────────────

const MAX_PARTICLES = 200;
const SPAWN_RATE = 3; // per frame
const GRID_LINES = 12;

// ── Component ────────────────────────────────────────────────

export const VfxCanvas: FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);
  const beatEnergyRef = useRef(0);
  const prevLevelRef = useRef(0);
  const hueRef = useRef(0);

  // ── Audio analysis (read from engine analyser) ─────────────

  const getAudioLevel = useCallback(() => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return { level: 0, isBeat: false };

    // Try to read from master analyser
    const state = useMixiStore.getState();
    const deckA = state.decks.A;
    const deckB = state.decks.B;

    // Use the playing deck's channel analyser
    let analyser: AnalyserNode | null = null;
    if (deckA.isPlaying) {
      analyser = engine.channels.A.analyser;
    } else if (deckB.isPlaying) {
      analyser = engine.channels.B.analyser;
    }

    if (!analyser) return { level: 0, isBeat: false };

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    // RMS level (low frequencies for beat detection)
    let sum = 0;
    const bassEnd = Math.floor(data.length * 0.15); // bottom 15% = bass
    for (let i = 0; i < bassEnd; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / bassEnd) / 255;

    // Full spectrum level
    let fullSum = 0;
    for (let i = 0; i < data.length; i++) {
      fullSum += data[i];
    }
    const level = fullSum / (data.length * 255);

    // Onset detection: sharp rise in bass energy = beat
    const prev = prevLevelRef.current;
    const isBeat = rms > 0.4 && rms - prev > 0.15;
    prevLevelRef.current = rms;

    return { level, isBeat };
  }, []);

  // ── Particle management ────────────────────────────────────

  const spawnParticle = useCallback((w: number, h: number, energy: number) => {
    const particles = particlesRef.current;
    if (particles.length >= MAX_PARTICLES) return;

    const angle = Math.random() * Math.PI * 2;
    const speed = 0.3 + energy * 2 + Math.random() * 1.5;
    const maxLife = 80 + Math.random() * 120;

    particles.push({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h / 2 + (Math.random() - 0.5) * h * 0.3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1 + Math.random() * 2.5 + energy * 2,
      hue: hueRef.current + Math.random() * 60,
      alpha: 0.6 + Math.random() * 0.4,
      life: 0,
      maxLife,
    });
  }, []);

  // ── Main render loop ───────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    timeRef.current++;

    // Audio analysis
    const { level, isBeat } = getAudioLevel();

    // Beat energy (decays smoothly)
    if (isBeat) {
      beatEnergyRef.current = 1;
    } else {
      beatEnergyRef.current *= 0.92;
    }
    const beat = beatEnergyRef.current;

    // Hue rotation
    hueRef.current = (hueRef.current + 0.5 + level * 2) % 360;
    const hue = hueRef.current;

    // ── Clear ────────────────────────────────────────────────
    ctx.clearRect(0, 0, w, h);

    // ── 1. Beat flash ────────────────────────────────────────
    if (beat > 0.1) {
      const flashAlpha = beat * 0.08;
      ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${flashAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // ── 2. Neon grid (perspective floor) ──────────────────────
    const gridY = h * 0.65;
    const vanishX = w / 2;
    const vanishY = h * 0.35;
    ctx.save();
    ctx.globalAlpha = 0.12 + beat * 0.15;
    ctx.strokeStyle = `hsla(${hue + 180}, 100%, 60%, 0.6)`;
    ctx.lineWidth = 0.5;

    // Horizontal grid lines
    for (let i = 0; i < GRID_LINES; i++) {
      const t2 = i / GRID_LINES;
      const y = gridY + (h - gridY) * t2;
      const spread = 1 + t2 * 2;
      ctx.beginPath();
      ctx.moveTo(vanishX - w * spread * 0.6, y);
      ctx.lineTo(vanishX + w * spread * 0.6, y);
      ctx.stroke();
    }

    // Vertical perspective lines
    for (let i = -6; i <= 6; i++) {
      const xOff = i * (w / 12);
      ctx.beginPath();
      ctx.moveTo(vanishX, vanishY);
      ctx.lineTo(vanishX + xOff * 3, h);
      ctx.stroke();
    }
    ctx.restore();

    // ── 3. Waveform ring ─────────────────────────────────────
    const engine = MixiEngine.getInstance();
    if (engine.isInitialized) {
      const state = useMixiStore.getState();
      const playingDeck = state.decks.A.isPlaying ? 'A' : state.decks.B.isPlaying ? 'B' : null;
      
      if (playingDeck) {
        const analyser = engine.channels[playingDeck].analyser;
        const waveData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(waveData);

        const cx = w / 2;
        const cy = h * 0.42;
        const baseR = Math.min(w, h) * 0.12 + beat * 20;

        ctx.save();
        ctx.globalAlpha = 0.5 + beat * 0.3;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.8)`;
        ctx.lineWidth = 1.5 + beat * 2;
        ctx.shadowColor = `hsla(${hue}, 100%, 60%, 0.6)`;
        ctx.shadowBlur = 8 + beat * 15;
        ctx.beginPath();

        for (let i = 0; i < waveData.length; i++) {
          const angle = (i / waveData.length) * Math.PI * 2;
          const amplitude = (waveData[i] - 128) / 128;
          const r = baseR + amplitude * 40;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── 4. Particles ─────────────────────────────────────────
    // Spawn
    const spawnCount = Math.floor(SPAWN_RATE + level * 5 + beat * 8);
    for (let i = 0; i < spawnCount; i++) {
      spawnParticle(w, h, level);
    }

    // Update & draw
    const particles = particlesRef.current;
    ctx.save();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life++;
      if (p.life > p.maxLife) {
        particles.splice(i, 1);
        continue;
      }

      // Move
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.005; // gentle gravity

      // Beat pulse: expand on hit
      const beatPulse = beat > 0.3 ? 1 + beat * 0.5 : 1;

      // Fade
      const lifeRatio = p.life / p.maxLife;
      const fadeIn = Math.min(1, p.life / 10);
      const fadeOut = 1 - Math.pow(lifeRatio, 2);
      const alpha = p.alpha * fadeIn * fadeOut;

      const size = p.size * beatPulse;

      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue % 360}, 90%, 70%, ${alpha})`;
      ctx.shadowColor = `hsla(${p.hue % 360}, 100%, 60%, ${alpha * 0.5})`;
      ctx.shadowBlur = size * 3;
      ctx.fill();
    }
    ctx.restore();

    // ── 5. Scanlines ─────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = '#000';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();

    // ── 6. Vignette ──────────────────────────────────────────
    const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.7);
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // Loop
    rafRef.current = requestAnimationFrame(render);
  }, [getAudioLevel, spawnParticle]);

  // ── Lifecycle ──────────────────────────────────────────────

  useEffect(() => {
    if (!active) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      particlesRef.current = [];
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Match canvas to screen resolution
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // Reset state
    timeRef.current = 0;
    beatEnergyRef.current = 0;
    prevLevelRef.current = 0;
    particlesRef.current = [];

    // Start render loop
    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      window.removeEventListener('resize', resize);
    };
  }, [active, render]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="mixi-vfx-canvas"
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
