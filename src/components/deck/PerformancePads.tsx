/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Performance Pads (Pioneer Rekordbox style)
//
// Two modes, selectable via tab buttons:
//
//   HOT CUE  – 8 pads that save/recall cue points
//   AUTO LOOP – 8 pads with beat-based loop lengths
//
// Interaction:
//   HOT CUE mode:
//     Click empty pad   → saves current position (quantised)
//     Click filled pad  → jumps to that cue point
//     Shift+Click / Right-click → deletes the cue
//
//   AUTO LOOP mode:
//     Click pad          → engages a loop of that beat length
//     Click active pad   → exits the loop
//
// Visual:
//   Dark 4×2 grid, pads glow with assigned colours when active.
//   Hardware-inspired beveled look with Tailwind shadows.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useMemo, type FC, type MouseEvent } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import type { DeckId } from '../../types';
import { CUE_COLORS } from '../../theme';

const QUANTIZE_VALUES = [
  { beats: 4,     label: '4' },
  { beats: 2,     label: '2' },
  { beats: 1,     label: '1' },
  { beats: 0.5,   label: '1/2' },
  { beats: 0.25,  label: '1/4' },
  { beats: 0.125, label: '1/8' },
  { beats: 0.0625, label: '1/16' },
] as const;

// ── Constants ────────────────────────────────────────────────

type PadMode = 'hotcue' | 'loop' | 'beatjump' | 'looproll';

/** Beat lengths for the auto-loop pads. */
const LOOP_BEATS = [1, 2, 4, 8, 16, 32, 0.5, 0.25] as const;

/** Display labels for loop pads. */
const LOOP_LABELS = ['1', '2', '4', '8', '16', '32', '1/2', '1/4'] as const;

/** Beat jump amounts — top row backward, bottom row forward. */
const JUMP_BEATS = [-32, -8, -4, -1, 1, 4, 8, 32] as const;
const JUMP_LABELS = ['<<32', '<<8', '<<4', '<<1', '>>1', '>>4', '>>8', '>>32'] as const;

// ── Component ────────────────────────────────────────────────

interface PerformancePadsProps {
  deckId: DeckId;
  color: string;
}

export const PerformancePads: FC<PerformancePadsProps> = ({ deckId, color }) => {
  const [mode, setMode] = useState<PadMode>('hotcue');
  const quantize = useMixiStore((s) => s.decks[deckId].quantize);
  const setQuantize = useMixiStore((s) => s.setQuantize);
  const [qValueIdx, setQValueIdx] = useState(2);

  const toggleQuantize = useCallback(
    () => setQuantize(deckId, !quantize),
    [deckId, quantize, setQuantize],
  );

  const cycleQValue = useCallback(() => {
    setQValueIdx((prev) => (prev + 1) % QUANTIZE_VALUES.length);
  }, []);

  const qVal = useMemo(() => QUANTIZE_VALUES[qValueIdx], [qValueIdx]);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {/* ── Mode selector ───────────────────────────────────── */}
      <div className="flex gap-1 items-center">
        <ModeTab
          label="HOT CUE"
          active={mode === 'hotcue'}
          onClick={() => setMode('hotcue')}
          color={color}
        />
        <ModeTab
          label="AUTO LOOP"
          active={mode === 'loop'}
          onClick={() => setMode('loop')}
          color="var(--clr-b)"
        />
        <ModeTab
          label="BEAT JUMP"
          active={mode === 'beatjump'}
          onClick={() => setMode('beatjump')}
          color="var(--clr-master)"
        />
        <ModeTab
          label="LOOP ROLL"
          active={mode === 'looproll'}
          onClick={() => setMode('looproll')}
          color="#22d3ee"
        />
      </div>

      {/* ── Pads + Quantize strip ───────────────────────────── */}
      <div className="flex gap-2 w-full">
        {/* Pad grid */}
        <div className="grid grid-cols-4 gap-2 flex-1 min-w-0">
          {mode === 'hotcue'
            ? Array.from({ length: 8 }, (_, i) => (
                <HotCuePad key={i} deckId={deckId} index={i} />
              ))
            : mode === 'loop'
              ? Array.from({ length: 8 }, (_, i) => (
                  <LoopPad key={i} deckId={deckId} index={i} />
                ))
              : mode === 'beatjump'
                ? Array.from({ length: 8 }, (_, i) => (
                    <BeatJumpPad key={i} deckId={deckId} index={i} />
                  ))
                : Array.from({ length: 8 }, (_, i) => (
                    <LoopRollPad key={i} deckId={deckId} index={i} />
                  ))
          }
        </div>

        {/* Quantize strip — 2 buttons stacked, same width as pitch fader */}
        <div className="flex flex-col gap-2 shrink-0" style={{ width: 48 }}>
          <button
            type="button"
            onClick={toggleQuantize}
            className="flex-1 rounded-md text-[11px] font-black uppercase tracking-wider transition-all active:scale-95"
            style={{
              background: quantize ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${quantize ? 'var(--clr-master)' : 'var(--brd-default)'}`,
              color: quantize ? 'var(--clr-master)' : 'var(--txt-muted)',
              boxShadow: quantize ? '0 0 8px rgba(168,85,247,0.2)' : 'none',
            }}
            title="Quantize: snap cues & loops to the beat grid"
          >
            Q
          </button>
          <button
            type="button"
            onClick={cycleQValue}
            className="flex-1 rounded-md text-[10px] font-bold font-mono tabular-nums transition-all active:scale-95"
            style={{
              background: quantize ? 'rgba(168, 85, 247, 0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${quantize ? 'rgba(168,85,247,0.2)' : 'var(--brd-default)'}`,
              color: quantize ? 'var(--clr-master)' : 'var(--txt-muted)',
            }}
            title={`Quantize resolution: ${qVal.label} beat`}
          >
            {qVal.label}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Mode tab button ──────────────────────────────────────────

const ModeTab: FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  color: string;
}> = ({ label, active, onClick, color }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all text-center"
    style={{
      background: 'transparent',
      border: 'none',
      borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
      color: active ? color : 'var(--txt-muted)',
      textShadow: active ? `0 0 8px ${color}44` : 'none',
    }}
  >
    {label}
  </button>
);

