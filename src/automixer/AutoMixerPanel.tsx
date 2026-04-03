/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – AutoMixer Control Panel
//
// Minimal UI that shows the FSM state and lets the user
// enable/disable the auto-mixer.  Sits in the header bar.
// ─────────────────────────────────────────────────────────────

import type { FC } from 'react';
import type { AutoMixState } from './types';

interface AutoMixerPanelProps {
  state: AutoMixState;
  onToggle: () => void;
}

/** Short human-readable labels for each intent. */
const INTENT_LABELS: Record<string, string> = {
  MONITORING: 'Monitoring',
  PREPARE_INCOMING: 'Preparing B',
  PHRASE_SYNC_START: 'Launching B',
  RAMP_UP_VOLUME: 'Fade In',
  BASS_SWAP: 'Bass Swap!',
  FILTER_WASHOUT: 'Washing Out',
  FADE_OUT_EXIT: 'Fade Out',
  CLEANUP_AND_SWAP: 'Cleaning Up',
};

/** Accent colours per intent phase. */
const INTENT_COLORS: Record<string, string> = {
  MONITORING: 'var(--txt-primary)',
  PREPARE_INCOMING: 'var(--status-warn-bright)',
  PHRASE_SYNC_START: 'var(--clr-a)',
  RAMP_UP_VOLUME: 'var(--status-ok)',
  BASS_SWAP: 'var(--status-error)',
  FILTER_WASHOUT: 'var(--clr-b)',
  FADE_OUT_EXIT: 'var(--clr-master)',
  CLEANUP_AND_SWAP: 'var(--txt-primary)',
};

export const AutoMixerPanel: FC<AutoMixerPanelProps> = ({ state, onToggle }) => {
  const color = state.enabled
    ? INTENT_COLORS[state.intent] || 'var(--clr-a)'
    : 'var(--txt-muted)';

  return (
    <div className="flex items-center gap-3">
      {/* Enable/disable button */}
      <button
        type="button"
        onClick={onToggle}
        className="rounded-md px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
        style={{
          background: state.enabled ? `${color}22` : 'rgba(255,255,255,0.03)',
          border: `1.5px solid ${state.enabled ? color : 'var(--txt-dim)'}`,
          color: state.enabled ? color : 'var(--txt-secondary)',
          boxShadow: state.enabled ? `0 0 10px ${color}33` : 'none',
        }}
      >
        AUTO MIX
      </button>

      {/* Status */}
      {state.enabled && (
        <div className="flex items-center gap-2">
          {/* Animated dot */}
          <div
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: color,
              boxShadow: `0 0 6px ${color}`,
              animation: state.intent !== 'MONITORING'
                ? 'pulse 1s ease-in-out infinite'
                : 'none',
            }}
          />

          {/* Intent label */}
          <span
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color }}
          >
            {INTENT_LABELS[state.intent] || state.intent}
          </span>

          {/* Progress bar (for animated intents) */}
          {state.progress > 0 && state.progress < 1 && (
            <div className="w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${state.progress * 100}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          )}

          {/* Deck roles */}
          <span className="text-[9px] text-zinc-600">
            {state.roles.outgoing}→{state.roles.incoming}
          </span>
        </div>
      )}
    </div>
  );
};
