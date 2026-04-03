/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Intent Display (OLED micro-terminal)
//
// A minimal, native-feeling display in the header that shows
// the AI's current "thought" — which intent is actively firing.
//
// Visual: dark recessed screen, green monospace text, subtle
// cursor blink. Fades between states smoothly.
//
// When AI is off or idle: displays nothing (collapses).
// When firing: shows top intent in DJ-readable shorthand.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type FC } from 'react';
import type { AIEngineState } from '../AutoMixEngine';

// ── Intent name → DJ-friendly shorthand ─────────────────────

function formatIntent(name: string): string {
  // "safety.dead_air_prevention" → "DEAD AIR PREVENTION"
  // "dynamics.filter_washout"    → "FILTER WASHOUT"
  const short = name.split('.').pop() || name;
  return short.replace(/_/g, ' ').toUpperCase();
}

// ── Component ────────────────────────────────────────────────

interface IntentDisplayProps {
  engineState: AIEngineState;
}

export const IntentDisplay: FC<IntentDisplayProps> = ({ engineState }) => {
  const { enabled, activeIntents } = engineState;
  const [displayText, setDisplayText] = useState('');
  const [visible, setVisible] = useState(false);
  const prevTextRef = useRef('');

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      setDisplayText('');
      prevTextRef.current = '';
      return;
    }

    const top = activeIntents[0];
    const newText = top ? formatIntent(top.name) : '';

    if (newText !== prevTextRef.current) {
      prevTextRef.current = newText;
      if (newText) {
        setDisplayText(newText);
        setVisible(true);
      } else {
        setVisible(false);
      }
    }
  }, [enabled, activeIntents]);

  if (!enabled) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono transition-all duration-300"
      style={{
        background: 'var(--srf-base)',
        border: '1px solid var(--srf-mid)',
        borderLeft: visible ? '2px solid var(--status-ok)' : '2px solid var(--srf-mid)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6)',
        opacity: visible ? 1 : 0.4,
        minWidth: 120,
        maxWidth: 220,
      }}
    >
      {/* Prompt chevron */}
      <span
        className="text-[10px] transition-opacity duration-300"
        style={{
          color: visible ? 'var(--status-ok)' : 'var(--srf-light)',
        }}
      >
        &gt;
      </span>

      {/* Intent text */}
      <span
        className="text-[10px] tracking-wider truncate transition-all duration-200"
        style={{
          color: visible ? 'var(--status-ok)' : 'var(--srf-mid)',
          textShadow: visible ? '0 0 8px var(--status-ok)44' : 'none',
        }}
      >
        {displayText || 'IDLE'}
      </span>

      {/* Blinking cursor */}
      {visible && (
        <span
          className="text-[10px] animate-pulse"
          style={{ color: 'var(--status-ok)88' }}
        >
          _
        </span>
      )}
    </div>
  );
};