// ── Hot Cue Pad ──────────────────────────────────────────────

const HotCuePad: FC<{ deckId: DeckId; index: number }> = ({ deckId, index }) => {
  const cueTime = useMixiStore((s) => s.decks[deckId].hotCues[index]);
  const setHotCue = useMixiStore((s) => s.setHotCue);
  const triggerHotCue = useMixiStore((s) => s.triggerHotCue);
  const deleteHotCue = useMixiStore((s) => s.deleteHotCue);

  const isFilled = cueTime !== null;
  const padColor = CUE_COLORS[index];

  const handleClick = useCallback(
    (e: MouseEvent) => {
      // Shift+Click = delete
      if (e.shiftKey && isFilled) {
        deleteHotCue(deckId, index);
        return;
      }

      if (isFilled) {
        // Jump to this cue point.
        triggerHotCue(deckId, index);
      } else {
        // Save current position as a new cue.
        const engine = MixiEngine.getInstance();
        if (!engine.isInitialized) return;
        const currentTime = engine.getCurrentTime(deckId);
        setHotCue(deckId, index, currentTime);
      }
    },
    [deckId, index, isFilled, setHotCue, triggerHotCue, deleteHotCue],
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      if (isFilled) {
        deleteHotCue(deckId, index);
      }
    },
    [deckId, index, isFilled, deleteHotCue],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className="mixi-pad relative flex items-center justify-center rounded-[6px] h-11 text-[10px] font-bold uppercase transition-all select-none"
      style={{
        background: isFilled
          ? `${padColor}08`
          : 'var(--srf-mid)',
        border: `1px solid ${isFilled ? padColor : 'var(--srf-light)'}`,
        color: isFilled ? padColor : 'var(--txt-dim)',
        boxShadow: isFilled
          ? `inset 0 0 25px ${padColor}b3, 0 0 10px ${padColor}44, 0 2px 4px rgba(0,0,0,0.4)`
          : 'inset 0 2px 6px rgba(0,0,0,0.6), inset 0 -1px 0 #252525, 0 1px 0 rgba(255,255,255,0.015)',
      }}
    >
      {isFilled && (
        <span style={{ textShadow: `0 0 6px ${padColor}88` }}>{index + 1}</span>
      )}
    </button>
  );
};

// ── Loop Pad ─────────────────────────────────────────────────

