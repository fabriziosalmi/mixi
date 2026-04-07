/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// HUD Status Bar — Real-time feedback + symmetric master meter
//
// Full-width row below the topbar HUD, 3-column subgrid:
//   Left:   param feedback text (deck A context)
//   Center: symmetric master VU — starts from center,
//           L goes left, R goes right.
//           Green at center → yellow → red at edges.
//   Right:  notifications text (deck B context)
//
// Divisors isolate the center section visually.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';

// ── Global Status Bus ───────────────────────────────────────

type StatusType = 'info' | 'param' | 'alert' | 'success';

interface StatusMessage {
  text: string;
  type: StatusType;
  timestamp: number;
}

type StatusListener = (msg: StatusMessage) => void;

const listeners = new Set<StatusListener>();

export const HudStatus = {
  show(text: string, type: StatusType = 'info'): void {
    const msg: StatusMessage = { text, type, timestamp: Date.now() };
    for (const fn of listeners) fn(msg);
  },
  param(label: string, value: string): void {
    this.show(`${label}  ${value}`, 'param');
  },
  alert(text: string): void {
    this.show(text, 'alert');
  },
  success(text: string): void {
    this.show(text, 'success');
  },
  _subscribe(fn: StatusListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const TYPE_COLORS: Record<StatusType, string> = {
  info: 'var(--txt-muted)',
  param: 'var(--clr-master)',
  alert: 'var(--status-warn)',
  success: 'var(--status-ok)',
};

// ── Symmetric Master VU ─────────────────────────────────────
// L channel grows left from center, R channel grows right.
// Color: green at center → yellow at 60% → red at 85%.

const SymmetricMasterVu: FC = () => {
  const barLRef = useRef<HTMLDivElement>(null);
  const barRRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let skip = false;
    function tick() {
      skip = !skip;
      if (!skip) {
        const engine = MixiEngine.getInstance();
        if (engine.isInitialized && barLRef.current && barRRef.current) {
          const level = engine.getMasterLevel();
          const pct = Math.min(100, Math.max(0, level * 100));
          // Color based on level: green → yellow → red
          const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
          // L bar grows left (width = pct/2 % of half)
          barLRef.current.style.width = `${pct}%`;
          barLRef.current.style.backgroundColor = color;
          barLRef.current.style.boxShadow = pct > 10 ? `0 0 4px ${color}66` : 'none';
          // R bar grows right
          barRRef.current.style.width = `${pct}%`;
          barRRef.current.style.backgroundColor = color;
          barRRef.current.style.boxShadow = pct > 10 ? `0 0 4px ${color}66` : 'none';
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex items-center w-full h-full gap-0" title="Master Level">
      {/* L channel — grows RIGHT-to-LEFT (from center to left edge) */}
      <div className="flex-1 flex justify-end" style={{ height: 4 }}>
        <div style={{ height: '100%', borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.04)' }} className="w-full relative">
          <div
            ref={barLRef}
            style={{
              position: 'absolute', right: 0, top: 0, height: '100%',
              width: '0%', borderRadius: 1, transition: 'none',
            }}
          />
        </div>
      </div>
      {/* Center divider line */}
      <div style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
      {/* R channel — grows LEFT-to-RIGHT (from center to right edge) */}
      <div className="flex-1" style={{ height: 4 }}>
        <div style={{ height: '100%', borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.04)' }} className="w-full relative">
          <div
            ref={barRRef}
            style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: '0%', borderRadius: 1, transition: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
};

// ── Component ───────────────────────────────────────────────

export const HudStatusBar: FC = () => {
  const textRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(0 as unknown as ReturnType<typeof setTimeout>);

  useEffect(() => {
    return HudStatus._subscribe((msg) => {
      const el = textRef.current;
      if (!el) return;
      clearTimeout(timerRef.current);
      el.textContent = msg.text;
      el.style.color = TYPE_COLORS[msg.type];
      el.style.opacity = '1';
      timerRef.current = setTimeout(() => {
        if (el) el.style.opacity = '0.4';
      }, 2000);
    });
  }, []);

  return (
    <div
      className="grid items-center px-4 overflow-hidden"
      style={{
        gridColumn: '1 / -1',
        gridTemplateColumns: 'subgrid',
        height: 18,
        background: 'rgba(0,0,0,0.9)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
      }}
    >
      {/* Left — deck A context / param feedback */}
      <div className="truncate">
        <span
          ref={textRef}
          className="text-[9px] font-sans font-medium tracking-wider uppercase"
          style={{ color: 'var(--txt-muted)', letterSpacing: '0.08em' }}
        >
          MIXI V0.2.12 READY
        </span>
      </div>

      {/* Center — Symmetric Master VU Meter with divisors */}
      <div
        className="flex items-center h-full justify-self-stretch px-2"
        style={{
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <SymmetricMasterVu />
      </div>

      {/* Right — deck B context / notifications */}
      <div className="flex justify-end truncate">
        <span
          className="text-[9px] font-sans font-medium tracking-wider uppercase"
          style={{ color: 'rgba(255,255,255,0.15)' }}
        />
      </div>
    </div>
  );
};
