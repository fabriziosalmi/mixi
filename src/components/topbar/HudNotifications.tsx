/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// HUD Notifications — Toast-style notification area
//
// Dynamic-width area between center HUD and right controls.
// Shows transient messages (track loaded, MIDI connected, etc.)
// with auto-dismiss after 3 seconds.
//
// Uses a global event bus — any component can push notifications:
//   import { notify } from './HudNotifications';
//   notify.info('Track loaded: Artist - Title');
//   notify.success('MIDI controller connected');
//   notify.warn('Low disk space');
//   notify.error('Audio device disconnected');
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';

// ── Notification types ──────────────────────────────────────

type NotifyType = 'info' | 'success' | 'warn' | 'error';

interface Notification {
  text: string;
  type: NotifyType;
  id: number;
}

type NotifyListener = (n: Notification | null) => void;

let _nextId = 0;
const listeners = new Set<NotifyListener>();
let _dismissTimer: ReturnType<typeof setTimeout> | null = null;

function _push(text: string, type: NotifyType) {
  const n: Notification = { text, type, id: ++_nextId };
  if (_dismissTimer) clearTimeout(_dismissTimer);
  for (const fn of listeners) fn(n);
  _dismissTimer = setTimeout(() => {
    for (const fn of listeners) fn(null);
  }, 3000);
}

/** Global notification API — call from anywhere */
export const notify = {
  info:    (text: string) => _push(text, 'info'),
  success: (text: string) => _push(text, 'success'),
  warn:    (text: string) => _push(text, 'warn'),
  error:   (text: string) => _push(text, 'error'),
};

const TYPE_STYLES: Record<NotifyType, { color: string; bg: string; border: string }> = {
  info:    { color: 'var(--txt-secondary)', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)' },
  success: { color: 'var(--status-ok)',     bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.2)' },
  warn:    { color: 'var(--status-warn)',   bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  error:   { color: 'var(--status-error)',  bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.2)' },
};

// ── Component ───────────────────────────────────────────────

export const HudNotifications: FC = () => {
  const textRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler: NotifyListener = (n) => {
      const el = textRef.current;
      const box = containerRef.current;
      if (!el || !box) return;

      if (!n) {
        // Dismiss
        box.style.opacity = '0';
        return;
      }

      const style = TYPE_STYLES[n.type];
      el.textContent = n.text;
      el.style.color = style.color;
      box.style.backgroundColor = style.bg;
      box.style.borderColor = style.border;
      box.style.opacity = '1';
    };

    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center rounded-md px-2 overflow-hidden h-full min-w-0"
      style={{
        opacity: 0,
        transition: 'opacity 0.2s ease',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span
        ref={textRef}
        className="text-[9px] font-sans font-medium tracking-wide truncate"
        style={{ color: 'var(--txt-muted)' }}
      />
    </div>
  );
};
