/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – CPU Badge (square button style, lives in center HUD)
//
// Shows CPU load % with color coding:
//   nominal  → muted text, transparent bg
//   warn     → black text, amber bg + glow
//   critical → white text, red bg + glow
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';

const HISTORY_SIZE = 8;
const RISING_THRESHOLD = 4;
const SMOOTH_ALPHA = 0.3;
const BOOT_DURATION_MS = 1200;

type AlertLevel = 'nominal' | 'warn' | 'critical';

const DOT_COLORS: Record<AlertLevel, string> = {
  nominal:  'var(--status-ok)',
  warn:     'var(--status-warn)',
  critical: 'var(--status-error-dim)',
};

function getAlertLevel(value: number): AlertLevel {
  if (value > 0.85) return 'critical';
  if (value > 0.60) return 'warn';
  return 'nominal';
}

function detectCpuAlert(history: number[], current: number): AlertLevel {
  if (current > 0.9) return 'critical';
  let rising = 0;
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i] > history[i - 1] + 0.01) rising++;
    else break;
  }
  if (current > 0.7 && rising >= RISING_THRESHOLD) return 'warn';
  if (current > 0.8) return 'warn';
  return getAlertLevel(current);
}

// ── Main component ─────────────────────────────────────────

export const CpuBadge: FC = () => {
  const [cpuAlert, setCpuAlert] = useState<AlertLevel>('nominal');
  const [cpuPct, setCpuPct] = useState(0);
  const [booting, setBooting] = useState(true);

  const cpuSmooth = useRef(0);
  const cpuHistory = useRef<number[]>([]);
  const frameTimes = useRef<Float64Array>(new Float64Array(120));
  const frameIdx = useRef(0);
  const frameCount = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => setBooting(false), BOOT_DURATION_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    function sample() {
      const buf = frameTimes.current;
      buf[frameIdx.current % 120] = performance.now();
      frameIdx.current++;
      if (frameCount.current < 120) frameCount.current++;
      rafRef.current = requestAnimationFrame(sample);
    }
    rafRef.current = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const count = frameCount.current;
      if (count > 10) {
        const buf = frameTimes.current;
        const head = frameIdx.current;
        let totalDelta = 0;
        let prev = buf[(head - count + 120) % 120];
        for (let i = 1; i < count; i++) {
          const cur = buf[(head - count + i + 120) % 120];
          totalDelta += cur - prev;
          prev = cur;
        }
        const avgFrame = totalDelta / (count - 1);
        const cpuRaw = Math.min(1, Math.max(0, (avgFrame - 10) / 25));
        cpuSmooth.current = cpuSmooth.current * (1 - SMOOTH_ALPHA) + cpuRaw * SMOOTH_ALPHA;
      }

      const cpu = cpuSmooth.current;
      const hist = cpuHistory.current;
      hist.push(cpu);
      if (hist.length > HISTORY_SIZE) hist.shift();
      setCpuAlert(detectCpuAlert(hist, cpu));
      setCpuPct(Math.round(cpu * 100));
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const cpuColor = DOT_COLORS[cpuAlert];

  return (
    <button
      type="button"
      className="text-[10px] font-mono font-black rounded px-1.5 py-0.5 tabular-nums transition-all"
      style={{
        color: cpuAlert === 'nominal' ? 'var(--txt-muted)' : cpuAlert === 'warn' ? '#000' : '#fff',
        backgroundColor: cpuAlert === 'nominal' ? 'transparent' : cpuColor,
        border: `1px solid ${cpuAlert === 'nominal' ? 'rgba(255,255,255,0.1)' : cpuColor}`,
        boxShadow: cpuAlert !== 'nominal' ? `0 0 8px ${cpuColor}66` : 'none',
        minWidth: 32,
        textAlign: 'center',
      }}
      title={`CPU: ${cpuPct}%`}
    >
      {booting ? '...' : `${cpuPct}%`}
    </button>
  );
};

// ── Audio OUT Dot ──────────────────────────────────────────

export const AudioOutDot: FC = () => {
  const [state, setState] = useState<AudioContextState>('suspended');

  const poll = useCallback(() => {
    try {
      const engine = MixiEngine.getInstance();
      if (engine.isInitialized) {
        setState(engine.getAudioContext().state);
      }
    } catch { /* engine not ready */ }
  }, []);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [poll]);

  const isRunning = state === 'running';
  const color = isRunning ? 'var(--status-ok)' : 'var(--status-error-dim)';

  return (
    <div
      className="flex flex-col items-center gap-0"
      title={`Audio output: ${state}`}
    >
      <div
        className="h-2 w-2 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: isRunning ? `0 0 6px ${color}` : 'none',
        }}
      />
      <span
        className="text-[6px] font-mono font-bold uppercase leading-none"
        style={{ color: 'var(--txt-muted)' }}
      >
        OUT
      </span>
    </div>
  );
};
