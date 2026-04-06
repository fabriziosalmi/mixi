/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// TurboKickMobileDeck — Touch-optimized kick sequencer
//
// Mobile version of TurboKick. Same TurboKickEngine, new UI.
//
// Layout:
//   Header:  [←] TURBOKICK A  BPM  SYNC  [ENGAGE]
//   Grid:    16 step pads (scrollable, ≥44px each)
//   Toolbar: [SYNTH] [FX] buttons → open OverlayPanel with knobs
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import type { HouseDeckProps } from '../index';
import { TurboKickEngine } from './TurboKickEngine';
import { STEP_COUNT, type FxKnobId, type ValveId } from './types';
import { Knob } from '../../components/controls/Knob';
import { OverlayPanel, type OverlayTab } from '../../components/mobile/overlay/OverlayPanel';
import { useHaptics } from '../../hooks/useHaptics';

// ── Knob configs ─────────────────────────────────────────────

const SYNTH_KNOBS: { id: FxKnobId; label: string; color: string }[] = [
  { id: 'thump', label: 'THUMP', color: '#ef4444' },
  { id: 'tune', label: 'TUNE', color: '#f59e0b' },
  { id: 'filter', label: 'FLT', color: '#3b82f6' },
  { id: 'resonance', label: 'RES', color: '#8b5cf6' },
];

const FX_KNOBS: { id: FxKnobId | ValveId; label: string; color: string; isValve?: boolean }[] = [
  { id: 'delay', label: 'DLY', color: '#06b6d4' },
  { id: 'lfoRate', label: 'LFO RT', color: '#ec4899' },
  { id: 'lfoDepth', label: 'LFO DP', color: '#ec4899' },
  { id: 'rumble', label: 'RUMBLE', color: '#f59e0b' },
  { id: 'tubeA', label: 'TUBE', color: '#ef4444', isValve: true },
  { id: 'punchB', label: 'PUNCH', color: '#ff6a00', isValve: true },
];

// ── Component ────────────────────────────────────────────────

