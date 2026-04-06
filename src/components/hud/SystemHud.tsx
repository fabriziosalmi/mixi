/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – System HUD (Telemetry dots + SYNC OK)
//
// Minimal: icon + colored dot for CPU and LAT.
// Green = nominal, amber = warning, red = critical.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { MidiManager } from '../../midi/MidiManager';
import { useMidiStore } from '../../store/midiStore';
import { wasmCore, isWasmReady } from '../../wasm/wasmBridge';

const HISTORY_SIZE = 8;
const RISING_THRESHOLD = 4;
const SMOOTH_ALPHA = 0.3;
const BOOT_DURATION_MS = 1200;
const IDLE_DIM_MS = 5000;
const IDLE_OPACITY = 0.3;

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

function latLogScale(ms: number): number {
  if (ms <= 0) return 0;
  if (ms <= 5) return (ms / 5) * 0.6;
  if (ms <= 20) return 0.6 + ((ms - 5) / 15) * 0.25;
  return Math.min(1, 0.85 + ((ms - 20) / 30) * 0.15);
}

// ── SVG Icons (same #555 as other inactive icons) ──────────

const CpuIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
  </svg>
);

const LatIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const StatusDot: FC<{ alert: AlertLevel; pulse?: boolean }> = ({ alert, pulse }) => (
  <div
    className={`h-[8px] w-[8px] rounded-full shrink-0 ${pulse ? (alert === 'critical' ? 'animate-pulse' : 'mixi-dsp-pulse') : ''}`}
    style={{
      backgroundColor: DOT_COLORS[alert],
      boxShadow: `0 0 5px ${DOT_COLORS[alert]}66`,
    }}
  />
);

// ── Main component ─────────────────────────────────────────

