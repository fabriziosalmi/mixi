/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – VFX Visual Engine (Dual-Mode: WebGPU + Canvas 2D)
//
// WebGPU path (Chrome, Firefox, Electron):
//   Full-screen GPU shader with 6 audio-reactive effects
//   + Canvas 2D overlay for circular oscilloscopes
//
// Canvas 2D fallback (Safari, web):
//   Beat flash, oscilloscopes, scanlines, vignette
//
// Performance:
//   - Single draw call per frame (WebGPU: 560 bytes uploaded)
//   - Audio buffers reused (zero GC pressure)
//   - pointer-events:none + mix-blend-mode:screen
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useCallback, useState, type FC } from 'react';
import { MixiEngine } from '../audio/MixiEngine';
import { useMixiStore } from '../store/mixiStore';
import { detectGpuBackend, type GpuBackend } from '../gpu/detectGpu';
import { WebGpuRenderer, type VfxFrameParams } from '../gpu/WebGpuRenderer';
import { themeVar } from '../theme';
import type { DeckId } from '../types';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

interface JogPos { cx: number; cy: number; r: number }

export const VfxCanvas: FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const beatEnergyRef = useRef(0);
  const prevLevelRef = useRef(0);
  const hueRef = useRef(0);
  const frameRef = useRef(0);
  const beatCountRef = useRef(0);
  const startTimeRef = useRef(0);

  // GPU state
  const rendererRef = useRef<WebGpuRenderer | null>(null);
  const [backend, setBackend] = useState<GpuBackend>('canvas2d');

  // Reusable buffers — allocated once
  const freqBufRef = useRef<Uint8Array | null>(null);
  const waveBufA = useRef<Uint8Array | null>(null);
  const waveBufB = useRef<Uint8Array | null>(null);
  // Secret #3: Peak hold buffer (slower decay than raw FFT)
  const peakBufRef = useRef(new Float32Array(128));
  // Secret #24: Parsed CSS deck colors
  const deckAColorRef = useRef<[number, number, number]>(hexToRgb('#00f0ff'));
  const deckBColorRef = useRef<[number, number, number]>(hexToRgb('#ff6a00'));

  // Cached jog positions — updated every 60 frames
  const jogCacheRef = useRef<JogPos[]>([]);
  // Cached vignette gradient — rebuilt on resize only (Canvas 2D fallback)
  const vignetteRef = useRef<CanvasGradient | null>(null);

  // ── Cached store fields via subscription (avoid getState per frame) ──
  const cachedStore = useRef({
    crossfader: 0.5, playingA: false, playingB: false,
    bpmA: 0, bpmB: 0, offsetA: 0, offsetB: 0, colorFxA: 0, colorFxB: 0,
  });
  useEffect(() => {
    const sync = () => {
      const s = useMixiStore.getState();
      cachedStore.current = {
        crossfader: s.crossfader,
        playingA: s.decks.A.isPlaying, playingB: s.decks.B.isPlaying,
        bpmA: s.decks.A.bpm, bpmB: s.decks.B.bpm,
        offsetA: s.decks.A.firstBeatOffset, offsetB: s.decks.B.firstBeatOffset,
        colorFxA: s.decks.A.colorFx ?? 0, colorFxB: s.decks.B.colorFx ?? 0,
      };
    };
    sync();
    return useMixiStore.subscribe(sync);
  }, []);

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

  // ── Shared audio analysis (VJ Secrets #4, #5, #6) ──────────
  //
  // Secret #4: Isolated stems — kick (20-80Hz), snare (1-3kHz), hihat (8-15kHz)
  // Secret #5: BPM phase sync — 0→1 sawtooth
  // Secret #6: Energy derivative — dEnergy/dt
  //
  // Frequency bin mapping (fftSize=256, SR=44100, 128 bins):
  //   bin_freq = bin * (44100 / 256) = bin * 172.27 Hz
  //   kick  (20-80Hz):    bins 0-0   → bin 0 (172Hz width covers range)
  //   snare (1-3kHz):     bins 6-17  (1034-2929Hz)
  //   hihat (8-15kHz):    bins 46-87 (7930-14990Hz)

  interface AudioFrame {
    level: number;
    isBeat: boolean;
    kick: number;
    snare: number;
    hihat: number;
    beatPhase: number;
    energyDeriv: number;
    totalEnergy: number;
    crossfader: number;
    colorFilter: number;          // #25: -1(LPF)→+1(HPF)
    fftBins: Uint8Array | null;
    peakBins: Float32Array;       // #3: peak-held 0..1
  }

  const prevEnergyRef = useRef(0);

  const analyzeAudio = useCallback((): AudioFrame => {
    const result: AudioFrame = {
      level: 0, isBeat: false, kick: 0, snare: 0, hihat: 0,
      beatPhase: 0, energyDeriv: 0, totalEnergy: 0, crossfader: 0.5,
      colorFilter: 0, fftBins: null, peakBins: peakBufRef.current,
    };
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return result;

    const cs = cachedStore.current;
    result.crossfader = cs.crossfader;

    let analyser: AnalyserNode | null = null;
    if (cs.playingA) analyser = engine.channels.A.analyser;
    else if (cs.playingB) analyser = engine.channels.B.analyser;

    if (!analyser) return result;

    if (!freqBufRef.current || freqBufRef.current.length !== analyser.frequencyBinCount) {
      freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(freqBufRef.current as Uint8Array<ArrayBuffer>);
    const data = freqBufRef.current;
    result.fftBins = data;

    // Secret #4: Isolated stems (precise frequency ranges)
    // Kick (20-80Hz → bins 0-2, ~0-516Hz at 172Hz/bin resolution)
    // Skip bin 0 (DC component), use bins 1-2 for actual kick energy
    result.kick = Math.max(data[1], data[2]) / 255;

    // Snare (1-3kHz → bins 6-17)
    let snareSum = 0;
    for (let i = 6; i <= 17; i++) snareSum += data[i] * data[i];
    result.snare = Math.sqrt(snareSum / 12) / 255;

    // Hihat (8-15kHz → bins 46-87)
    let hihatSum = 0;
    for (let i = 46; i <= 87; i++) hihatSum += data[i] * data[i];
    result.hihat = Math.sqrt(hihatSum / 42) / 255;

    // Overall level + total energy
    let fullSum = 0;
    for (let i = 0; i < data.length; i++) fullSum += data[i];
    result.level = fullSum / (data.length * 255);
    result.totalEnergy = result.level;

    // Secret #6: Energy derivative (dEnergy/dt) — tracks overall energy change
    result.energyDeriv = Math.max(0, result.totalEnergy - prevEnergyRef.current);
    prevEnergyRef.current = result.totalEnergy;

    // Beat detection (kick threshold + rate-of-change)
    result.isBeat = result.kick > 0.4 && result.energyDeriv > 0.15;
    prevLevelRef.current = result.kick;

    // Secret #5: BPM phase sync (0→1 sawtooth)
    const activeBpm = cs.playingA ? cs.bpmA : cs.bpmB;
    const activeOffset = cs.playingA ? cs.offsetA : cs.offsetB;
    if (activeBpm > 0) {
      const beatPeriod = 60 / activeBpm;
      const ctx = engine.getAudioContext();
      const currentTime = ctx.currentTime;
      result.beatPhase = (((currentTime - activeOffset) / beatPeriod) % 1 + 1) % 1;
    }

    // Secret #25: Color filter state from active deck
    result.colorFilter = cs.playingA ? cs.colorFxA : cs.colorFxB;

    // Secret #3: Peak hold buffer (slower decay for ring texture)
    const peakBuf = peakBufRef.current;
    for (let i = 0; i < 128; i++) {
      const current = i < data.length ? data[i] / 255 : 0;
      peakBuf[i] = Math.max(peakBuf[i] * 0.95, current);
    }

    return result;
  }, []);

  // ── Oscilloscope drawing (shared between both paths) ──────

  const drawOscilloscopes = useCallback((ctx: CanvasRenderingContext2D, beat: number) => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const jogPositions = jogCacheRef.current;
    const deckIds: DeckId[] = ['A', 'B'];

    jogPositions.forEach((jog, idx) => {
      const deckId = deckIds[idx] || 'A';
      const cs = cachedStore.current;
      if (!(deckId === 'A' ? cs.playingA : cs.playingB)) return;

      const analyser = engine.channels[deckId].analyser;
      const bufRef = idx === 0 ? waveBufA : waveBufB;
      if (!bufRef.current || bufRef.current.length !== analyser.frequencyBinCount) {
        bufRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteTimeDomainData(bufRef.current as Uint8Array<ArrayBuffer>);
      const waveData = bufRef.current;

      const oscR = jog.r + 2;
      const bandWidth = 13;
      const deckColor = idx === 0 ? '#00e5ff' : '#ff9100';

      // Bass-reactive band
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(jog.cx, jog.cy, oscR + bandWidth / 2, 0, Math.PI * 2);
      const r = Math.floor(beat * 255);
      const g = Math.floor(beat * 230);
      const b2 = Math.floor(beat * 10);
      ctx.strokeStyle = `rgb(${r},${g},${b2})`;
      ctx.lineWidth = bandWidth;
      if (beat > 0.3) {
        ctx.shadowColor = `rgba(255, 230, 0, ${beat * 0.4})`;
        ctx.shadowBlur = beat * 15;
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
        const rad = oscR + amplitude * 9;
        const x = jog.cx + Math.cos(angle) * rad;
        const y = jog.cy + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    });
  }, []);

  // ── WebGPU render loop ────────────────────────────────────

  const renderGpu = useCallback(function gpuLoop() {
    const renderer = rendererRef.current;
    if (!renderer || renderer.destroyed) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const frame = frameRef.current++;

    // Audio analysis
    const audio = analyzeAudio();

    if (audio.isBeat) {
      beatEnergyRef.current = 1;
      beatCountRef.current++;
    } else {
      beatEnergyRef.current *= 0.92;
    }

    hueRef.current = (hueRef.current + 0.5 + audio.level * 2) % 360;

    // GPU render (full-screen effects)
    const params: VfxFrameParams = {
      width: w,
      height: h,
      time: (performance.now() - startTimeRef.current) / 1000,
      beatEnergy: beatEnergyRef.current,
      kick: audio.kick,
      snare: audio.snare,
      hihat: audio.hihat,
      hue: hueRef.current,
      beatCount: beatCountRef.current,
      beatPhase: audio.beatPhase,
      energyDeriv: audio.energyDeriv,
      totalEnergy: audio.totalEnergy,
      crossfader: audio.crossfader,
      colorFilter: audio.colorFilter,
      ringWritePos: frameRef.current % 64,
      feedbackAmount: 0.85,  // #14: aggressive feedback trails
      deckAColor: deckAColorRef.current,
      deckBColor: deckBColorRef.current,
      fftBins: audio.fftBins || new Uint8Array(128),
      peakBins: audio.peakBins,
    };
    renderer.render(params);

    // Canvas 2D overlay: oscilloscopes only
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (frame % 60 === 0) updateJogPositions();
    drawOscilloscopes(ctx, beatEnergyRef.current);

    ctx.restore();
    rafRef.current = requestAnimationFrame(gpuLoop);
  }, [analyzeAudio, drawOscilloscopes, updateJogPositions]);

  // ── Canvas 2D fallback render loop ─────────────────────────

  const renderCanvas2d = useCallback(function canvasLoop() {
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

    // Audio analysis
    const audio = analyzeAudio();

    if (audio.isBeat) beatEnergyRef.current = 1;
    else beatEnergyRef.current *= 0.92;
    const beat = beatEnergyRef.current;

    hueRef.current = (hueRef.current + 0.5 + audio.level * 2) % 360;
    const hue = hueRef.current;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // 1. Beat flash
    if (beat > 0.1) {
      ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${beat * 0.06})`;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Circular oscilloscopes
    if (frame % 60 === 0) updateJogPositions();
    drawOscilloscopes(ctx, beat);

    // 3. Scanlines
    ctx.save();
    ctx.globalAlpha = 0.025;
    ctx.fillStyle = '#000';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();

    // 4. Vignette (cached gradient)
    if (vignetteRef.current) {
      ctx.fillStyle = vignetteRef.current;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.restore();
    rafRef.current = requestAnimationFrame(canvasLoop);
  }, [analyzeAudio, drawOscilloscopes, updateJogPositions]);

  // ── Secret #29: Emergency Kill-Switch (ESC) ─────────────────
  // Instantly kills GPU shaders and clears buffers if visuals
  // cause problems (GPU runaway, epilepsy concern, etc.)

  useEffect(() => {
    if (!active) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rendererRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        rendererRef.current.destroy();
        rendererRef.current = null;
        setBackend('canvas2d');
        console.warn('[mixi-vfx] Emergency kill-switch: GPU renderer destroyed');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // ── Lifecycle ─────────────────────────────────────────────

  useEffect(() => {
    if (!active) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      return;
    }

    let cancelled = false;

    async function init() {
      // Secret #24: Parse CSS deck colors
      deckAColorRef.current = hexToRgb(themeVar('clr-a', '#00f0ff'));
      deckBColorRef.current = hexToRgb(themeVar('clr-b', '#ff6a00'));

      // Detect GPU backend
      const detected = await detectGpuBackend();
      if (cancelled) return;
      setBackend(detected);

      // Setup Canvas 2D (always needed — oscilloscopes or fallback)
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;

      startTimeRef.current = performance.now();
      beatEnergyRef.current = 0;
      prevLevelRef.current = 0;
      frameRef.current = 0;
      beatCountRef.current = 0;
      updateJogPositions();

      if (detected === 'webgpu' && gpuCanvasRef.current) {
        // Setup WebGPU canvas
        const gpuCanvas = gpuCanvasRef.current;
        gpuCanvas.width = window.innerWidth * dpr;
        gpuCanvas.height = window.innerHeight * dpr;
        gpuCanvas.style.width = `${window.innerWidth}px`;
        gpuCanvas.style.height = `${window.innerHeight}px`;

        try {
          const renderer = await WebGpuRenderer.create(gpuCanvas, () => {
            // Device lost callback — fall back to Canvas 2D
            console.warn('[mixi-vfx] GPU device lost, falling back to Canvas 2D');
            rendererRef.current = null;
            setBackend('canvas2d');
          });

          if (cancelled) {
            renderer.destroy();
            return;
          }

          rendererRef.current = renderer;
          console.log('[mixi-vfx] WebGPU renderer active');
          rafRef.current = requestAnimationFrame(renderGpu);
        } catch (err) {
          console.warn('[mixi-vfx] WebGPU init failed, using Canvas 2D:', err);
          setBackend('canvas2d');
          setupCanvas2dFallback(canvas);
          rafRef.current = requestAnimationFrame(renderCanvas2d);
        }
      } else {
        // Canvas 2D fallback
        setupCanvas2dFallback(canvas);
        rafRef.current = requestAnimationFrame(renderCanvas2d);
      }
    }

    function setupCanvas2dFallback(canvas: HTMLCanvasElement) {
      const ctx2 = canvas.getContext('2d');
      if (ctx2) {
        const w = window.innerWidth;
        const vig = ctx2.createRadialGradient(
          w / 2, window.innerHeight / 2, w * 0.25,
          w / 2, window.innerHeight / 2, w * 0.7,
        );
        vig.addColorStop(0, 'transparent');
        vig.addColorStop(1, 'rgba(0,0,0,0.35)');
        vignetteRef.current = vig;
      }
    }

    init();

    const onResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        setupCanvas2dFallback(canvas);
      }
      const gpuCanvas = gpuCanvasRef.current;
      if (gpuCanvas) {
        gpuCanvas.width = window.innerWidth * dpr;
        gpuCanvas.height = window.innerHeight * dpr;
        gpuCanvas.style.width = `${window.innerWidth}px`;
        gpuCanvas.style.height = `${window.innerHeight}px`;
      }
      rendererRef.current?.resize(window.innerWidth, window.innerHeight);
      updateJogPositions();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      window.removeEventListener('resize', onResize);
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, [active, renderGpu, renderCanvas2d, updateJogPositions]);

  if (!active) return null;

  const canvasStyle = {
    position: 'fixed' as const,
    inset: 0,
    pointerEvents: 'none' as const,
    mixBlendMode: 'screen' as const,
  };

  return (
    <>
      {/* WebGPU full-screen effects (bottom layer) */}
      <canvas
        ref={gpuCanvasRef}
        style={{
          ...canvasStyle,
          zIndex: 9996,
          display: backend === 'webgpu' ? 'block' : 'none',
        }}
      />
      {/* Canvas 2D: oscilloscopes (WebGPU mode) or all effects (fallback) */}
      <canvas
        ref={canvasRef}
        style={{
          ...canvasStyle,
          zIndex: backend === 'webgpu' ? 9997 : 9996,
        }}
      />
    </>
  );
};
