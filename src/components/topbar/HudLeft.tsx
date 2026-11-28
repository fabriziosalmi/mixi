/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Topbar HUD Left — CPU + Master Processing + AI
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { LimiterDot, MasterHud } from '../hud/MasterHud';
import { CpuBadge } from '../hud/SystemHud';
import { MixiEngine } from '../../audio/MixiEngine';
import { AiControlPanel } from '../../ai/components/AiControlPanel';
import { IntentDisplay } from '../../ai/components/IntentDisplay';
import type { AIEngineState } from '../../ai/AutoMixEngine';

interface HudLeftProps {
  aiState: AIEngineState;
  toggleAI: () => void;
}

export const HudLeft: FC<HudLeftProps> = ({ aiState, toggleAI }) => (
  <div
    className="flex items-center gap-3 justify-self-start rounded-md px-3 py-1 overflow-hidden h-full"
    style={{
      background: 'rgba(0,0,0,0.52)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 1px 4px rgba(0,0,0,0.6)',
    }}
  >
    {/* Unified sober monochrome Telemetry pill (DSP % · Latency · Limiter) */}
    <div
      className="flex items-center gap-1.5 rounded px-2 py-0.5 shrink-0"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <CpuBadge />
      <span className="text-[8px] font-mono text-zinc-600 select-none">·</span>
      <LatencyBadge />
      <span className="text-[8px] font-mono text-zinc-600 select-none">·</span>
      <LimiterDot />
    </div>
    <div className="w-px self-stretch my-1 shrink-0" style={{ background: 'rgba(255,255,255,0.09)' }} />
    <MasterHud />
    <div className="w-px self-stretch my-1 shrink-0" style={{ background: 'rgba(255,255,255,0.09)' }} />
    <AiControlPanel engineState={aiState} onToggleEngine={toggleAI} />
    <IntentDisplay engineState={aiState} />
  </div>
);

// ── Audio Latency Badge ─────────────────────────────────────

const LatencyBadge: FC = () => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized || !ref.current) return;
      const ctx = engine.getAudioContext();
      // baseLatency = output latency in seconds (0 if not supported)
      const latMs = ((ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0)) * 1000;
      ref.current.textContent = latMs > 0 ? `${latMs.toFixed(0)}ms` : '—';
      // Only warn when latency actually degrades (>60ms amber, >100ms red)
      ref.current.style.color =
        latMs > 100
          ? 'var(--status-error)'
          : latMs > 60
            ? 'var(--status-warn)'
            : 'var(--txt-secondary)';
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      ref={ref}
      className="text-[9px] font-mono font-bold tabular-nums"
      style={{ color: 'var(--txt-secondary)', minWidth: 22 }}
      title="Audio output latency"
    >
      —
    </span>
  );
};
