/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – RGB Waveform Display + Beatgrid (Ultra-Optimized)
//
// Performance techniques:
//   - globalCompositeOperation 'screen' replaces ctx.filter blur
//     (GPU-native additive blending, zero CPU cost)
//   - Draw calls halved: one fillRect per band (height×2)
//   - Bitwise |0 for integer conversion (faster than Math.floor)
//   - Font cached outside render loop
//   - Beat numbers only on downbeats (fewer fillText calls)
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { useSettingsStore } from '../../store/settingsStore';
import { POINTS_PER_SECOND } from '../../audio/WaveformAnalyzer';
import type { DeckId, WaveformPoint } from '../../types';
import { CUE_COLORS, themeVar } from '../../theme';

// ── Phase overlay constants ─────────────────────────────────
const PHASE_OVERLAY_ALPHA_ALIGNED = 0.30; // white when kicks match
const PHASE_OVERLAY_ALPHA_DIFF = 0.25;    // red/cyan intensity
const PHASE_DIFF_THRESHOLD = 0.10;         // energy diff below = aligned

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

// ── Drawing constants ────────────────────────────────────────

const PLAYHEAD_RATIO = 1 / 3;
const BAR_WIDTH = 3;
const BAR_GAP = 1;
const BAR_STEP = BAR_WIDTH + BAR_GAP;

const COLOR_DOWNBEAT = 'rgba(255, 255, 255, 0.3)';
const COLOR_BEAT_NUM = 'rgba(255, 255, 255, 0.35)';
const PLAYHEAD_COLOR = '#ff2222'; // Razor-red playhead (Traktor-style)

// ── Component ────────────────────────────────────────────────

interface WaveformDisplayProps {
  deckId: DeckId;
  width?: number;
  height?: number;
  /** Shared ref for zoom level, read by WaveformOverview */
  externalZoomRef?: React.MutableRefObject<number>;
}

