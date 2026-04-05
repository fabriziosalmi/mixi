/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Deck Section (responsive layout)
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { Knob } from '../controls/Knob';
import { PremiumJogWheel } from './PremiumJogWheel';
import { NeonPlayButton, NeonSyncButton } from './NeonTransport';
import { TrackLoader } from './TrackLoader';
import { WaveformDisplay } from './WaveformDisplay';
import { WaveformOverview } from './WaveformOverview';
import { TrackInfo } from './TrackInfo';
import { PerformancePads } from './PerformancePads';
import { PitchStrip } from './PitchStrip';
import type { DeckId } from '../../types';

interface DeckSectionProps {
  deckId: DeckId;
  color: string;
}

export const DeckSection: FC<DeckSectionProps> = ({ deckId, color }) => {
  // Granular selectors — only re-render when the field we actually use changes
  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  const isTrackLoaded = useMixiStore((s) => s.decks[deckId].isTrackLoaded);
  const isSynced = useMixiStore((s) => s.decks[deckId].isSynced);
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);
  const originalBpm = useMixiStore((s) => s.decks[deckId].originalBpm);
  const trackName = useMixiStore((s) => s.decks[deckId].trackName);
  const musicalKey = useMixiStore((s) => s.decks[deckId].musicalKey);
  const cueActive = useMixiStore((s) => s.decks[deckId].cueActive);
  const playbackRate = useMixiStore((s) => s.decks[deckId].playbackRate);
  const setPlaying = useMixiStore((s) => s.setDeckPlaying);
  const setPlaybackRate = useMixiStore((s) => s.setDeckPlaybackRate);
  const syncDeck = useMixiStore((s) => s.syncDeck);
  const unsyncDeck = useMixiStore((s) => s.unsyncDeck);
  const ejectDeck = useMixiStore((s) => s.ejectDeck);
  const setDeckMode = useMixiStore((s) => s.setDeckMode);

  const togglePlay = useCallback(
    () => setPlaying(deckId, !isPlaying),
    [deckId, isPlaying, setPlaying],
  );
  const onPitchChange = useCallback(
    (val: number) => setPlaybackRate(deckId, val),
    [deckId, setPlaybackRate],
  );
  const toggleSync = useCallback(() => {
    if (isSynced) unsyncDeck(deckId);
    else syncDeck(deckId);
  }, [deckId, isSynced, syncDeck, unsyncDeck]);


  const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
  const otherBpm = useMixiStore((s) => s.decks[otherDeckId].bpm);
  const canSync = originalBpm > 0 && otherBpm > 0;

  return (
    <div
      className="flex flex-col gap-1.5 h-full overflow-hidden transition-opacity duration-500"
      style={{ opacity: !isTrackLoaded && !isPlaying ? 0.6 : 1 }}
    >
      {/* ── Unified Header — flush with top border ────────────── */}
      <div className="mixi-deck-header flex items-center gap-2 px-3 pt-2.5 pb-1 border-b border-zinc-800/30">
        {/* Status dot */}
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${isPlaying ? 'mixi-dot-pulse' : ''}`}
          style={{
            backgroundColor: isPlaying ? color : 'var(--txt-muted)',
            boxShadow: isPlaying ? `0 0 8px ${color}` : 'none',
          }}
        />
        {/* Deck label */}
        <span className="text-xs font-bold tracking-[0.15em] shrink-0" style={{ color }}>
          {deckId}
        </span>
        {/* Headphone icon — visible when CUE is active */}
        {cueActive && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--clr-b)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ filter: 'drop-shadow(0 0 3px rgba(255,106,0,0.6))' }}>
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z" />
            <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z" />
          </svg>
        )}
        {/* Eject */}
        {isTrackLoaded && (
          <button
            type="button"
            onClick={() => ejectDeck(deckId)}
            className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Eject track"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5,18 12,6 19,18" />
              <line x1="5" y1="22" x2="19" y2="22" />
            </svg>
          </button>
        )}
        {/* Track name — fills available space */}
        {isTrackLoaded && (
          <span className="flex-1 truncate text-[12px] text-zinc-300 font-bold min-w-0">
            {trackName || ''}
          </span>
        )}
        {/* Spacer when no track */}
        {!isTrackLoaded && <span className="flex-1" />}
        {/* Key badge */}
        {musicalKey && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider"
            style={{ background: `${color}15`, border: `1px solid ${color}33`, color }}
          >
            {musicalKey}
          </span>
        )}
        {/* BPM + Beat counter */}
        {bpm > 0 && (
          <div className="flex items-baseline shrink-0">
            <span className="text-sm font-mono font-black text-white" style={{ fontFeatureSettings: '"tnum"' }}>
              {bpm.toFixed(1)}
            </span>
            <BeatCounter deckId={deckId} color={color} />
          </div>
        )}
        {/* Time counter */}
        {isTrackLoaded && (
          <TrackInfo deckId={deckId} color={color} compact />
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="mixi-deck-content flex flex-1 flex-col px-3 pb-3 min-h-0 relative">
        {!isTrackLoaded && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-xl m-3 pointer-events-auto p-6">
            <TrackLoader deckId={deckId} color={color} onSwitchToGroovebox={() => setDeckMode(deckId, 'groovebox')} onSwitchModule={(mode) => setDeckMode(deckId, mode)} />
          </div>
        )}
        <div className={`flex flex-1 flex-col min-h-0 transition-all duration-500 ease-out ${!isTrackLoaded ? 'pointer-events-none opacity-60 blur-[2px]' : 'opacity-100 blur-0'}`}>
          {/* Waveform */}
          <div className="mixi-waveform-area shrink-0 flex flex-col gap-1.5">
            <WaveformDisplay deckId={deckId} height={70} />
            <WaveformOverview deckId={deckId} height={22} />
          </div>

          {/* FX Strip + Jog wheel + Pitch strip */}
          <div className="flex items-center flex-1 min-h-0 py-2">
            <FxStrip deckId={deckId} color={color} />
            <div className="flex flex-col items-center justify-center flex-1">
              <PremiumJogWheel deckId={deckId} color={color} size={320} />
              {/* Transport buttons — tight under wheel */}
              <div className="mixi-transport flex items-center justify-center gap-14 mt-4">
                <NeonPlayButton isPlaying={isPlaying} onToggle={togglePlay} color={color} size={72} midiAction={{ type: 'DECK_PLAY', deck: deckId }} />
                <NeonSyncButton isSynced={isSynced} canSync={canSync} onToggle={toggleSync} color={color} size={72} midiAction={{ type: 'DECK_SYNC', deck: deckId }} />
              </div>
            </div>
            <PitchStrip
              value={playbackRate}
              onChange={onPitchChange}
              color={color}
              deckId={deckId}
              midiAction={{ type: 'DECK_PITCH', deck: deckId }}
            />
          </div>

          {/* Performance Pads */}
          <div className="mixi-pads-section shrink-0">
            <PerformancePads deckId={deckId} color={color} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Beat Counter (header, after BPM) ───────────────────────

const BeatCounter: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const engine = MixiEngine.getInstance();

    const timer = setInterval(() => {
      const deck = useMixiStore.getState().decks[deckId];
      const el = spanRef.current;
      if (el && engine.isInitialized && deck.isPlaying && deck.bpm > 0) {
        const t = engine.getCurrentTime(deckId);
        const beatPeriod = 60 / deck.bpm;
        const beat = (t - deck.firstBeatOffset) / beatPeriod;
        el.textContent = `.${(((Math.floor(beat) % 4) + 4) % 4) + 1}`;
      } else if (el) {
        el.textContent = '';
      }
    }, 100);

    return () => clearInterval(timer);
  }, [deckId]);

  return (
    <span
      ref={spanRef}
      className="text-[10px] font-mono font-black"
      style={{ color, fontFeatureSettings: '"tnum"', minWidth: 12, marginLeft: 1 }}
    />
  );
};

// ── FX Strip (left side, mirrors PitchStrip) ───────────────

const GATE_LABELS = ['1/32', '1/16', '1/8', '1/4', '1/2'];
function snapGate(v: number): number { return Math.round(v); }

const FX_IDS = ['flt', 'dly', 'rev', 'pha', 'flg', 'gate', 'crush', 'echo', 'tape', 'noise'] as const;

const FxStrip: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const [fx, setFx] = useState(() => Array<number>(FX_IDS.length).fill(0));
  const [active, setActive] = useState(() => Array<boolean>(FX_IDS.length).fill(false));
  const fxRef = useRef(fx);
  useEffect(() => { fxRef.current = fx; }, [fx]);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const labels = ['FLT', 'DLY', 'REV', 'PHA', 'FLG', 'GATE', 'CRU', 'ECH', 'TAP', 'NOI'];

  const toggleFx = useCallback((i: number) => {
    setActive((a) => {
      const n = [...a]; n[i] = !n[i];
      MixiEngine.getInstance().setDeckFx(deckId, FX_IDS[i], fxRef.current[i], n[i]);
      return n;
    });
  }, [deckId]);

  const setFxVal = useCallback((i: number, v: number) => {
    setFx((f) => {
      const n = [...f]; n[i] = v;
      MixiEngine.getInstance().setDeckFx(deckId, FX_IDS[i], v, activeRef.current[i]);
      return n;
    });
  }, [deckId]);

  return (
    <div
      className="mixi-fx-strip flex flex-col items-center gap-1 shrink-0 py-1 px-1 rounded-md bg-zinc-900/50 overflow-y-auto"
      style={{
        width: 48,
        border: '1px solid rgba(255,255,255,0.04)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.02)',
      }}
    >
      {FX_IDS.map((_, i) => {
        const isGate = i === 5;
        return (
          <FxSlot
            key={i}
            label={labels[i]}
            value={fx[i]}
            onChange={(v) => setFxVal(i, isGate ? snapGate(v) : v)}
            active={active[i]}
            onToggle={() => toggleFx(i)}
            color={color}
            min={isGate ? 0 : 0}
            max={isGate ? 4 : 1}
            valueLabel={isGate ? GATE_LABELS[Math.round(fx[i])] : undefined}
          />
        );
      })}
    </div>
  );
};

const FxSlot: FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  active: boolean;
  onToggle: () => void;
  color: string;
  min?: number;
  max?: number;
  valueLabel?: string;
}> = ({ label, value, onChange, active, onToggle, color, min = 0, max = 1, valueLabel }) => {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Knob
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        color={active ? color : 'var(--txt-muted)'}
        scale={0.7}
        defaultValue={0}
      />
      <button
        type="button"
        onClick={onToggle}
        className="mixi-btn rounded flex items-center justify-center transition-all active:scale-95"
        style={{
          width: 36,
          height: 16,
          background: active ? `${color}15` : 'rgba(255,255,255,0.03)',
          border: 'none',
          boxShadow: active
            ? `0 0 6px ${color}22, inset 0 1px 2px rgba(0,0,0,0.3)`
            : 'inset 0 1px 2px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.02)',
          borderRadius: 4,
        }}
      >
        <span
          className="text-[7px] font-mono font-bold tracking-wider"
          style={{
            color: active ? color : 'var(--txt-tertiary)',
            textShadow: active ? `0 0 4px ${color}44` : 'none',
          }}
        >
          {active && valueLabel ? valueLabel : label}
        </span>
      </button>
    </div>
  );
};
