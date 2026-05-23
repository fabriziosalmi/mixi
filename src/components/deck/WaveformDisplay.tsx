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
import type { DeckId } from '../../types';
import { themeVar } from '../../theme';
import {
  screenXToTime,
  snapToBeat as snapToBeatPure,
  hitTest,
  zoomAtPoint,
  resizeLoop,
  clampMenuPosition,
} from './waveformInteractions';
import {
  POINTS_PER_SECOND,
  BAR_STEP,
  PLAYHEAD_RATIO,
} from './waveformConstants';

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
  const workerRef = useRef<Worker | null>(null);
  const startIndexRef = useRef<number>(0);
  const zoomRef = useRef<number>(1);
  /** Drag-to-scrub state */
  const isDraggingRef = useRef(false);
  const scrubTimeRef = useRef<number | null>(null);
  /** Cleanup for drag listeners on unmount */
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(propWidth || 500);

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

  const widthRef = useRef(width);
  const heightRef = useRef(height);
  widthRef.current = width;
  heightRef.current = height;

  // Sync canvas size to the web worker when layout changes
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const dpr = window.devicePixelRatio || 1;
    worker.postMessage({
      type: 'resize',
      width,
      height,
      dpr,
    });
  }, [width, height]);

  // Set up the Web Worker drawing loop and store subscriptions
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up any existing canvas in the container
    container.innerHTML = '';

    // Create a new canvas element
    const canvas = document.createElement('canvas');
    canvas.className = "w-full h-full block";
    container.appendChild(canvas);
    canvasRef.current = canvas;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthRef.current * dpr;
    canvas.height = heightRef.current * dpr;

    const offscreen = canvas.transferControlToOffscreen();
    const worker = new Worker(new URL('./waveform.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    // Deck-tinted waveform colors
    const isCyan = deckId === 'A';
    const COLOR_LOW  = isCyan ? '#004455' : '#552200';
    const COLOR_MID  = isCyan ? '#0099aa' : '#cc6600';
    const COLOR_HIGH = isCyan ? '#00ddff' : '#ff9933';
    const COLOR_BG = themeVar('wave-bg', '#0a0a0a');
    const WAVE_DROP = themeVar('wave-drop', '#ff0044');
    const WAVE_LOOP = themeVar('wave-loop', '74, 222, 128');

    worker.postMessage({
      type: 'init',
      canvas: offscreen,
      deckId,
      width: widthRef.current,
      height: heightRef.current,
      dpr,
      colors: {
        COLOR_LOW,
        COLOR_MID,
        COLOR_HIGH,
        COLOR_BG,
        COLOR_PLAYHEAD: PLAYHEAD_COLOR,
        WAVE_DROP,
        WAVE_LOOP,
        COLOR_DOWNBEAT,
        COLOR_BEAT_NUM,
      }
    }, [offscreen]);

    // Subscriptions to stores
    const getDeckState = (s: any) => s.decks[deckId];
    const postStateUpdate = (d: any) => {
      worker.postMessage({
        type: 'state',
        state: {
          waveform: d.waveformData,
          hotCues: d.hotCues,
          dropBeats: d.dropBeats,
          bpm: d.bpm,
          firstBeatOffset: d.firstBeatOffset,
          activeLoop: d.activeLoop,
        }
      });
    };

    // Send initial state
    postStateUpdate(useMixiStore.getState().decks[deckId]);

    const unsub = useMixiStore.subscribe(
      getDeckState,
      postStateUpdate,
    );

    const otherDeckId = deckId === 'A' ? 'B' : 'A';
    const getOtherDeckState = (s: any) => s.decks[otherDeckId];
    const postOtherStateUpdate = (d: any) => {
      worker.postMessage({
        type: 'state',
        state: {
          otherWaveform: d.waveformData,
          otherBpm: d.bpm,
          otherIsPlaying: d.isPlaying,
        }
      });
    };

    // Send initial other deck state
    postOtherStateUpdate(useMixiStore.getState().decks[otherDeckId]);

    const unsubOther = useMixiStore.subscribe(
      getOtherDeckState,
      postOtherStateUpdate,
    );

    const postSettingsUpdate = (s: any) => {
      worker.postMessage({
        type: 'state',
        state: {
          fpsLimit: s.fpsLimit,
          showPhaseOverlay: s.showPhaseOverlay,
        }
      });
    };

    // Send initial settings
    postSettingsUpdate(useSettingsStore.getState());

    const unsubSettings = useSettingsStore.subscribe(postSettingsUpdate);

    // ── Main-thread requestAnimationFrame loop for sending playhead position ──
    const engine = MixiEngine.getInstance();
    let rafId = 0;

    function sendTicks() {
      const state = useMixiStore.getState();
      const d = state.decks[deckId];
      const otherDeck = state.decks[otherDeckId];

      const currentTime = scrubTimeRef.current !== null
        ? scrubTimeRef.current
        : (engine.isInitialized ? engine.getCurrentTime(deckId) : 0);

      const otherTime = engine.isInitialized
        ? engine.getCurrentTime(otherDeckId) : 0;

      const isSlipActive = engine.isInitialized && engine.isSlipActive(deckId);
      const slipRealTime = isSlipActive ? engine.getSlipRealTime(deckId) : -1;

      // Update local zoom & startIndexRef so interaction functions still work correctly on the main thread
      const barsLeftOfPlayhead = Math.round((widthRef.current * PLAYHEAD_RATIO) / BAR_STEP);
      const zoom = zoomRef.current;
      const currentIndex = currentTime * POINTS_PER_SECOND;
      startIndexRef.current = currentIndex - barsLeftOfPlayhead * zoom;

      worker.postMessage({
        type: 'tick',
        currentTime,
        otherTime,
        isSlipActive,
        slipRealTime,
        isPlaying: d.isPlaying,
        playbackRate: d.playbackRate,
        otherPlaybackRate: otherDeck.playbackRate,
        zoom,
        timestamp: performance.now(),
      });

      rafId = requestAnimationFrame(sendTicks);
    }

    rafId = requestAnimationFrame(sendTicks);

    return () => {
      cancelAnimationFrame(rafId);
      unsub();
      unsubOther();
      unsubSettings();
      worker.terminate();
    };
  }, [deckId]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const oldZoom = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      const newZoom = Math.max(0.25, Math.min(4, oldZoom + delta));

      // Zoom centred on mouse position (VS Code style)
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      startIndexRef.current = zoomAtPoint(mouseX, startIndexRef.current, oldZoom, newZoom);

      zoomRef.current = newZoom;
      if (externalZoomRef) externalZoomRef.current = newZoom;
    },
    [externalZoomRef],
  );

  /** Convert a mouse clientX to a seek time given a bounding rect. */
  const mouseXToTime = useCallback(
    (clientX: number, rect: DOMRect): number =>
      screenXToTime(clientX - rect.left, startIndexRef.current, zoomRef.current),
    [],
  );



  /** Snap a time to the nearest beat (if quantize enabled, unless Shift held). */
  const snapToBeat = useCallback(
    (time: number, forceSnap: boolean): number => {
      const d = useMixiStore.getState().decks[deckId];
      return snapToBeatPure(time, d.bpm, d.firstBeatOffset, d.quantize, forceSnap);
    },
    [deckId],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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
          workerRef.current?.postMessage({ type: 'flash', x: flashX });
        }
        return;
      }

      const store = useMixiStore.getState();
      const d = store.decks[deckId];

      // ── Hit-test markers (cues + loop borders) ──────────
      const hit = hitTest(clickX, d.hotCues, d.activeLoop, startIndexRef.current, zoomRef.current);

      if (hit.type === 'cue') {
        const cueIdx = hit.index;
        const onMouseMove = (me: MouseEvent) => {
          scrubTimeRef.current = mouseXToTime(me.clientX, rect);
        };
        const onMouseUp = (me: MouseEvent) => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          const finalTime = mouseXToTime(me.clientX, rect);
          const snapped = snapToBeat(finalTime, false);
          store.setHotCue(deckId, cueIdx, snapped);
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

      if (hit.type === 'loop-start' || hit.type === 'loop-end') {
        const side = hit.type === 'loop-start' ? 'start' : 'end';
        const onMouseMove = (me: MouseEvent) => {
          const newTime = snapToBeat(mouseXToTime(me.clientX, rect), false);
          const engine = MixiEngine.getInstance();
          const st = useMixiStore.getState();
          const curLoop = st.decks[deckId].activeLoop;
          if (!curLoop || !engine.isInitialized) return;
          const resized = resizeLoop(side, newTime, curLoop.start, curLoop.end);
          if (!resized) return;
          const bpm = st.decks[deckId].bpm;
          const lengthInBeats = bpm > 0
            ? (resized.end - resized.start) / (60 / bpm)
            : curLoop.lengthInBeats;
          const updatedLoop = { ...resized, lengthInBeats };
          useMixiStore.setState((s) => ({
            decks: { ...s.decks, [deckId]: { ...s.decks[deckId], activeLoop: updatedLoop } },
          }));
          engine.setLoop(deckId, resized.start, resized.end);
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
    [deckId, mouseXToTime, snapToBeat],
  );

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => { dragCleanupRef.current?.(); };
  }, []);

  // ── Context menu ────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; time: number } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const time = mouseXToTime(e.clientX, rect);
      const raw = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const clamped = clampMenuPosition(raw.x, raw.y, 160, 140, rect.width, rect.height);
      setCtxMenu({ x: clamped.x, y: clamped.y, time });
    },
    [mouseXToTime],
  );

  // Close context menu on any click or scroll
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('wheel', close, { passive: true });
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
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      className="rounded-lg w-full cursor-crosshair shadow-[inset_0_2px_6px_rgba(0,0,0,0.6),inset_0_-1px_2px_rgba(0,0,0,0.3)] relative overflow-hidden"
      style={{ height }}
    >
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
