/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import {
  POINTS_PER_SECOND,
  BAR_STEP,
  PLAYHEAD_RATIO,
  BAR_WIDTH,
  CUE_COLORS,
} from './waveformConstants';
import type { WaveformPoint } from '../../types';

// ── Phase overlay constants ─────────────────────────────────
const PHASE_OVERLAY_ALPHA_ALIGNED = 0.30;
const PHASE_OVERLAY_ALPHA_DIFF = 0.25;
const PHASE_DIFF_THRESHOLD = 0.10;

// Pre-baked RGBA color LUT (26 steps, 0.00–0.25 alpha) — zero string allocation in draw loop
const _OVERLAY_WHITE: string[] = [];
const _OVERLAY_RED: string[] = [];
const _OVERLAY_CYAN: string[] = [];
for (let i = 0; i <= 25; i++) {
  const a = (i / 100).toFixed(2);
  _OVERLAY_WHITE.push(`rgba(255,255,255,${a})`);
  _OVERLAY_RED.push(`rgba(255,60,60,${a})`);
  _OVERLAY_CYAN.push(`rgba(0,240,255,${a})`);
}

function overlayColor(type: 0 | 1 | 2, alpha: number): string {
  const idx = Math.min(25, (alpha * 100 + 0.5) | 0);
  return type === 0 ? _OVERLAY_WHITE[idx] : type === 1 ? _OVERLAY_RED[idx] : _OVERLAY_CYAN[idx];
}

// ── State variables ──────────────────────────────────────────

const state = {
  waveform: null as WaveformPoint[] | null,
  hotCues: [] as (number | null)[],
  dropBeats: [] as number[],
  bpm: 0,
  firstBeatOffset: 0,
  activeLoop: null as { start: number; end: number; lengthInBeats: number } | null,

  otherWaveform: null as WaveformPoint[] | null,
  otherBpm: 0,
  otherIsPlaying: false,

  fpsLimit: 60,
  showPhaseOverlay: true,
};

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let colors: Record<string, string> = {};
let width = 500;
let height = 80;
let dpr = 1;

let isPlaying = false;
let playbackRate = 1.0;
let otherPlaybackRate = 1.0;
let currentTime = 0;
let otherTime = 0;
let isSlipActive = false;
let slipRealTime = -1;

let zoom = 1.0;

let lastTickLocalTime = 0;
let lastDraw = 0;
let rafId = 0;
let gridFlash: { x: number; until: number } | null = null;

let beatGrads: { top: CanvasGradient; bot: CanvasGradient }[] = [];

function updateGradients() {
  if (!ctx) return;
  const halfHeight = height / 2;
  const fadeH = halfHeight * 0.6;
  beatGrads = [0.12, 0.35].map((alpha) => {
    const top = ctx!.createLinearGradient(0, 0, 0, fadeH);
    top.addColorStop(0, `rgba(255,255,255,${alpha})`);
    top.addColorStop(1, 'rgba(255,255,255,0)');
    const bot = ctx!.createLinearGradient(0, height - fadeH, 0, height);
    bot.addColorStop(0, 'rgba(255,255,255,0)');
    bot.addColorStop(1, `rgba(255,255,255,${alpha})`);
    return { top, bot };
  });
}

// ── Draw loop ───────────────────────────────────────────────