export const SystemHud: FC<{ mcpConnected?: boolean }> = ({ mcpConnected = false }) => {
  const isLearning = useMidiStore((s) => s.isLearning);
  const setLearning = useMidiStore((s) => s.setLearning);
  const learningAction = useMidiStore((s) => s.learningAction);

  const [cpuAlert, setCpuAlert] = useState<AlertLevel>('nominal');
  const [cpuPct, setCpuPct] = useState(0);
  const [latAlert, setLatAlert] = useState<AlertLevel>('nominal');
  const [midiConnected, setMidiConnected] = useState(false);
  const [audioOut, setAudioOut] = useState<'running' | 'suspended' | 'closed'>('suspended');
  const [wasmReady, setWasmReady] = useState(isWasmReady());
  const [booting, setBooting] = useState(true);
  const [dimmed, setDimmed] = useState(false);

  const cpuSmooth = useRef(0);
  const cpuHistory = useRef<number[]>([]);
  const frameTimes = useRef<Float64Array>(new Float64Array(120));
  const frameIdx = useRef(0);
  const frameCount = useRef(0);
  const rafRef = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const resetIdle = useCallback(() => {
    setDimmed(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setDimmed(true), IDLE_DIM_MS);
  }, []);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdle));
      clearTimeout(idleTimer.current);
    };
  }, [resetIdle]);

  useEffect(() => {
    const timeout = setTimeout(() => setBooting(false), BOOT_DURATION_MS);
    return () => clearTimeout(timeout);
  }, []);

  // Initialize Rust/Wasm core (lazy, non-blocking)
  useEffect(() => {
    wasmCore().then(() => setWasmReady(true)).catch(() => {});
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
        // Read the last `count` entries in chronological order
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

      const engine = MixiEngine.getInstance();
      if (engine.isInitialized) {
        const latRaw = engine.latency * 1000;
        setLatAlert(getAlertLevel(latLogScale(latRaw)));
        setAudioOut(engine.getAudioContext().state as 'running' | 'suspended' | 'closed');
      }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const midiManager = MidiManager.getInstance();
      setMidiConnected(midiManager.isConnected);
      MidiManager.onStatusChange = (status) => setMidiConnected(status);
    } catch {
      // Ignored if MidiManager fails to get instance
    }
    return () => { MidiManager.onStatusChange = null; };
  }, []);

  const systemAlert: AlertLevel = cpuAlert === 'critical' || latAlert === 'critical'
    ? 'critical'
    : cpuAlert === 'warn' || latAlert === 'warn'
      ? 'warn'
      : 'nominal';

  return (
    <div
      className="flex items-center gap-2 transition-opacity duration-700"
      style={{ opacity: dimmed ? IDLE_OPACITY : 1 }}
      onMouseEnter={() => setDimmed(false)}
    >
      {booting ? (
        <span className="text-[8px] font-mono text-zinc-500">...</span>
      ) : (
        <>
          {/* CPU: icon + dot + percentage */}
          <div className="flex items-center gap-1" title={`CPU: ${cpuPct}%`}>
            <CpuIcon color="var(--txt-muted)" />
            <StatusDot alert={cpuAlert} />
            <span className="text-[8px] font-mono tabular-nums" style={{ color: DOT_COLORS[cpuAlert], minWidth: 22 }}>{cpuPct}%</span>
          </div>

          {/* LAT: icon + dot */}
          <div className="flex items-center gap-1" title="Latency">
            <LatIcon color="var(--txt-muted)" />
            <StatusDot alert={latAlert} />
          </div>

          {/* OUT: audio output state */}
          <div className="flex items-center gap-1" title={`Audio Output: ${audioOut}`}>
            <span className="text-[7px] font-mono font-bold tracking-wider" style={{ color: audioOut === 'running' ? 'var(--status-ok)' : 'var(--status-error-dim)' }}>OUT</span>
            <div
              className="h-[6px] w-[6px] rounded-full shrink-0"
              style={{
                backgroundColor: audioOut === 'running' ? 'var(--status-ok)' : audioOut === 'suspended' ? 'var(--status-warn)' : 'var(--status-error)',
                boxShadow: audioOut === 'running' ? '0 0 6px var(--status-ok)66' : 'none',
              }}
            />
          </div>

          {/* ── gap: System | Audio ── */}
          <div style={{ width: 6 }} />

          {/* Sync status: icon + dot */}
          <div className="flex items-center gap-1" title={systemAlert === 'critical' ? 'System overload' : systemAlert === 'warn' ? 'System warning' : 'System OK'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--txt-muted)" strokeWidth="2" strokeLinecap="round">
              <path d="M4 12a8 8 0 0 1 14-5.3" />
              <path d="M20 12a8 8 0 0 1-14 5.3" />
              <polygon points="18,3 22,7 14,7" fill="var(--txt-muted)" stroke="none" />
              <polygon points="6,21 2,17 10,17" fill="var(--txt-muted)" stroke="none" />
            </svg>
            <StatusDot alert={systemAlert} pulse />
          </div>

          <div style={{ width: 6 }} />

          {/* MIDI status */}
          <div className="flex items-center gap-1" title={midiConnected ? 'MIDI: Active' : 'MIDI: Disconnected'}>
            <button 
              type="button"
              className="text-[7.5px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded transition-all active:scale-95" 
              style={{ 
                color: isLearning ? '#000' : 'var(--txt-muted)',
                backgroundColor: isLearning ? 'var(--status-warn)' : 'transparent',
                border: `1px solid ${isLearning ? 'var(--status-warn)' : 'rgba(255,255,255,0.1)'}`,
                boxShadow: isLearning ? '0 0 10px var(--status-warn)' : 'none',
              }}
              onClick={() => setLearning(!isLearning)}
              title="Toggle MIDI Learn Mode"
            >
              {isLearning ? (learningAction ? `WAITING HW: ${learningAction.type}` : 'TEST CTL') : 'MIDI LRN'}
            </button>
            <div
              className={`h-[8px] w-[8px] rounded-full shrink-0 transition-all ${midiConnected ? 'mixi-dot-pulse duration-300' : 'duration-1000'}`}
              style={{
                backgroundColor: midiConnected ? 'var(--status-ok)' : 'rgba(255,255,255,0.05)',
                border: midiConnected ? 'none' : '1px solid rgba(255,255,255,0.1)',
                boxShadow: midiConnected ? '0 0 8px var(--status-ok)' : 'none',
              }}
            />
          </div>

          {/* MCP status: icon + dot */}

          {/* ── gap ── */}
          <div style={{ width: 6 }} />

          {/* WASM status */}
          <div className="flex items-center gap-1" title={wasmReady ? 'Rust/Wasm: Active' : 'Rust/Wasm: Loading...'}>
            <span className="text-[7px] font-mono font-bold tracking-wider" style={{ color: wasmReady ? 'var(--status-ok)' : 'var(--txt-dim)' }}>WASM</span>
            <div
              className="h-[6px] w-[6px] rounded-full shrink-0"
              style={{
                backgroundColor: wasmReady ? 'var(--status-ok)' : 'var(--brd-default)',
                boxShadow: wasmReady ? '0 0 6px var(--status-ok)66' : 'none',
              }}
            />
          </div>

          {/* ── gap: Audio | Effects ── */}
          <div style={{ width: 6 }} />

          <div className="flex items-center gap-1" title={mcpConnected ? 'AI Agent: Connected' : 'AI Agent: Disconnected'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--txt-muted)" strokeWidth="2" strokeLinecap="round">
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="12" r="3" />
              <path d="M9 12h6" />
            </svg>
            <div
              className="h-[8px] w-[8px] rounded-full shrink-0"
              style={{
                backgroundColor: mcpConnected ? 'var(--status-ok)' : 'var(--brd-default)',
                boxShadow: mcpConnected ? '0 0 5px var(--status-ok)66' : 'none',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};