export const TurboKickMobileDeck: FC<HouseDeckProps> = ({ deckId, color: _color, onSwitchToTrack }) => {
  const haptics = useHaptics();
  const engineRef = useRef<TurboKickEngine | null>(null);

  // Snapshot state
  const [steps, setSteps] = useState<boolean[]>(() => Array(STEP_COUNT).fill(false));
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(128);
  const [synced, setSynced] = useState(true);
  const [fx, setFx] = useState<Record<string, number>>({});
  const [valves, setValves] = useState<Record<string, number>>({});

  // Overlay state
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayTab, setOverlayTab] = useState<OverlayTab>('eq'); // reuse type, 'eq' = synth tab
  const [overlayDeck, setOverlayDeck] = useState(deckId);

  // ── Engine lifecycle ──
  useEffect(() => {
    const eng = new TurboKickEngine(deckId);
    eng.init();
    engineRef.current = eng;

    // Sync initial state
    setSteps([...eng.steps]);
    setBpm(eng.bpm);
    setSynced(eng.syncToMaster);
    setFx({ ...eng.fx });
    setValves({ ...eng.valves });

    eng.onStepChange = (step) => {
      setCurrentStep(step);
      setIsPlaying(eng.isPlaying);
    };

    eng.onKickTrigger = () => {
      haptics.tick();
    };

    // BPM polling (for master sync)
    const bpmInterval = setInterval(() => {
      if (eng.syncToMaster) setBpm(eng.bpm);
    }, 500);

    return () => {
      clearInterval(bpmInterval);
      eng.destroy();
      engineRef.current = null;
    };
  }, [deckId, haptics]);

  // ── Handlers ──

  const toggleStep = useCallback((i: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.toggleStep(i);
    setSteps([...eng.steps]);
    haptics.tick();
  }, [haptics]);

  const toggleEngage = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.isPlaying) eng.stop();
    else eng.engage();
    setIsPlaying(eng.isPlaying || eng.isEngaged);
  }, []);

  const toggleSync = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.syncToMaster = !eng.syncToMaster;
    setSynced(eng.syncToMaster);
    setBpm(eng.bpm);
  }, []);

  const setFxValue = useCallback((id: string, v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setFx(id as FxKnobId, v);
    setFx((prev) => ({ ...prev, [id]: v }));
  }, []);

  const setValveValue = useCallback((id: string, v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setValve(id as ValveId, v);
    setValves((prev) => ({ ...prev, [id]: v }));
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: '#0d0d0d',
        borderRadius: 8,
        border: '1px solid #ef444433',
        fontFamily: 'var(--font-ui)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onSwitchToTrack}
          style={{
            width: 32, height: 28, border: '1px solid #444', borderRadius: 4,
            background: 'transparent', color: '#888', fontSize: 14,
            cursor: 'pointer', touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Exit TurboKick"
        >
          {'←'}
        </button>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-mono)', letterSpacing: 1 }}>
          TURBOKICK {deckId}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: '#ccc' }}>
          {bpm.toFixed(1)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggleSync}
          style={{
            height: 28, padding: '0 8px',
            border: `1px solid ${synced ? '#a855f7' : '#444'}`,
            borderRadius: 4,
            background: synced ? '#a855f722' : 'transparent',
            color: synced ? '#a855f7' : '#666',
            fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
            cursor: 'pointer', touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          SYNC
        </button>
        <button
          onClick={toggleEngage}
          style={{
            height: 36, padding: '0 16px',
            border: `2px solid ${isPlaying ? '#ef4444' : '#444'}`,
            borderRadius: 6,
            background: isPlaying ? '#ef444433' : '#1a1a1a',
            color: isPlaying ? '#ef4444' : '#888',
            fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
            cursor: 'pointer', touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {isPlaying ? 'STOP' : 'ENGAGE'}
        </button>
      </div>

      {/* Step grid — 16 pads, horizontally scrollable */}
      <div
        style={{
          display: 'flex',
          gap: 3,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '4px 0',
          scrollbarWidth: 'none',
        }}
      >
        {steps.map((on, i) => {
          const isCurrent = i === currentStep;
          const isBeatStart = i % 4 === 0;
          return (
            <button
              key={i}
              onClick={() => toggleStep(i)}
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                border: `1px solid ${on ? '#ef4444' : '#333'}`,
                borderTop: isCurrent ? '3px solid #fff' : `1px solid ${on ? '#ef4444' : '#333'}`,
                borderRadius: 4,
                background: on
                  ? (isCurrent ? '#ef4444' : '#ef444455')
                  : (isCurrent ? '#333' : isBeatStart ? '#1a1a1a' : '#111'),
                color: on ? '#fff' : '#555',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Toolbar — SYNTH / FX overlay triggers */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        <button
          onClick={() => { setOverlayTab('eq'); setOverlayOpen(true); }}
          style={{
            height: 28, padding: '0 12px',
            border: '1px solid #444', borderRadius: 4,
            background: 'transparent', color: '#888',
            fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
            cursor: 'pointer', touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          SYNTH
        </button>
        <button
          onClick={() => { setOverlayTab('pads'); setOverlayOpen(true); }}
          style={{
            height: 28, padding: '0 12px',
            border: '1px solid #444', borderRadius: 4,
            background: 'transparent', color: '#888',
            fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
            cursor: 'pointer', touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          FX
        </button>
      </div>

      {/* Overlay for synth/FX knobs */}
      <OverlayPanel
        isOpen={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        activeDeck={overlayDeck}
        onDeckSwitch={setOverlayDeck}
        activeTab={overlayTab}
        onTabChange={setOverlayTab}
      >
        {overlayTab === 'eq' && (
          <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 12 }}>
            {SYNTH_KNOBS.map((k) => (
              <Knob
                key={k.id}
                value={fx[k.id] ?? 0.5}
                min={0}
                max={1}
                onChange={(v) => setFxValue(k.id, v)}
                label={k.label}
                color={k.color}
                scale={1.4}
              />
            ))}
          </div>
        )}
        {overlayTab === 'pads' && (
          <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 12 }}>
            {FX_KNOBS.map((k) => (
              <Knob
                key={k.id}
                value={k.isValve ? (valves[k.id] ?? 0) : (fx[k.id as FxKnobId] ?? 0)}
                min={0}
                max={1}
                onChange={(v) => k.isValve ? setValveValue(k.id, v) : setFxValue(k.id, v)}
                label={k.label}
                color={k.color}
                scale={1.4}
              />
            ))}
          </div>
        )}
      </OverlayPanel>
    </div>
  );
};