export const WaveformDisplay: FC<WaveformDisplayProps> = ({
  deckId,
  width: propWidth,
  height = 80,
  externalZoomRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startIndexRef = useRef<number>(0);
  const zoomRef = useRef<number>(1);
  /** Drag-to-scrub state */
  const isDraggingRef = useRef(false);
  const scrubTimeRef = useRef<number | null>(null);
  /** Cleanup for drag listeners on unmount */
  const dragCleanupRef = useRef<(() => void) | null>(null);
  /** Beatgrid edit flash */
  const gridFlashRef = useRef<{ x: number; until: number } | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(propWidth || 500);
  const colorblindMode = useSettingsStore((s) => s.colorblindMode);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // #49: Debounce resize — keep CSS-scaled old content during drag,
    // only recreate the canvas buffer once resizing settles (200ms).
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) {
        const rounded = w | 0;
        clearTimeout(timer);
        timer = setTimeout(() => {
          setMeasuredWidth((prev) => Math.abs(prev - rounded) > 2 ? rounded : prev);
        }, 200);
      }
    });
    ro.observe(container);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, []);

  const width = measuredWidth;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Read theme tokens once per effect cycle
    // Colorblind palette: blue + orange + white (distinguishable in all types of color blindness)
    const cbMode = useSettingsStore.getState().colorblindMode;
    const COLOR_LOW = cbMode ? '#ee8833' : themeVar('wave-low', '#cc2244');
    const COLOR_MID = cbMode ? '#ffffff' : themeVar('wave-mid', '#dd8822');
    const COLOR_HIGH = cbMode ? '#3399ee' : themeVar('wave-high', '#3388dd');
    const COLOR_BG = themeVar('wave-bg', '#0a0a0a');
    const COLOR_PLAYHEAD = PLAYHEAD_COLOR;
    const WAVE_DROP = themeVar('wave-drop', '#ff0044');
    const WAVE_LOOP = themeVar('wave-loop', '74, 222, 128');

    const engine = MixiEngine.getInstance();
    const playheadX = (width * PLAYHEAD_RATIO) | 0;
    const halfHeight = height / 2;
    const totalBars = Math.ceil(width / BAR_STEP);

    // Pre-compute beatgrid gradients
    const fadeH = halfHeight * 0.6;
    const beatGrads = [0.12, 0.35].map((alpha) => {
      const top = ctx.createLinearGradient(0, 0, 0, fadeH);
      top.addColorStop(0, `rgba(255,255,255,${alpha})`);
      top.addColorStop(1, 'rgba(255,255,255,0)');
      const bot = ctx.createLinearGradient(0, height - fadeH, 0, height);
      bot.addColorStop(0, 'rgba(255,255,255,0)');
      bot.addColorStop(1, `rgba(255,255,255,${alpha})`);
      return { top, bot };
    });

    // Cache font outside loop
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // ── Cache slow-changing data outside rAF ───────────────
    // waveformData, hotCues, dropBeats only change on track load.
    // Re-read from store via subscription, not per frame.
    let cachedWaveform = useMixiStore.getState().decks[deckId].waveformData;
    let cachedHotCues = useMixiStore.getState().decks[deckId].hotCues;
    let cachedDropBeats = useMixiStore.getState().decks[deckId].dropBeats;
    let cachedBpm = useMixiStore.getState().decks[deckId].bpm;
    let cachedOffset = useMixiStore.getState().decks[deckId].firstBeatOffset;
    let cachedLoop = useMixiStore.getState().decks[deckId].activeLoop;

    // ── Other deck cache for phase overlay ────────────────
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    let otherWaveform = useMixiStore.getState().decks[otherDeckId].waveformData;
    let otherBpm = useMixiStore.getState().decks[otherDeckId].bpm;
    let otherIsPlaying = useMixiStore.getState().decks[otherDeckId].isPlaying;

    // H1: Selective subscribe — only fire when our deck's data changes,
    // not on every store dispatch (volume, crossfader, other deck, etc.)
    const unsub = useMixiStore.subscribe(
      (s) => s.decks[deckId],
      (d) => {
        cachedWaveform = d.waveformData;
        cachedHotCues = d.hotCues;
        cachedDropBeats = d.dropBeats;
        cachedBpm = d.bpm;
        cachedOffset = d.firstBeatOffset;
        cachedLoop = d.activeLoop;
      },
    );

    // Subscribe to other deck changes (for phase overlay)
    const unsubOther = useMixiStore.subscribe(
      (s) => s.decks[otherDeckId],
      (d) => {
        otherWaveform = d.waveformData;
        otherBpm = d.bpm;
        otherIsPlaying = d.isPlaying;
      },
    );

    // Cache settings outside rAF (avoid getState() per frame)
    let cachedFpsLimit = useSettingsStore.getState().fpsLimit;
    let cachedShowOverlay = useSettingsStore.getState().showPhaseOverlay;
    const unsubSettings = useSettingsStore.subscribe((s) => {
      cachedFpsLimit = s.fpsLimit;
      cachedShowOverlay = s.showPhaseOverlay;
    });

    // ── Render loop ────────────────────────────────────────

    let lastDraw = 0;

    function draw() {
      // FPS limiter: skip frame if too soon
      const now = performance.now();
      const interval = cachedFpsLimit === 30 ? 33 : 0;
      if (interval && now - lastDraw < interval) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDraw = now;

      const waveform = cachedWaveform;

      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, width, height);

      if (!waveform || waveform.length === 0) {
        // Placeholder: animated scanning bars while analyzing
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
        ctx.fillStyle = COLOR_PLAYHEAD;
        ctx.fillRect(playheadX, 0, 1, height);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const currentTime = scrubTimeRef.current !== null
        ? scrubTimeRef.current
        : (engine.isInitialized ? engine.getCurrentTime(deckId) : 0);

      const zoom = zoomRef.current;
      const currentIndex = currentTime * POINTS_PER_SECOND;
      const barsLeftOfPlayhead = (playheadX / BAR_STEP) | 0;
      const startIndex = currentIndex - barsLeftOfPlayhead * zoom;
      startIndexRef.current = startIndex;

      // ── Energy shadow (total energy as grey backdrop, Rekordbox-style) ──
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

      // ── Waveform bars — additive 'screen' blend ──────────
      // Replaces ctx.filter='blur()' with GPU-native compositing.
      // Bands layer with additive light blending like real LEDs.
      ctx.globalCompositeOperation = 'screen';

      for (let i = 0; i < totalBars; i++) {
        const dataIdx = (startIndex + i * zoom) | 0;
        if (dataIdx < 0 || dataIdx >= waveform.length) continue;

        const point: WaveformPoint = waveform[dataIdx];
        const x = i * BAR_STEP;

        // Integer heights to avoid sub-pixel anti-aliasing cost
        const hLow = (point.low * halfHeight) | 0;
        const hMid = (point.mid * halfHeight) | 0;
        const hHigh = (point.high * halfHeight) | 0;

        // Single fillRect per band (top+bottom as one rect, h×2)
        ctx.fillStyle = COLOR_LOW;
        ctx.fillRect(x, halfHeight - hLow, BAR_WIDTH, hLow * 2);

        ctx.fillStyle = COLOR_MID;
        ctx.fillRect(x, halfHeight - hMid, BAR_WIDTH, hMid * 2);

        ctx.fillStyle = COLOR_HIGH;
        ctx.fillRect(x, halfHeight - hHigh, BAR_WIDTH, hHigh * 2);
      }

      // Reset composite for UI overlays
      ctx.globalCompositeOperation = 'source-over';

      // ── Differential Phase Overlay (Ghost Deck Anaglifo) ─
      // Items 19+20: Draw other deck's energy as red/cyan/white
      // differential overlay. White = kicks aligned, red/cyan = misaligned.
      const showOverlay = cachedShowOverlay;
      if (showOverlay && otherIsPlaying && otherWaveform && otherWaveform.length > 0 && otherBpm > 0) {
        const otherTime = engine.isInitialized
          ? engine.getCurrentTime(otherDeckId) : 0;
        const otherCurrentIndex = otherTime * POINTS_PER_SECOND;
        const otherBarsLeft = (playheadX / BAR_STEP) | 0;
        const otherStartIndex = otherCurrentIndex - otherBarsLeft * zoom;

        ctx.globalCompositeOperation = 'screen';

        for (let i = 0; i < totalBars; i++) {
          const myIdx = (startIndex + i * zoom) | 0;
          const otherIdx = (otherStartIndex + i * zoom) | 0;

          if (myIdx < 0 || myIdx >= waveform.length) continue;
          if (otherIdx < 0 || otherIdx >= otherWaveform.length) continue;

          const myPoint: WaveformPoint = waveform[myIdx];
          const otherPoint: WaveformPoint = otherWaveform[otherIdx];
          const x = i * BAR_STEP;

          // Use low-frequency energy (kick/bass) for differential
          const myEnergy = myPoint.low;
          const otherEnergy = otherPoint.low;
          const diff = myEnergy - otherEnergy;

          // Height based on max energy of the two
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

      const bpm = cachedBpm;
      const firstBeatOffset = cachedOffset;

      if (bpm > 0) {
        const beatPeriod = 60 / bpm;
        const timeStart = startIndex / POINTS_PER_SECOND;
        const timeEnd = (startIndex + totalBars * zoom) / POINTS_PER_SECOND;

        const firstVisibleBeat = Math.floor(
          (timeStart - firstBeatOffset) / beatPeriod,
        );
        const lastVisibleBeat = Math.ceil(
          (timeEnd - firstBeatOffset) / beatPeriod,
        );

        for (let n = firstVisibleBeat; n <= lastVisibleBeat; n++) {
          const beatTime = firstBeatOffset + n * beatPeriod;
          if (beatTime < 0) continue;

          const beatDataIdx = beatTime * POINTS_PER_SECOND;
          const px = ((beatDataIdx - startIndex) / zoom) * BAR_STEP;
          if (px < 0 || px > width) continue;

          const isDownbeat = ((n % 4) + 4) % 4 === 0;
          const bx = px | 0;
          const grad = isDownbeat ? beatGrads[1] : beatGrads[0];
          const beatW = isDownbeat ? 2 : 1;

          ctx.fillStyle = grad.top;
          ctx.fillRect(bx, 0, beatW, fadeH);
          ctx.fillStyle = grad.bot;
          ctx.fillRect(bx, height - fadeH, beatW, fadeH);

          if (isDownbeat) {
            ctx.fillStyle = COLOR_DOWNBEAT;
            ctx.beginPath();
            ctx.moveTo(bx - 3, 0);
            ctx.lineTo(bx + 3, 0);
            ctx.lineTo(bx, 5);
            ctx.closePath();
            ctx.fill();
          }

          // Beat numbers — show 1-2-3-4 on every beat for visual orientation
          {
            const beatInBar = ((n % 4) + 4) % 4 + 1;
            ctx.fillStyle = isDownbeat ? COLOR_BEAT_NUM : 'rgba(255,255,255,0.18)';
            ctx.fillText(String(beatInBar), bx, height - 1);
          }
        }
      }

      // ── Loop region overlay ─────────────────────────────

      const activeLoop = cachedLoop;
      if (activeLoop && bpm > 0) {
        const loopStartIdx = activeLoop.start * POINTS_PER_SECOND;
        const loopEndIdx = activeLoop.end * POINTS_PER_SECOND;
        const lx1 = ((loopStartIdx - startIndex) / zoom) * BAR_STEP;
        const lx2 = ((loopEndIdx - startIndex) / zoom) * BAR_STEP;
        if (lx2 > 0 && lx1 < width) {
          const clampL = Math.max(0, lx1) | 0;
          const clampR = Math.min(width, lx2) | 0;
          ctx.fillStyle = `rgba(${WAVE_LOOP}, 0.08)`;
          ctx.fillRect(clampL, 0, clampR - clampL, height);
          ctx.fillStyle = `rgba(${WAVE_LOOP}, 0.7)`;
          if (lx1 >= 0 && lx1 <= width) ctx.fillRect(lx1 | 0, 0, 2, height);
          if (lx2 >= 0 && lx2 <= width) ctx.fillRect(lx2 | 0, 0, 2, height);
        }
      }

      // ── Hot cue markers ──────────────────────────────────

      const hotCues = cachedHotCues;
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

      const dropBeats = cachedDropBeats;
      if (dropBeats.length > 0 && bpm > 0) {
        const beatPeriodDrop = 60 / bpm;
        for (let di = 0; di < Math.min(dropBeats.length, 4); di++) {
          const dropTime = firstBeatOffset + dropBeats[di] * beatPeriodDrop;
          const dropIdx = dropTime * POINTS_PER_SECOND;
          const dx = ((dropIdx - startIndex) / zoom) * BAR_STEP;
          if (dx < -10 || dx > width + 10) continue;
          const mx = dx | 0;
          ctx.fillStyle = di === 0 ? WAVE_DROP : WAVE_DROP + '88';
          ctx.beginPath();
          ctx.moveTo(mx, 0);
          ctx.lineTo(mx + 4, 4);
          ctx.lineTo(mx, 8);
          ctx.lineTo(mx - 4, 4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = WAVE_DROP + '33';
          ctx.fillRect(mx, 0, 1, height);
        }
      }

      // ── Centre line (single pixel, subtle white) ─────────
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, halfHeight | 0, width, 1);
      ctx.globalAlpha = 1;

      // ── Playhead — razor-red with neon glow (Traktor-style) ──
      ctx.fillStyle = 'rgba(255, 34, 34, 0.06)';
      ctx.fillRect(playheadX - 6, 0, 13, height);
      ctx.fillStyle = 'rgba(255, 34, 34, 0.12)';
      ctx.fillRect(playheadX - 2, 0, 5, height);
      ctx.fillStyle = COLOR_PLAYHEAD;
      ctx.fillRect(playheadX, 0, 1, height);
      ctx.fillRect(playheadX - 1, 0, 3, 2);
      ctx.fillRect(playheadX - 1, height - 2, 3, 2);

      // ── Slip mode ghost playhead (dim cyan) ─────────────
      if (engine.isInitialized && engine.isSlipActive(deckId)) {
        const slipRealTime = engine.getSlipRealTime(deckId);
        if (slipRealTime >= 0 && waveform) {
          const slipDataIndex = slipRealTime * POINTS_PER_SECOND;
          const slipBarOffset = ((slipDataIndex - startIndexRef.current) / zoomRef.current) | 0;
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
      }

      // ── Beatgrid edit flash (Shift+Click feedback) ──────
      const flash = gridFlashRef.current;
      if (flash && now < flash.until) {
        const alpha = (flash.until - now) / 150;
        ctx.fillStyle = `rgba(255,255,255,${(alpha * 0.8).toFixed(2)})`;
        ctx.fillRect((flash.x | 0) - 1, 0, 3, height);
      } else if (flash) {
        gridFlashRef.current = null;
      }

      // ── Next frame ───────────────────────────────────────
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); unsub(); unsubOther(); unsubSettings(); };
  }, [deckId, width, height, colorblindMode]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const oldZoom = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      const newZoom = Math.max(0.25, Math.min(4, oldZoom + delta));

      // Zoom centred on mouse position (VS Code style):
      // Keep the data point under the cursor fixed on screen.
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseBarIndex = mouseX / BAR_STEP;
      const dataIndexUnderMouse = startIndexRef.current + mouseBarIndex * oldZoom;
      // After zoom, adjust startIndex so the same data point stays under the mouse
      startIndexRef.current = dataIndexUnderMouse - mouseBarIndex * newZoom;

      zoomRef.current = newZoom;
      if (externalZoomRef) externalZoomRef.current = newZoom;
    },
    [externalZoomRef],
  );

  /** Convert a mouse clientX to a seek time given a bounding rect. */
  const mouseXToTime = useCallback(
    (clientX: number, rect: DOMRect): number => {
      const clickX = clientX - rect.left;
      const barIndex = clickX / BAR_STEP;
      const dataIndex = startIndexRef.current + barIndex * zoomRef.current;
      return Math.max(0, dataIndex / POINTS_PER_SECOND);
    },
    [],
  );

  /** Convert a time (seconds) to screen X position. */
  const timeToScreenX = useCallback(
    (time: number): number => {
      const dataIdx = time * POINTS_PER_SECOND;
      return ((dataIdx - startIndexRef.current) / zoomRef.current) * BAR_STEP;
    },
    [],
  );

  /** Snap a time to the nearest beat (if quantize enabled, unless Shift held). */
  const snapToBeat = useCallback(
    (time: number, forceSnap: boolean): number => {
      const d = useMixiStore.getState().decks[deckId];
      if (d.bpm <= 0 || (!d.quantize && !forceSnap)) return time;
      const beatPeriod = 60 / d.bpm;
      const beatNum = Math.round((time - d.firstBeatOffset) / beatPeriod);
      const snapped = d.firstBeatOffset + beatNum * beatPeriod;
      // Only snap if within half a beat
      if (Math.abs(time - snapped) < beatPeriod * 0.4) return snapped;
      return time;
    },
    [deckId],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const seekTime = mouseXToTime(e.clientX, rect);

      // Shift+Click: set first downbeat (beatgrid editing)
      if (e.shiftKey && seekTime >= 0) {
        const store = useMixiStore.getState();
        const d = store.decks[deckId];
        if (d.bpm > 0) {
          store.setDeckBpm(deckId, d.bpm, seekTime);
          const flashX = e.clientX - rect.left;
          gridFlashRef.current = { x: flashX, until: performance.now() + 150 };
        }
        return;
      }

      const HIT_RADIUS = 8; // pixels
      const store = useMixiStore.getState();
      const d = store.decks[deckId];

      // ── Hit-test hot cue markers ────────────────────────
      for (let i = 0; i < d.hotCues.length; i++) {
        const cueTime = d.hotCues[i];
        if (cueTime === null) continue;
        const cx = timeToScreenX(cueTime);
        if (Math.abs(clickX - cx) < HIT_RADIUS) {
          // Drag this hot cue
          const onMouseMove = (me: MouseEvent) => {
            // Visual feedback only — we don't move the cue until release
            scrubTimeRef.current = mouseXToTime(me.clientX, rect);
          };
          const onMouseUp = (me: MouseEvent) => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            const finalTime = mouseXToTime(me.clientX, rect);
            const snapped = snapToBeat(finalTime, false);
            store.setHotCue(deckId, i, snapped);
            scrubTimeRef.current = null;
            dragCleanupRef.current = null;
          };
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
          dragCleanupRef.current = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            scrubTimeRef.current = null;
          };
          return;
        }
      }

      // ── Hit-test loop borders ───────────────────────────
      const loop = d.activeLoop;
      if (loop) {
        const lxStart = timeToScreenX(loop.start);
        const lxEnd = timeToScreenX(loop.end);
        const hitStart = Math.abs(clickX - lxStart) < HIT_RADIUS;
        const hitEnd = Math.abs(clickX - lxEnd) < HIT_RADIUS;
        if (hitStart || hitEnd) {
          const side = hitStart ? 'start' : 'end';
          const onMouseMove = (me: MouseEvent) => {
            const newTime = snapToBeat(mouseXToTime(me.clientX, rect), false);
            const engine = MixiEngine.getInstance();
            const st = useMixiStore.getState();
            const curLoop = st.decks[deckId].activeLoop;
            if (!curLoop || !engine.isInitialized) return;
            let newStart = curLoop.start;
            let newEnd = curLoop.end;
            if (side === 'start' && newTime < curLoop.end - 0.05) newStart = newTime;
            else if (side === 'end' && newTime > curLoop.start + 0.05) newEnd = newTime;
            else return;
            const bpm = st.decks[deckId].bpm;
            const lengthInBeats = bpm > 0 ? (newEnd - newStart) / (60 / bpm) : curLoop.lengthInBeats;
            const updatedLoop = { start: newStart, end: newEnd, lengthInBeats };
            useMixiStore.setState((s) => ({
              decks: { ...s.decks, [deckId]: { ...s.decks[deckId], activeLoop: updatedLoop } },
            }));
            engine.setLoop(deckId, newStart, newEnd);
          };
          const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            dragCleanupRef.current = null;
          };
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
          dragCleanupRef.current = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          };
          return;
        }
      }

      // ── Default: drag-to-scrub ──────────────────────────
      isDraggingRef.current = true;
      scrubTimeRef.current = seekTime;

      const onMouseMove = (me: MouseEvent) => {
        if (!isDraggingRef.current) return;
        scrubTimeRef.current = mouseXToTime(me.clientX, rect);
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;

        const finalTime = scrubTimeRef.current;
        scrubTimeRef.current = null;

        const engine = MixiEngine.getInstance();
        if (engine.isInitialized && finalTime !== null && finalTime >= 0) {
          engine.seek(deckId, finalTime);
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      dragCleanupRef.current = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        isDraggingRef.current = false;
        scrubTimeRef.current = null;
      };
    },
    [deckId, mouseXToTime, timeToScreenX, snapToBeat],
  );

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => { dragCleanupRef.current?.(); };
  }, []);

  // ── Context menu ────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; time: number } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const time = mouseXToTime(e.clientX, rect);
      setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, time });
    },
    [mouseXToTime],
  );

  // Close context menu on any click or scroll
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('wheel', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('wheel', close);
    };
  }, [ctxMenu]);

  const ctxMenuActions = useCallback(
    (action: string) => {
      if (!ctxMenu) return;
      const store = useMixiStore.getState();
      const d = store.decks[deckId];
      const time = ctxMenu.time;
      const engine = MixiEngine.getInstance();
      switch (action) {
        case 'set-cue': {
          const emptyIdx = d.hotCues.indexOf(null);
          if (emptyIdx >= 0) store.setHotCue(deckId, emptyIdx, time);
          break;
        }
        case 'loop-in':
          if (d.bpm > 0) {
            const beatPeriod = 60 / d.bpm;
            const loop = { start: time, end: time + beatPeriod * 4, lengthInBeats: 4 };
            useMixiStore.setState((s) => ({
              decks: { ...s.decks, [deckId]: { ...s.decks[deckId], activeLoop: loop } },
            }));
            if (engine.isInitialized) engine.setLoop(deckId, loop.start, loop.end);
          }
          break;
        case 'exit-loop':
          store.exitLoop(deckId);
          break;
        case 'seek-drop': {
          if (d.dropBeats.length > 0 && d.bpm > 0) {
            const beatPeriod = 60 / d.bpm;
            const dropTime = d.firstBeatOffset + d.dropBeats[0] * beatPeriod;
            if (engine.isInitialized) engine.seek(deckId, dropTime);
          }
          break;
        }
        case 'reset-grid':
          if (d.bpm > 0) store.setDeckBpm(deckId, d.bpm, time);
          break;
      }
      setCtxMenu(null);
    },
    [ctxMenu, deckId],
  );

  return (
    <div ref={containerRef} className="w-full relative">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        className="rounded-lg w-full cursor-crosshair shadow-[inset_0_2px_6px_rgba(0,0,0,0.6),inset_0_-1px_2px_rgba(0,0,0,0.3)]"
        style={{ height }}
      />
      {/* Glass reflection overlay */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, transparent 30%)' }}
      />
      {/* Context menu */}
      {ctxMenu && (
        <div
          className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl py-1 text-xs text-zinc-200 min-w-[140px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 transition-colors" onClick={() => ctxMenuActions('set-cue')}>
            Set Cue Here
          </button>
          <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 transition-colors" onClick={() => ctxMenuActions('loop-in')}>
            Set 4-Beat Loop
          </button>
          {useMixiStore.getState().decks[deckId].activeLoop && (
            <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 transition-colors" onClick={() => ctxMenuActions('exit-loop')}>
              Exit Loop
            </button>
          )}
          {useMixiStore.getState().decks[deckId].dropBeats.length > 0 && (
            <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 transition-colors" onClick={() => ctxMenuActions('seek-drop')}>
              Jump to Drop
            </button>
          )}
          <div className="border-t border-zinc-700 my-1" />
          <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 transition-colors" onClick={() => ctxMenuActions('reset-grid')}>
            Set Downbeat Here
          </button>
        </div>
      )}
    </div>
  );
};