function draw() {
  if (!ctx || !canvas) {
    rafId = requestAnimationFrame(draw);
    return;
  }

  const now = performance.now();
  const interval = state.fpsLimit === 30 ? 33 : 0;
  if (interval && now - lastDraw < interval) {
    rafId = requestAnimationFrame(draw);
    return;
  }
  lastDraw = now;

  let computedCurrentTime = currentTime;
  let computedOtherTime = otherTime;

  // Real-time interpolation to guarantee absolute smoothness during main-thread blocking
  if (isPlaying && lastTickLocalTime > 0) {
    const elapsed = (now - lastTickLocalTime) / 1000;
    computedCurrentTime = currentTime + elapsed * playbackRate;
  }

  if (state.otherIsPlaying && lastTickLocalTime > 0) {
    const elapsed = (now - lastTickLocalTime) / 1000;
    computedOtherTime = otherTime + elapsed * otherPlaybackRate;
  }

  const waveform = state.waveform;
  const barsLeftOfPlayhead = Math.round((width * PLAYHEAD_RATIO) / BAR_STEP);
  const playheadX = barsLeftOfPlayhead * BAR_STEP;
  const halfHeight = height / 2;
  const totalBars = Math.ceil(width / BAR_STEP);

  ctx.fillStyle = colors.COLOR_BG || '#0a0a0a';
  ctx.fillRect(0, 0, width, height);

  if (!waveform || waveform.length === 0) {
    const phase = (now * 0.002) % 1;
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < totalBars; i++) {
      const x = i * BAR_STEP;
      const wave = Math.sin((i / totalBars + phase) * Math.PI * 4);
      const h = ((0.3 + 0.2 * wave) * halfHeight) | 0;
      ctx.fillStyle = '#555';
      ctx.fillRect(x, halfHeight - h, BAR_WIDTH, h * 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.COLOR_PLAYHEAD || '#ff2222';
    ctx.fillRect(playheadX, 0, 1, height);
    rafId = requestAnimationFrame(draw);
    return;
  }

  const currentIndex = computedCurrentTime * POINTS_PER_SECOND;
  const startIndex = currentIndex - barsLeftOfPlayhead * zoom;

  // ── Energy shadow (total energy as grey backdrop) ──
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  for (let i = 0; i < totalBars; i++) {
    const dataIdx = (startIndex + i * zoom) | 0;
    if (dataIdx < 0 || dataIdx >= waveform.length) continue;
    const pt = waveform[dataIdx];
    const maxE = Math.max(pt.low, pt.mid, pt.high);
    const h = (maxE * halfHeight) | 0;
    ctx.fillRect(i * BAR_STEP, halfHeight - h, BAR_WIDTH, h * 2);
  }

  // ── Waveform bands — dual luminance layering (outer spectral envelope + bright bass/transient core) ──
  // Eliminates flat "barcode" look so kicks, transients and breakdowns read instantly.
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < totalBars; i++) {
    const dataIdx = (startIndex + i * zoom) | 0;
    if (dataIdx < 0 || dataIdx >= waveform.length) continue;

    const point = waveform[dataIdx];
    const x = i * BAR_STEP;

    const hLow = (point.low * halfHeight) | 0;
    const hMid = (point.mid * halfHeight) | 0;
    const hHigh = (point.high * halfHeight) | 0;

    // 1. Soft outer high/mid spectral envelope
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = colors.COLOR_HIGH;
    const hEnv = Math.max(hHigh, hMid);
    if (hEnv > 0) ctx.fillRect(x, halfHeight - hEnv, BAR_WIDTH, hEnv * 2);

    // 2. Saturated mid body
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = colors.COLOR_MID;
    if (hMid > 0) {
      const midH = Math.max(1, (hMid * 0.85) | 0);
      ctx.fillRect(x, halfHeight - midH, BAR_WIDTH, midH * 2);
    }

    // 3. Bright dense inner low-end / kick transient core
    if (hLow > 0) {
      const coreH = Math.max(1, (hLow * 0.72) | 0);
      ctx.globalAlpha = 0.96;
      ctx.fillStyle = colors.COLOR_LOW;
      ctx.fillRect(x, halfHeight - coreH, BAR_WIDTH, coreH * 2);

      // Subtle white-hot transient spine on strong bass peaks (> 0.65)
      if (point.low > 0.65) {
        const spineH = Math.max(1, (coreH * 0.38) | 0);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, halfHeight - spineH, BAR_WIDTH, spineH * 2);
      }
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ── Differential Phase Overlay (Ghost Deck Anaglifo) ─
  const showOverlay = state.showPhaseOverlay;
  const otherWaveform = state.otherWaveform;
  if (showOverlay && state.otherIsPlaying && otherWaveform && otherWaveform.length > 0 && state.otherBpm > 0) {
    const otherCurrentIndex = computedOtherTime * POINTS_PER_SECOND;
    const otherBarsLeft = (playheadX / BAR_STEP) | 0;
    const otherStartIndex = otherCurrentIndex - otherBarsLeft * zoom;

    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < totalBars; i++) {
      const myIdx = (startIndex + i * zoom) | 0;
      const otherIdx = (otherStartIndex + i * zoom) | 0;

      if (myIdx < 0 || myIdx >= waveform.length) continue;
      if (otherIdx < 0 || otherIdx >= otherWaveform.length) continue;

      const myPoint = waveform[myIdx];
      const otherPoint = otherWaveform[otherIdx];
      const x = i * BAR_STEP;

      const myEnergy = myPoint.low;
      const otherEnergy = otherPoint.low;
      const diff = myEnergy - otherEnergy;

      const maxE = Math.max(myEnergy, otherEnergy, 0.01);
      const h = (maxE * halfHeight * 0.6) | 0;

      if (Math.abs(diff) < PHASE_DIFF_THRESHOLD) {
        ctx.fillStyle = overlayColor(0, PHASE_OVERLAY_ALPHA_ALIGNED * maxE);
      } else if (diff > 0) {
        ctx.fillStyle = overlayColor(1, PHASE_OVERLAY_ALPHA_DIFF * Math.abs(diff));
      } else {
        ctx.fillStyle = overlayColor(2, PHASE_OVERLAY_ALPHA_DIFF * Math.abs(diff));
      }

      ctx.fillRect(x, halfHeight - h, BAR_WIDTH, h * 2);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  // ── Beatgrid ─────────────────────────────────────────
  const bpm = state.bpm;
  const firstBeatOffset = state.firstBeatOffset;

  if (bpm > 0) {
    const beatPeriod = 60 / bpm;
    const timeStart = startIndex / POINTS_PER_SECOND;
    const timeEnd = (startIndex + totalBars * zoom) / POINTS_PER_SECOND;

    const firstVisibleBeat = Math.floor((timeStart - firstBeatOffset) / beatPeriod);
    const lastVisibleBeat = Math.ceil((timeEnd - firstBeatOffset) / beatPeriod);

    for (let n = firstVisibleBeat; n <= lastVisibleBeat; n++) {
      const beatTime = firstBeatOffset + n * beatPeriod;
      if (beatTime < 0) continue;

      const beatDataIdx = beatTime * POINTS_PER_SECOND;
      const px = ((beatDataIdx - startIndex) / zoom) * BAR_STEP;
      if (px < 0 || px > width) continue;

      const isDownbeat = ((n % 4) + 4) % 4 === 0;
      const bx = px | 0;
      const grads = beatGrads[isDownbeat ? 1 : 0];
      if (grads) {
        const beatW = isDownbeat ? 2 : 1;
        const fadeH = halfHeight * 0.6;
        ctx.fillStyle = grads.top;
        ctx.fillRect(bx, 0, beatW, fadeH);
        ctx.fillStyle = grads.bot;
        ctx.fillRect(bx, height - fadeH, beatW, fadeH);
      }

      if (isDownbeat) {
        ctx.fillStyle = colors.COLOR_DOWNBEAT;
        ctx.beginPath();
        ctx.moveTo(bx - 3, 0);
        ctx.lineTo(bx + 3, 0);
        ctx.lineTo(bx, 5);
        ctx.closePath();
        ctx.fill();
      }

      const beatInBar = (((n % 4) + 4) % 4) + 1;
      ctx.fillStyle = isDownbeat ? colors.COLOR_BEAT_NUM : 'rgba(255,255,255,0.18)';
      ctx.fillText(String(beatInBar), bx, height - 1);
    }
  }

  // ── Loop region overlay ─────────────────────────────
  const activeLoop = state.activeLoop;
  if (activeLoop && bpm > 0) {
    const loopStartIdx = activeLoop.start * POINTS_PER_SECOND;
    const loopEndIdx = activeLoop.end * POINTS_PER_SECOND;
    const lx1 = ((loopStartIdx - startIndex) / zoom) * BAR_STEP;
    const lx2 = ((loopEndIdx - startIndex) / zoom) * BAR_STEP;
    if (lx2 > 0 && lx1 < width) {
      const clampL = Math.max(0, lx1) | 0;
      const clampR = Math.min(width, lx2) | 0;
      ctx.fillStyle = `rgba(${colors.WAVE_LOOP}, 0.08)`;
      ctx.fillRect(clampL, 0, clampR - clampL, height);
      ctx.fillStyle = `rgba(${colors.WAVE_LOOP}, 0.7)`;
      if (lx1 >= 0 && lx1 <= width) ctx.fillRect(lx1 | 0, 0, 2, height);
      if (lx2 >= 0 && lx2 <= width) ctx.fillRect(lx2 | 0, 0, 2, height);
    }
  }

  // ── Hot cue markers ──────────────────────────────────
  const hotCues = state.hotCues;
  for (let ci = 0; ci < hotCues.length; ci++) {
    const cueTime = hotCues[ci];
    if (cueTime === null) continue;
    const cueIdx = cueTime * POINTS_PER_SECOND;
    const cx = ((cueIdx - startIndex) / zoom) * BAR_STEP;
    if (cx < -5 || cx > width + 5) continue;
    const cc = CUE_COLORS[ci] || '#fff';
    ctx.fillStyle = cc + '88';
    ctx.fillRect(cx | 0, 0, 1, height);
    ctx.fillStyle = cc;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx + 5, 0);
    ctx.lineTo(cx, 7);
    ctx.closePath();
    ctx.fill();
  }

  // ── Drop markers ─────────────────────────────────────
  const dropBeats = state.dropBeats;
  if (dropBeats.length > 0 && bpm > 0) {
    const beatPeriodDrop = 60 / bpm;
    for (let di = 0; di < Math.min(dropBeats.length, 4); di++) {
      const dropTime = firstBeatOffset + dropBeats[di] * beatPeriodDrop;
      const dropIdx = dropTime * POINTS_PER_SECOND;
      const dx = ((dropIdx - startIndex) / zoom) * BAR_STEP;
      if (dx < -10 || dx > width + 10) continue;
      const mx = dx | 0;
      ctx.fillStyle = di === 0 ? colors.WAVE_DROP : colors.WAVE_DROP + '88';
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx + 4, 4);
      ctx.lineTo(mx, 8);
      ctx.lineTo(mx - 4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colors.WAVE_DROP + '33';
      ctx.fillRect(mx, 0, 1, height);
    }
  }

  // ── Centre line ──
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, halfHeight | 0, width, 1);
  ctx.globalAlpha = 1;

  // ── Playhead ──
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fillRect(playheadX - 10, 0, 21, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.fillRect(playheadX - 4, 0, 9, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(playheadX - 1, 0, 3, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(playheadX, 0, 1, height);
  ctx.fillRect(playheadX - 2, 0, 5, 3);
  ctx.fillRect(playheadX - 2, height - 3, 5, 3);

  // ── Slip mode ghost playhead ──
  if (isSlipActive && slipRealTime >= 0) {
    const slipDataIndex = slipRealTime * POINTS_PER_SECOND;
    const slipBarOffset = ((slipDataIndex - startIndex) / zoom) | 0;
    const slipX = (slipBarOffset * BAR_STEP) | 0;
    if (slipX >= 0 && slipX < width) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(slipX - 1, 0, 3, height);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(slipX - 4, 0, 9, height);
      ctx.globalAlpha = 1;
    }
  }

  // ── Beatgrid edit flash ──
  if (gridFlash && now < gridFlash.until) {
    const alpha = (gridFlash.until - now) / 150;
    ctx.fillStyle = `rgba(255,255,255,${(alpha * 0.8).toFixed(2)})`;
    ctx.fillRect((gridFlash.x | 0) - 1, 0, 3, height);
  } else if (gridFlash) {
    gridFlash = null;
  }

  rafId = requestAnimationFrame(draw);
}

// ── Event Router ─────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const data = e.data;
  switch (data.type) {
    case 'init': {
      const offscreen = data.canvas as OffscreenCanvas;
      canvas = offscreen;
      ctx = offscreen.getContext('2d', { alpha: false })!;
      colors = data.colors;
      width = data.width;
      height = data.height;
      dpr = data.dpr;

      // Size the backing store + apply the DPR transform up front — the resize
      // case did this but init didn't, so the first paint rendered into the
      // top-left quadrant blurry/clipped until a resize happened to fire.
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      updateGradients();

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(draw);
      break;
    }
    case 'resize': {
      width = data.width;
      height = data.height;
      dpr = data.dpr;
      if (canvas) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx = canvas.getContext('2d', { alpha: false })!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
      }
      updateGradients();
      break;
    }
    case 'state': {
      Object.assign(state, data.state);
      break;
    }
    case 'colors': {
      colors = { ...colors, ...data.colors };
      break;
    }
    case 'tick': {
      currentTime = data.currentTime;
      otherTime = data.otherTime;
      isSlipActive = data.isSlipActive;
      slipRealTime = data.slipRealTime;
      isPlaying = data.isPlaying;
      playbackRate = data.playbackRate;
      otherPlaybackRate = data.otherPlaybackRate;
      zoom = data.zoom;

      // Adjust computed times by the message transfer latency
      const now = performance.now();
      lastTickLocalTime = now - Math.max(0, now - data.timestamp);
      break;
    }
    case 'flash': {
      gridFlash = { x: data.x, until: performance.now() + 150 };
      break;
    }
  }
};
