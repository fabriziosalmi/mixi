/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// HUD Status Bar — Real-time feedback ticker
//
// Full-width row below the topbar HUD. Shows:
//   - Parameter changes (knob/fader touch → "CUTOFF 2.4kHz")
//   - Alerts & notifications (limiter clip, sync lost, etc.)
//   - System messages (pattern loaded, recording started)
//
// Messages auto-fade after 2s. Uses a global event bus
// (HudStatus.show()) so any component can push messages.
// Direct DOM mutation for zero re-renders during performance.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';

// ── Global Status Bus ───────────────────────────────────────
// Any component can call HudStatus.show('message', 'type')

type StatusType = 'info' | 'param' | 'alert' | 'success';

interface StatusMessage {
  text: string;
  type: StatusType;
  timestamp: number;
}

type StatusListener = (msg: StatusMessage) => void;

const listeners = new Set<StatusListener>();

export const HudStatus = {
  /** Show a message in the status bar. Auto-fades after 2s. */
  show(text: string, type: StatusType = 'info'): void {
    const msg: StatusMessage = { text, type, timestamp: Date.now() };
    for (const fn of listeners) fn(msg);
  },

  /** Show a parameter change (most common usage) */
  param(label: string, value: string): void {
    this.show(`${label}  ${value}`, 'param');
  },

  /** Show an alert */
  alert(text: string): void {
    this.show(text, 'alert');
  },

  /** Show a success notification */
  success(text: string): void {
    this.show(text, 'success');
  },

  /** Subscribe to status updates (internal) */
  _subscribe(fn: StatusListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// ── Color mapping ───────────────────────────────────────────

const TYPE_COLORS: Record<StatusType, string> = {
  info: 'var(--txt-muted)',
  param: 'var(--clr-master)',
  alert: 'var(--status-warn)',
  success: 'var(--status-ok)',
};

// ── Component ───────────────────────────────────────────────

export const HudStatusBar: FC = () => {
  const textRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(0 as unknown as ReturnType<typeof setTimeout>);

  useEffect(() => {
    return HudStatus._subscribe((msg) => {
      const el = textRef.current;
      const bar = barRef.current;
      if (!el || !bar) return;

      // Clear previous fade timer
      clearTimeout(timerRef.current);

      // Set text and color
      el.textContent = msg.text;
      el.style.color = TYPE_COLORS[msg.type];
      bar.style.opacity = '1';

      // Auto-fade after 2s
      timerRef.current = setTimeout(() => {
        if (bar) bar.style.opacity = '0.3';
      }, 2000);
    });
  }, []);

  return (
    <div
      ref={barRef}
      className="grid items-center px-4 overflow-hidden"
      style={{
        gridColumn: '1 / -1',
        gridTemplateColumns: 'subgrid',
        height: 18,
        background: 'rgba(0,0,0,0.7)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        opacity: 0.3,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Left — deck A context / param feedback */}
      <div className="truncate">
        <span
          ref={textRef}
          className="text-[10px] font-mono tracking-wide"
          style={{ color: 'var(--txt-muted)' }}
        >
          MIXI v0.2.12 ready
        </span>
      </div>

      {/* Center — alerts / system messages */}
      <div className="flex justify-center truncate">
        <span
          className="text-[10px] font-mono tracking-wide"
          style={{ color: 'rgba(255,255,255,0.15)' }}
        >
          ●
        </span>
      </div>

      {/* Right — deck B context / notifications */}
      <div className="flex justify-end truncate">
        <span
          className="text-[9px] font-mono tracking-wide"
          style={{ color: 'rgba(255,255,255,0.15)' }}
        />
      </div>
    </div>
  );
};
