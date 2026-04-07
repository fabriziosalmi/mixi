/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Beatgrid Editor — DOM Overlay + GRID Panel
//
// PHASE 1: Macro-drag on transparent overlay shifts entire grid.
// PHASE 3: Hardware-style panel with micro-nudge, set downbeat,
//          halve/double BPM, tap tempo, lock, reset.
//
// Architecture:
//   Canvas renders waveform at 60fps (untouched).
//   This component mounts an overlay <div> on top of the canvas
//   that captures pointer events for grid editing.
//   The grid panel slides out below the waveform.
//
// Interaction:
//   Macro-drag: click anywhere + drag left/right = shift grid.
//   Micro-nudge: buttons shift ±1ms or ±10ms.
//   Formula: deltaSec = deltaPixel / BAR_STEP / POINTS_PER_SECOND
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, type FC, type PointerEvent } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import type { DeckId } from '../../types';

// Waveform constants (must match WaveformDisplay.tsx)
const BAR_STEP = 3;
const POINTS_PER_SECOND = 100;

interface BeatgridEditorProps {
  deckId: DeckId;
  color: string;
  /** Whether edit mode is active (overlay captures events) */
  editMode: boolean;
  /** Waveform container width in px */
  waveformWidth: number;
}

export const BeatgridEditor: FC<BeatgridEditorProps> = ({ deckId, color, editMode }) => {
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);

  const store = useMixiStore.getState;

  // ── Macro-Drag: shift entire grid ─────────────────────────

  const handlePointerDown = useCallback((e: PointerEvent) => {
    if (!editMode) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartX.current = e.clientX;
    dragStartOffset.current = store().decks[deckId].firstBeatOffset;
  }, [deckId, editMode, store]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging || !editMode) return;
    const deltaPixel = e.clientX - dragStartX.current;
    // Convert pixels to seconds: deltaSec = deltaPixel / BAR_STEP / POINTS_PER_SECOND
    const deltaSec = deltaPixel / BAR_STEP / POINTS_PER_SECOND;
    const newOffset = Math.max(0, dragStartOffset.current + deltaSec);
    // Apply directly to store (useMixiSync will forward to engine)
    useMixiStore.getState().setFirstBeatOffset(deckId, newOffset);
  }, [deckId, dragging, editMode]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  if (!editMode) return null;

  return (
    <>
      {/* ── Transparent overlay for macro-drag ──────────────── */}
      <div
        className="absolute inset-0 z-10"
        style={{
          cursor: dragging ? 'grabbing' : 'grab',
          // Visual feedback: subtle tint when dragging
          background: dragging ? 'rgba(34,197,94,0.03)' : 'transparent',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {/* ── GRID Panel (below waveform) ────────────────────── */}
      <GridPanel deckId={deckId} color={color} />
    </>
  );
};

// ── GRID Control Panel ──────────────────────────────────────

const GridPanel: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);

  // Micro-nudge: shift grid by ±ms
  const nudge = useCallback((ms: number) => {
    const s = useMixiStore.getState();
    const current = s.decks[deckId].firstBeatOffset;
    s.setFirstBeatOffset(deckId, Math.max(0, current + ms / 1000));
  }, [deckId]);

  // Set downbeat at current playback position
  const setDownbeat = useCallback(() => {
    const s = useMixiStore.getState();
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;
    const currentTime = engine.getCurrentTime(deckId);
    if (currentTime > 0) {
      s.setFirstBeatOffset(deckId, currentTime);
    }
  }, [deckId]);

  // Halve / double BPM
  const halveBpm = useCallback(() => {
    const s = useMixiStore.getState();
    const d = s.decks[deckId];
    if (d.bpm > 60) {
      const newRate = (d.bpm / 2) / d.originalBpm;
      s.setDeckPlaybackRate(deckId, newRate);
    }
  }, [deckId]);

  const doubleBpm = useCallback(() => {
    const s = useMixiStore.getState();
    const d = s.decks[deckId];
    if (d.bpm < 300) {
      const newRate = (d.bpm * 2) / d.originalBpm;
      s.setDeckPlaybackRate(deckId, newRate);
    }
  }, [deckId]);

  // Reset to auto-detected grid
  const resetGrid = useCallback(() => {
    // TODO: implement userGridOverride = null
    // For now, reset to original values
  }, [deckId]);

  const btnStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
  };

  return (
    <div
      className="flex items-center justify-center gap-1.5 px-2 py-1 rounded-b-md"
      style={{
        background: 'rgba(10,10,12,0.9)',
        borderTop: `1px solid ${color}33`,
        height: 32,
      }}
    >
      {/* Set Downbeat */}
      <button type="button" onClick={setDownbeat}
        className="text-[7px] font-bold px-1.5 py-1 rounded active:scale-95 transition-all"
        style={{ ...btnStyle, color }}
        title="Set downbeat at current position">
        |&lt; SET
      </button>

      {/* Micro-nudge left */}
      <button type="button" onClick={() => nudge(-1)}
        className="text-[8px] font-bold px-1 py-1 rounded active:scale-95"
        style={{ ...btnStyle, color: 'var(--txt-muted)' }}
        title="Shift grid -1ms">
        &lt;
      </button>

      {/* Micro-nudge right */}
      <button type="button" onClick={() => nudge(1)}
        className="text-[8px] font-bold px-1 py-1 rounded active:scale-95"
        style={{ ...btnStyle, color: 'var(--txt-muted)' }}
        title="Shift grid +1ms">
        &gt;
      </button>

      {/* Halve BPM */}
      <button type="button" onClick={halveBpm}
        className="text-[7px] font-bold px-1 py-1 rounded active:scale-95"
        style={{ ...btnStyle, color: 'var(--txt-secondary)' }}
        title="Halve BPM">
        /2
      </button>

      {/* Double BPM */}
      <button type="button" onClick={doubleBpm}
        className="text-[7px] font-bold px-1 py-1 rounded active:scale-95"
        style={{ ...btnStyle, color: 'var(--txt-secondary)' }}
        title="Double BPM">
        x2
      </button>

      {/* BPM display */}
      <span className="text-[9px] font-mono font-bold tabular-nums px-1"
        style={{ color, minWidth: 40, textAlign: 'center' }}>
        {bpm > 0 ? bpm.toFixed(1) : '---'}
      </span>

      {/* Reset to auto */}
      <button type="button" onClick={resetGrid}
        className="text-[7px] font-bold px-1 py-1 rounded active:scale-95"
        style={{ ...btnStyle, color: 'var(--txt-muted)' }}
        title="Reset to auto-detected grid">
        ↺
      </button>
    </div>
  );
};
