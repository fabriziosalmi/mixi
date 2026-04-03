/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Debug Panel
//
// Floating overlay showing live blackboard data and all
// active intents with their scores.
// Only visible when Settings → "AI Debug Panel" is on.
// ─────────────────────────────────────────────────────────────

import { type FC } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import type { AIEngineState } from '../AutoMixEngine';

interface AiDebugPanelProps {
  engineState: AIEngineState;
}

export const AiDebugPanel: FC<AiDebugPanelProps> = ({ engineState }) => {
  const show = useSettingsStore((s) => s.showDebugPanel);
  if (!show) return null;

  const { blackboard: bb, activeIntents, enabled, registeredCount } = engineState;

  return (
    <div className="fixed bottom-3 right-3 z-40 w-[320px] max-h-[400px] overflow-y-auto rounded-xl border border-zinc-800/80 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-md text-[10px] font-mono">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          AI Debug
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${enabled ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-800 text-zinc-500'}`}>
          {enabled ? 'Running' : 'Off'}
        </span>
      </div>

      {/* Active intents */}
      <Section title={`Intents (${activeIntents.length}/${registeredCount})`}>
        {activeIntents.length === 0 ? (
          <span className="text-zinc-500">No intents firing</span>
        ) : (
          activeIntents.map((intent) => (
            <div key={intent.name} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-zinc-500">[{intent.domain}]</span>
                <span className="text-zinc-300 truncate">{intent.name.split('.').pop()}</span>
              </div>
              <ScoreBar score={intent.score} />
            </div>
          ))
        )}
      </Section>

      {/* Blackboard snapshot */}
      {bb && (
        <>
          <Section title="Decks">
            <Row label="Master" value={bb.masterDeck} />
            <Row label="Incoming" value={bb.incomingDeck} />
            <Row label="Both playing" value={bb.bothPlaying ? 'Yes' : 'No'} />
            <Row label="Phase aligned" value={bb.isPhaseAligned ? 'Yes' : 'No'} color={bb.isPhaseAligned ? 'var(--status-ok)' : bb.bothPlaying ? 'var(--status-error)' : undefined} />
            <Row label="Phase drift" value={`${bb.phaseDeltaMs > 0 ? '+' : ''}${bb.phaseDeltaMs.toFixed(1)} ms`} color={Math.abs(bb.phaseDeltaMs) > 50 ? 'var(--status-error)' : Math.abs(bb.phaseDeltaMs) > 10 ? 'var(--status-warn)' : 'var(--status-ok)'} />
            <Row label="Harmonic match" value={bb.isHarmonicMatch ? 'Yes' : 'No'} />
          </Section>

          <Section title="Master Deck">
            <Row label="Beat" value={bb.masterCurrentBeat.toFixed(1)} />
            <Row label="BPM" value={bb.masterBpm.toFixed(1)} />
            <Row label="To outro" value={`${bb.beatsToOutroMaster.toFixed(0)} beats`} />
            <Row label="To end" value={`${bb.beatsToEndMaster.toFixed(0)} beats`} />
            <Row label="Phrase pos" value={`${bb.masterBeatInPhrase.toFixed(1)} / 16`} />
            <Row label="Key" value={bb.masterKey || '—'} />
          </Section>

          <Section title="Incoming Deck">
            <Row label="Beat" value={bb.incomingCurrentBeat.toFixed(1)} />
            <Row label="BPM" value={bb.incomingBpm > 0 ? bb.incomingBpm.toFixed(1) : '—'} />
            <Row label="Ready" value={bb.incomingIsReady ? 'Yes' : 'No'} />
            <Row label="Bass killed" value={bb.incomingBassKilled ? 'Yes' : 'No'} />
            <Row label="Key" value={bb.incomingKey || '—'} />
            <Row label="To drop" value={bb.beatsToIncomingDrop !== null ? `${bb.beatsToIncomingDrop.toFixed(0)} beats` : '—'} />
          </Section>

          <Section title="Flags">
            <Row label="Bass clash" value={bb.bassClash ? 'YES' : 'no'} color={bb.bassClash ? 'var(--status-error)' : undefined} />
            <Row label="Mid clash" value={bb.midClash ? 'YES' : 'no'} color={bb.midClash ? 'var(--status-warn)' : undefined} />
            <Row label="Dead air" value={bb.deadAirImminent ? 'IMMINENT' : 'no'} color={bb.deadAirImminent ? 'var(--status-error)' : undefined} />
            <Row label="Blending" value={bb.isBlending ? 'Yes' : 'No'} />
            <Row label="Master filter" value={bb.masterHasFilter ? 'Yes' : 'No'} />
            <Row label="Master loop" value={bb.masterHasLoop ? 'Yes' : 'No'} />
          </Section>
        </>
      )}

      {/* Tick info */}
      {bb && (
        <div className="mt-2 text-zinc-500 text-[8px]">
          Tick #{bb.tick}
        </div>
      )}
    </div>
  );
};

// ── Sub-components ───────────────────────────────────────────

const Section: FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-2">
    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1 border-b border-zinc-800/40 pb-0.5">
      {title}
    </div>
    <div className="space-y-0.5 pl-1">
      {children}
    </div>
  </div>
);

const Row: FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="flex justify-between">
    <span className="text-zinc-500">{label}</span>
    <span style={{ color: color || 'var(--txt-primary)' }}>{value}</span>
  </div>
);

const ScoreBar: FC<{ score: number }> = ({ score }) => {
  const pct = Math.round(score * 100);
  const barColor = score >= 0.9 ? 'var(--status-error)' : score >= 0.6 ? 'var(--status-warn)' : 'var(--status-ok-dim)';
  return (
    <div className="flex items-center gap-1 shrink-0">
      <div className="w-12 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="text-zinc-500 w-7 text-right">{pct}%</span>
    </div>
  );
};