const LoopPad: FC<{ deckId: DeckId; index: number }> = ({ deckId, index }) => {
  const activeLoop = useMixiStore((s) => s.decks[deckId].activeLoop);
  const setAutoLoop = useMixiStore((s) => s.setAutoLoop);
  const exitLoopAction = useMixiStore((s) => s.exitLoop);

  const beats = LOOP_BEATS[index];
  const label = LOOP_LABELS[index];
  const isActive = activeLoop !== null && activeLoop.lengthInBeats === beats;

  const handleClick = useCallback(() => {
    if (isActive) {
      exitLoopAction(deckId);
    } else {
      setAutoLoop(deckId, beats);
    }
  }, [deckId, beats, isActive, setAutoLoop, exitLoopAction]);

  const LOOP_COLOR = 'var(--clr-b)'; // orange

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mixi-pad relative flex items-center justify-center rounded-[6px] h-11 text-[10px] font-bold transition-all select-none"
      style={{
        background: isActive
          ? `${LOOP_COLOR}08`
          : 'var(--srf-mid)',
        border: `1px solid ${isActive ? LOOP_COLOR : 'var(--srf-light)'}`,
        color: isActive ? LOOP_COLOR : 'var(--txt-muted)',
        boxShadow: isActive
          ? `inset 0 0 25px ${LOOP_COLOR}b3, 0 0 10px ${LOOP_COLOR}44, 0 2px 4px rgba(0,0,0,0.4)`
          : 'inset 0 2px 6px rgba(0,0,0,0.6), inset 0 -1px 0 #252525, 0 1px 0 rgba(255,255,255,0.015)',
        animation: isActive ? 'pulse 2s ease-in-out infinite' : 'none',
      }}
    >
      {label}
    </button>
  );
};

// ── Loop Roll Pad (momentary: hold = loop + slip, release = snap back) ──

const LoopRollPad: FC<{ deckId: DeckId; index: number }> = ({ deckId, index }) => {
  const setAutoLoop = useMixiStore((s) => s.setAutoLoop);
  const exitLoopAction = useMixiStore((s) => s.exitLoop);
  const setSlipMode = useMixiStore((s) => s.setSlipMode);

  const beats = LOOP_BEATS[index];
  const label = LOOP_LABELS[index];
  const [held, setHeld] = useState(false);
  const ROLL_COLOR = '#22d3ee';

  const handleDown = useCallback(() => {
    setHeld(true);
    setSlipMode(deckId, true);
    setAutoLoop(deckId, beats);
  }, [deckId, beats, setAutoLoop, setSlipMode]);

  const handleUp = useCallback(() => {
    if (!held) return;
    setHeld(false);
    exitLoopAction(deckId);
    setSlipMode(deckId, false);
  }, [deckId, held, exitLoopAction, setSlipMode]);

  return (
    <button
      type="button"
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
      onPointerCancel={handleUp}
      className="mixi-pad relative flex items-center justify-center rounded-[6px] h-11 text-[10px] font-bold transition-all select-none touch-none"
      style={{
        background: held ? `${ROLL_COLOR}15` : 'var(--srf-mid)',
        border: `1px solid ${held ? ROLL_COLOR : 'var(--srf-light)'}`,
        color: held ? ROLL_COLOR : 'var(--txt-muted)',
        boxShadow: held
          ? `inset 0 0 25px ${ROLL_COLOR}88, 0 0 10px ${ROLL_COLOR}44, 0 2px 4px rgba(0,0,0,0.4)`
          : 'inset 0 2px 6px rgba(0,0,0,0.6), inset 0 -1px 0 #252525, 0 1px 0 rgba(255,255,255,0.015)',
        animation: held ? 'pulse 0.5s ease-in-out infinite' : 'none',
      }}
    >
      {label}
    </button>
  );
};

// ── Beat Jump Pad ───────────────────────────────────────────

const BeatJumpPad: FC<{ deckId: DeckId; index: number }> = ({ deckId, index }) => {
  const beatJump = useMixiStore((s) => s.beatJump);

  const beats = JUMP_BEATS[index];
  const label = JUMP_LABELS[index];
  const isBackward = beats < 0;
  const JUMP_COLOR = 'var(--clr-master)';

  const [flash, setFlash] = useState(false);

  const handleClick = useCallback(() => {
    beatJump(deckId, beats);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }, [deckId, beats, beatJump]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mixi-pad relative flex items-center justify-center rounded-[6px] h-11 text-[9px] font-mono font-bold transition-all select-none"
      style={{
        background: flash ? `${JUMP_COLOR}20` : 'var(--srf-mid)',
        border: `1px solid ${flash ? JUMP_COLOR : 'var(--srf-light)'}`,
        color: flash ? JUMP_COLOR : isBackward ? 'var(--txt-muted)' : 'var(--txt-secondary)',
        boxShadow: flash
          ? `inset 0 0 15px ${JUMP_COLOR}55, 0 0 8px ${JUMP_COLOR}33`
          : 'inset 0 2px 6px rgba(0,0,0,0.6), inset 0 -1px 0 #252525, 0 1px 0 rgba(255,255,255,0.015)',
      }}
    >
      {label}
    </button>
  );
};
