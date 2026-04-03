/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Control Panel (minimal toggle)
//
// Sparkles icon + 3-position slider (OFF / CRUISE / ASSIST).
// No text labels — pure visual.
// ─────────────────────────────────────────────────────────────

import { useCallback, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import type { AiMode } from '../../types';
import type { AIEngineState } from '../AutoMixEngine';

// ── Sparkles SVG (3 stars, each a different color) ───────────

const SparklesIcon: FC<{ active: boolean; mode: AiMode }> = ({ active, mode }) => {
  // Colors cycle based on mode.
  const c1 = mode === 'OFF' ? 'var(--txt-muted)' : 'var(--clr-a)';
  const c2 = mode === 'OFF' ? 'var(--txt-dim)' : 'var(--clr-master)';
  const c3 = mode === 'OFF' ? 'var(--brd-default)' : 'var(--status-warn)';

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className="transition-all duration-300"
      style={{
        filter: active ? `drop-shadow(0 0 4px ${c1}88)` : 'none',
      }}
    >
      {/* Large star (center-left) */}
      <path
        d="M9 2l1.5 4.5L15 8l-4.5 1.5L9 14l-1.5-4.5L3 8l4.5-1.5z"
        fill={c1}
        className={active ? 'animate-pulse' : ''}
      />
      {/* Medium star (top-right) */}
      <path
        d="M18 5l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"
        fill={c2}
        style={{
          animation: active ? 'pulse 2s ease-in-out 0.3s infinite' : 'none',
        }}
      />
      {/* Small star (bottom-right) */}
      <path
        d="M16 16l.75 2.25L19 19l-2.25.75L16 22l-.75-2.25L13 19l2.25-.75z"
        fill={c3}
        style={{
          animation: active ? 'pulse 2s ease-in-out 0.6s infinite' : 'none',
        }}
      />
    </svg>
  );
};

// ── Mode colors ──────────────────────────────────────────────

const MODE_COLORS: Record<AiMode, string> = {
  OFF: 'var(--txt-muted)',
  CRUISE: 'var(--clr-a)',
  ASSIST: 'var(--status-ok)',
};

const MODES: AiMode[] = ['OFF', 'CRUISE', 'ASSIST'];

// ── Component ────────────────────────────────────────────────

interface AiControlPanelProps {
  engineState: AIEngineState;
  onToggleEngine: () => void;
}

export const AiControlPanel: FC<AiControlPanelProps> = ({
  engineState,
  onToggleEngine,
}) => {
  const aiState = useMixiStore((s) => s.ai);
  const setAiMode = useMixiStore((s) => s.setAiMode);

  const currentIdx = MODES.indexOf(aiState.mode);
  const isActive = aiState.mode !== 'OFF' && engineState.enabled;
  const isPaused = aiState.mode === 'ASSIST' && aiState.isPaused;

  const handleModeChange = useCallback(
    (mode: AiMode) => {
      setAiMode(mode);
      if (mode !== 'OFF' && !engineState.enabled) onToggleEngine();
      if (mode === 'OFF' && engineState.enabled) onToggleEngine();
    },
    [setAiMode, engineState, onToggleEngine],
  );

  // Cycle through modes on sparkle click.
  const cycleMode = useCallback(() => {
    const next = MODES[(currentIdx + 1) % MODES.length];
    handleModeChange(next);
  }, [currentIdx, handleModeChange]);

  const color = MODE_COLORS[aiState.mode];

  return (
    <div className="flex items-center gap-2">
      {/* Sparkles icon — click to cycle modes */}
      <button
        type="button"
        onClick={cycleMode}
        className="rounded-md p-1 transition-all active:scale-90"
        title={`AI: ${aiState.mode}`}
      >
        <SparklesIcon active={isActive} mode={aiState.mode} />
      </button>

      {/* 3-position toggle track */}
      <div
        className="relative flex items-center w-[52px] h-[18px] rounded-full cursor-pointer"
        style={{ background: 'var(--srf-mid)', border: '1px solid var(--brd-default)' }}
      >
        {/* Sliding indicator */}
        <div
          className="absolute h-[12px] w-[14px] rounded-full transition-all duration-200"
          style={{
            left: currentIdx === 0 ? 2 : currentIdx === 1 ? 18 : 34,
            background: color,
            boxShadow: aiState.mode !== 'OFF' ? `0 0 6px ${color}88` : 'none',
          }}
        />

        {/* 3 click zones */}
        {MODES.map((mode) => (
          <div
            key={mode}
            className="flex-1 h-full cursor-pointer z-10"
            onClick={() => handleModeChange(mode)}
            title={mode}
          />
        ))}

        {/* Dot markers */}
        <div className="absolute inset-0 flex items-center justify-between px-[6px] pointer-events-none">
          {MODES.map((mode, i) => (
            <div
              key={mode}
              className="h-[4px] w-[4px] rounded-full"
              style={{
                background: currentIdx === i ? 'transparent' : 'var(--txt-dim)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Paused indicator — only when ASSIST is paused */}
      {isPaused && (
        <span
          className="text-[9px] font-mono uppercase tracking-wider"
          style={{ color: 'var(--status-warn-bright)' }}
        >
          pause
        </span>
      )}
    </div>
  );
};
