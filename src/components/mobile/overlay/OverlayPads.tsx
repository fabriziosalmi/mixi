/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// OverlayPads — Mobile performance pads (Hot Cue / Loop / Jump)
//
// 4×2 pad grid with tab-based mode switching.
// Same store actions as desktop PerformancePads — zero duplication.
// ─────────────────────────────────────────────────────────────

import { useCallback, useRef, useState, type FC } from 'react';
import { useMixiStore } from '../../../store/mixiStore';
import { MixiEngine } from '../../../audio/MixiEngine';
import { CUE_COLORS, COLOR_DECK_A, COLOR_DECK_B } from '../../../theme';
import { useHaptics } from '../../../hooks/useHaptics';
import type { DeckId } from '../../../types';

// ── Pad modes ────────────────────────────────────────────────

type PadMode = 'cue' | 'loop' | 'jump';

const MODES: { id: PadMode; label: string }[] = [
  { id: 'cue', label: 'CUE' },
  { id: 'loop', label: 'LOOP' },
  { id: 'jump', label: 'JUMP' },
];

const LOOP_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const LOOP_LABELS = ['1/4', '1/2', '1', '2', '4', '8', '16', '32'];
const JUMP_BEATS = [-32, -8, -4, -1, 1, 4, 8, 32];

// ── Component ────────────────────────────────────────────────

interface OverlayPadsProps {
  deckId: DeckId;
}

export const OverlayPads: FC<OverlayPadsProps> = ({ deckId }) => {
  const [mode, setMode] = useState<PadMode>('cue');
  const color = deckId === 'A' ? COLOR_DECK_A : COLOR_DECK_B;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{
              flex: 1,
              height: 28,
              border: `1px solid ${mode === m.id ? color : '#333'}`,
              borderRadius: 4,
              background: mode === m.id ? `${color}22` : 'transparent',
              color: mode === m.id ? color : '#666',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Pad grid */}
      {mode === 'cue' && <CuePads deckId={deckId} />}
      {mode === 'loop' && <LoopPads deckId={deckId} color={color} />}
      {mode === 'jump' && <JumpPads deckId={deckId} color={color} />}
    </div>
  );
};

// ── Hot Cue Pads ─────────────────────────────────────────────

const CuePads: FC<{ deckId: DeckId }> = ({ deckId }) => {
  const hotCues = useMixiStore((s) => s.decks[deckId].hotCues);
  const setHotCue = useMixiStore((s) => s.setHotCue);
  const triggerHotCue = useMixiStore((s) => s.triggerHotCue);
  const deleteHotCue = useMixiStore((s) => s.deleteHotCue);
  const haptics = useHaptics();

  // Long-press detection for delete
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  const onPadDown = useCallback(
    (index: number) => {
      longPressedRef.current = false;
      haptics.tick();
      timerRef.current = setTimeout(() => {
        longPressedRef.current = true;
        if (hotCues[index] !== null) {
          deleteHotCue(deckId, index);
          haptics.confirm();
        }
      }, 500);
    },
    [deckId, hotCues, deleteHotCue, haptics],
  );

  const onPadUp = useCallback(
    (index: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (longPressedRef.current) return;

      if (hotCues[index] !== null) {
        triggerHotCue(deckId, index);
      } else {
        const engine = MixiEngine.getInstance();
        if (engine.isInitialized) {
          const time = engine.getCurrentTime(deckId);
          setHotCue(deckId, index, time);
          haptics.confirm(); // cue saved feedback
        }
      }
    },
    [deckId, hotCues, triggerHotCue, setHotCue, haptics],
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
      {Array.from({ length: 8 }, (_, i) => {
        const filled = hotCues[i] !== null;
        const padColor = CUE_COLORS[i % CUE_COLORS.length];
        return (
          <button
            key={i}
            onPointerDown={() => onPadDown(i)}
            onPointerUp={() => onPadUp(i)}
            onPointerCancel={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
            style={{
              height: 48,
              border: `1px solid ${filled ? padColor : '#333'}`,
              borderRadius: 6,
              background: filled ? `${padColor}33` : '#151515',
              color: filled ? padColor : '#444',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
};

// ── Loop Pads ────────────────────────────────────────────────

const LoopPads: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const activeLoop = useMixiStore((s) => s.decks[deckId].activeLoop);
  const setAutoLoop = useMixiStore((s) => s.setAutoLoop);
  const exitLoop = useMixiStore((s) => s.exitLoop);
  const haptics = useHaptics();

  const onTap = useCallback(
    (beats: number) => {
      haptics.tick();
      if (activeLoop && activeLoop.lengthInBeats === beats) {
        exitLoop(deckId);
      } else {
        setAutoLoop(deckId, beats);
      }
    },
    [deckId, activeLoop, setAutoLoop, exitLoop, haptics],
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
      {LOOP_BEATS.map((beats, i) => {
        const active = activeLoop?.lengthInBeats === beats;
        return (
          <button
            key={beats}
            onClick={() => onTap(beats)}
            style={{
              height: 48,
              border: `1px solid ${active ? color : '#333'}`,
              borderRadius: 6,
              background: active ? `${color}33` : '#151515',
              color: active ? color : '#888',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {LOOP_LABELS[i]}
          </button>
        );
      })}
    </div>
  );
};

// ── Beat Jump Pads ───────────────────────────────────────────

const JumpPads: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const beatJump = useMixiStore((s) => s.beatJump);
  const haptics = useHaptics();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
      {JUMP_BEATS.map((beats) => (
        <button
          key={beats}
          onClick={() => { haptics.tick(); beatJump(deckId, beats); }}
          style={{
            height: 48,
            border: '1px solid #333',
            borderRadius: 6,
            background: '#151515',
            color: beats < 0 ? '#888' : color,
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {beats > 0 ? `+${beats}` : beats}
        </button>
      ))}
    </div>
  );
};
