/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Mixer Section (compact, fits viewport)
// ─────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MasterVuMeter } from './MasterVuMeter';
import { MasterLedScreen } from './MasterLedScreen';
import { VuMeter } from './VuMeter';
import { Fader } from '../controls/Fader';
import { Knob } from '../controls/Knob';

import { COLOR_DECK_A, COLOR_DECK_B, COLOR_HP } from '../../theme';
import { isGhost } from '../../ai/ghostFields';
import { useSettingsStore, EQ_RANGE_PRESETS } from '../../store/settingsStore';
import type { DeckId, EqBand } from '../../types';
const CYAN = COLOR_DECK_A;
const ORANGE = COLOR_DECK_B;

// ── Hook: deck channel controls ─────────────────────────────

function useDeckControls(deckId: DeckId) {
  const gain = useMixiStore((s) => s.decks[deckId].gain);
  const eq = useMixiStore((s) => s.decks[deckId].eq);
  const colorFx = useMixiStore((s) => s.decks[deckId].colorFx);
  const volume = useMixiStore((s) => s.decks[deckId].volume);
  const eqPreset = useSettingsStore((s) => s.eqRange);
  const eqRange = EQ_RANGE_PRESETS[eqPreset];
  const setGain = useMixiStore((s) => s.setDeckGain);
  const setEq = useMixiStore((s) => s.setDeckEq);
  const setColorFx = useMixiStore((s) => s.setDeckColorFx);
  const setVolume = useMixiStore((s) => s.setDeckVolume);

  const [kills, setKills] = useState<Record<EqBand, number | null>>({ high: null, mid: null, low: null });

  const onGainChange = useCallback((val: number) => setGain(deckId, val), [deckId, setGain]);
  const killsRef = useRef(kills);
  useEffect(() => { killsRef.current = kills; }, [kills]);
  const onEqChange = useCallback(
    (band: EqBand) => (val: number) => {
      if (killsRef.current[band] !== null) setKills((k) => ({ ...k, [band]: null }));
      setEq(deckId, band, val);
    },
    [deckId, setEq],
  );
  const onKill = useCallback(
    (band: EqBand) => () => {
      const isKilled = kills[band] !== null;
      if (isKilled) {
        setEq(deckId, band, kills[band]!);
        setKills((k) => ({ ...k, [band]: null }));
      } else {
        setKills((k) => ({ ...k, [band]: eq[band] }));
        setEq(deckId, band, eqRange.min);
      }
    },
    [deckId, eq, eqRange.min, kills, setEq],
  );
  const onColorFxChange = useCallback((val: number) => setColorFx(deckId, val), [deckId, setColorFx]);
  const onVolumeChange = useCallback((val: number) => setVolume(deckId, val), [deckId, setVolume]);

  return { gain, eq, colorFx, volume, eqRange, kills, onGainChange, onEqChange, onKill, onColorFxChange, onVolumeChange };
}

// ── Volume LCD ──────────────────────────────────────────────

const VolumeLcd: FC<{ value: number; color: string }> = ({ value, color }) => {
  const db = value > 0.001 ? Math.round(20 * Math.log10(value)) : -60;
  const label = db <= -60 ? '-∞' : `${db}`;
  return (
    <span
      className="text-[9px] font-mono font-medium rounded px-1.5 py-0.5"
      style={{
        background: 'var(--srf-base)',
        border: `1px solid ${color}18`,
        color,
        textShadow: `0 0 8px ${color}55`,
        boxShadow: `inset 0 1px 3px rgba(0,0,0,0.6), 0 0 4px ${color}11`,
        minWidth: 32,
        textAlign: 'center' as const,
      }}
    >
      {label}
    </span>
  );
};

// ── EQ Value Display ────────────────────────────────────────

const EqValue: FC<{ value: number; color: string; visible: boolean }> = ({ value, color, visible }) => (
  <span
    className="text-[7px] font-mono font-medium rounded px-1 py-0.5 transition-opacity duration-150"
    style={{
      background: 'var(--srf-base)',
      border: `1px solid ${color}12`,
      color,
      textShadow: `0 0 4px ${color}33`,
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
      minWidth: 24,
      textAlign: 'center' as const,
      opacity: visible ? 1 : 0,
    }}
  >
    {Math.round(value)}
  </span>
);

// ── Kill Button ─────────────────────────────────────────────

const KillBtn: FC<{ killed: boolean; onKill: () => void }> = ({ killed, onKill }) => (
  <button
    type="button"
    onClick={onKill}
    className="flex items-center justify-center rounded-full transition-all duration-150 active:scale-90"
    style={{
      width: 20,
      height: 20,
      background: killed ? 'rgba(220,38,38,0.15)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${killed ? 'var(--clr-kill)44' : 'var(--srf-light)'}`,
      boxShadow: killed ? '0 0 6px rgba(220,38,38,0.2)' : 'inset 0 1px 2px rgba(0,0,0,0.4), 0 0 2px rgba(255,255,255,0.03)',
    }}
  >
    <span
      className="text-[7px] font-mono font-bold"
      style={{ color: killed ? 'var(--clr-kill)' : 'var(--txt-muted)' }}
    >
      K
    </span>
  </button>
);

// ── EQ Cell (mini 3-col grid: value/knob/kill or kill/knob/value) ──

const EqCellA: FC<{
  value: number; min: number; max: number; onChange: (v: number) => void;
  color: string; ghost: boolean; killed: boolean; onKill: () => void; midiAction?: any;
}> = ({ value, min, max, onChange, color, ghost, killed, onKill, midiAction }) => {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => () => { clearTimeout(timer.current!); }, []);
  const show = () => { clearTimeout(timer.current!); setActive(true); };
  const hide = () => { timer.current = setTimeout(() => setActive(false), 600); };
  return (
    <div className="flex items-center gap-1">
      <EqValue value={value} color={color} visible={active} />
      <Knob value={value} min={min} max={max} center={0} onChange={onChange} bipolar color={color} scale={0.8} ghost={ghost} onDragStart={show} onDragEnd={hide} midiAction={midiAction} />
      <KillBtn killed={killed} onKill={onKill} />
    </div>
  );
};

const EqCellB: FC<{
  value: number; min: number; max: number; onChange: (v: number) => void;
  color: string; ghost: boolean; killed: boolean; onKill: () => void; midiAction?: any;
}> = ({ value, min, max, onChange, color, ghost, killed, onKill, midiAction }) => {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => () => { clearTimeout(timer.current!); }, []);
  const show = () => { clearTimeout(timer.current!); setActive(true); };
  const hide = () => { timer.current = setTimeout(() => setActive(false), 600); };
  return (
    <div className="flex items-center gap-1">
      <KillBtn killed={killed} onKill={onKill} />
      <Knob value={value} min={min} max={max} center={0} onChange={onChange} bipolar color={color} scale={0.8} ghost={ghost} onDragStart={show} onDragEnd={hide} midiAction={midiAction} />
      <EqValue value={value} color={color} visible={active} />
    </div>
  );
};

// ── Gain Cell (knob always centered; value badge floats absolutely) ──

const gainBadge = (color: string, active: boolean, side: 'left' | 'right'): React.CSSProperties => ({
  position: 'absolute',
  [side === 'left' ? 'right' : 'left']: 'calc(100% + 4px)',
  background: 'var(--srf-base)',
  border: `1px solid ${color}12`,
  color,
  textShadow: `0 0 4px ${color}33`,
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
  minWidth: 24,
  textAlign: 'center',
  borderRadius: 4,
  padding: '2px 4px',
  fontSize: 7,
  fontFamily: 'monospace',
  fontWeight: 500,
  opacity: active ? 1 : 0,
  transition: 'opacity 150ms',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
});

const GainCellA: FC<{ value: number; onChange: (v: number) => void; color: string; ghost: boolean; midiAction?: any }> = ({ value, onChange, color, ghost, midiAction }) => {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => () => { clearTimeout(timer.current!); }, []);
  const show = () => { clearTimeout(timer.current!); setActive(true); };
  const hide = () => { timer.current = setTimeout(() => setActive(false), 600); };
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span style={gainBadge(color, active, 'left')}>{Math.round(value)}</span>
      <Knob value={value} min={-12} max={12} center={0} onChange={onChange} bipolar color={color} scale={0.8} ghost={ghost} onDragStart={show} onDragEnd={hide} midiAction={midiAction} />
    </div>
  );
};

const GainCellB: FC<{ value: number; onChange: (v: number) => void; color: string; ghost: boolean; midiAction?: any }> = ({ value, onChange, color, ghost, midiAction }) => {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => () => { clearTimeout(timer.current!); }, []);
  const show = () => { clearTimeout(timer.current!); setActive(true); };
  const hide = () => { timer.current = setTimeout(() => setActive(false), 600); };
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Knob value={value} min={-12} max={12} center={0} onChange={onChange} bipolar color={color} scale={0.8} ghost={ghost} onDragStart={show} onDragEnd={hide} midiAction={midiAction} />
      <span style={gainBadge(color, active, 'right')}>{Math.round(value)}</span>
    </div>
  );
};

// ── Mixer row icons (rounded, tiny) ─────────────────────────

const iconBox = {
  display: 'flex',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  width: 24,
  height: 24,
};

const IcGain: FC = () => (
  <div style={iconBox} title="Gain">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 4v16M8 8v8M4 11v2M16 8v8M20 11v2" stroke="var(--txt-secondary)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </div>
);

const IcHi: FC = () => (
  <div style={iconBox} title="High EQ">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M2 12c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0" stroke="var(--txt-secondary)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </div>
);

const IcMid: FC = () => (
  <div style={iconBox} title="Mid EQ">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M2 12c3-5 6-5 9 0s6 5 9 0" stroke="var(--txt-secondary)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </div>
);

const IcLow: FC = () => (
  <div style={iconBox} title="Low EQ">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M2 12c5-6 10-6 20 0" stroke="var(--txt-secondary)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </div>
);

const IcColor: FC = () => (
  <div style={iconBox} title="Color FX">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="9" r="4" stroke="var(--txt-secondary)" strokeWidth="2.5" />
      <circle cx="15" cy="9" r="4" stroke="var(--txt-secondary)" strokeWidth="2.5" />
      <circle cx="12" cy="15" r="4" stroke="var(--txt-secondary)" strokeWidth="2.5" />
    </svg>
  </div>
);

// ── Main Component ──────────────────────────────────────────

export const MixerSection: FC = () => {
  const crossfader = useMixiStore((s) => s.crossfader);
  const setCrossfader = useMixiStore((s) => s.setCrossfader);
  const onCrossfaderChange = useCallback((val: number) => setCrossfader(val), [setCrossfader]);

  const a = useDeckControls('A');
  const b = useDeckControls('B');

  return (
    <div className="flex flex-col items-center gap-2 mixi-mixer-glow px-3 py-3 h-full overflow-hidden">
      {/* ── LED Screen (top of mixer column) ─────────────────── */}
      <div
        className="mixi-led-screen w-full flex flex-col items-center justify-center shrink-0"
        style={{
          height: 64,
          borderRadius: 8,
          background: 'var(--srf-deep)',
          border: '1px solid var(--srf-mid)',
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.5)',
        }}
      >
        <MasterLedScreen />
      </div>

      {/* ── Channel strip panel — 3×9 CSS Grid ───────────────── */}
      <div
        className="w-full flex-1 min-h-0 rounded-lg overflow-hidden"
        style={{
          background: 'var(--srf-base)',
          border: '1px solid var(--srf-inset)',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5)',
        }}
      >
        <div
          className="w-full h-full"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            gridTemplateRows: 'auto auto auto 12px auto 12px auto 12px auto 12px auto 20px auto auto',
            justifyItems: 'center',
            alignItems: 'center',
            padding: '4px 12px 6px',
            gap: '0px',
          }}
        >
          {/* ── Row 1: MIXI brand (col 1–3) ───────────────────── */}
          <div style={{ gridColumn: '1 / -1', gridRow: 1, paddingBottom: 2 }}>
            <span className="mixi-brand-shimmer text-[8px] font-black tracking-[0.3em]">
              MIXI
            </span>
          </div>

          {/* ── Row 2: Deck labels ────────────────────────────── */}
          <span style={{ gridColumn: 1, gridRow: 2 }} className="text-[10px] font-bold tracking-widest" css-color={CYAN}>
            <span style={{ color: CYAN }}>A</span>
          </span>
          <div style={{ gridColumn: 2, gridRow: 2 }} />
          <span style={{ gridColumn: 3, gridRow: 2 }} className="text-[10px] font-bold tracking-widest">
            <span style={{ color: ORANGE }}>B</span>
          </span>

          {/* ── Row 3: GAIN (with band background) ───────────── */}
          <div className="mixi-eq-band" style={{ gridColumn: '1 / -1', gridRow: 3 }} />
          <div style={{ gridColumn: 1, gridRow: 3, zIndex: 1 }}>
            <GainCellA value={a.gain} onChange={a.onGainChange} color={CYAN} ghost={isGhost('A.gain')} midiAction={{ type: 'DECK_GAIN', deck: 'A' }} />
          </div>
          <div style={{ gridColumn: 2, gridRow: 3, zIndex: 1 }}><IcGain /></div>
          <div style={{ gridColumn: 3, gridRow: 3, zIndex: 1 }}>
            <GainCellB value={b.gain} onChange={b.onGainChange} color={ORANGE} ghost={isGhost('B.gain')} midiAction={{ type: 'DECK_GAIN', deck: 'B' }} />
          </div>

          {/* ── Row 5: HI (with EQ band background) ──────────── */}
          <div className="mixi-eq-band" style={{ gridColumn: '1 / -1', gridRow: 5 }} />
          <div style={{ gridColumn: 1, gridRow: 5, zIndex: 1 }}>
            <EqCellA value={a.eq.high} min={a.eqRange.min} max={a.eqRange.max} onChange={a.onEqChange('high')} color={CYAN} ghost={isGhost('A.eq.high')} killed={a.kills.high !== null} onKill={a.onKill('high')} midiAction={{ type: 'DECK_EQ_HIGH', deck: 'A' }} />
          </div>
          <div style={{ gridColumn: 2, gridRow: 5, zIndex: 1 }}><IcHi /></div>
          <div style={{ gridColumn: 3, gridRow: 5, zIndex: 1 }}>
            <EqCellB value={b.eq.high} min={b.eqRange.min} max={b.eqRange.max} onChange={b.onEqChange('high')} color={ORANGE} ghost={isGhost('B.eq.high')} killed={b.kills.high !== null} onKill={b.onKill('high')} midiAction={{ type: 'DECK_EQ_HIGH', deck: 'B' }} />
          </div>

          {/* ── Row 7: MID (with EQ band background) ─────────── */}
          <div className="mixi-eq-band" style={{ gridColumn: '1 / -1', gridRow: 7 }} />
          <div style={{ gridColumn: 1, gridRow: 7, zIndex: 1 }}>
            <EqCellA value={a.eq.mid} min={a.eqRange.min} max={a.eqRange.max} onChange={a.onEqChange('mid')} color={CYAN} ghost={isGhost('A.eq.mid')} killed={a.kills.mid !== null} onKill={a.onKill('mid')} midiAction={{ type: 'DECK_EQ_MID', deck: 'A' }} />
          </div>
          <div style={{ gridColumn: 2, gridRow: 7, zIndex: 1 }}><IcMid /></div>
          <div style={{ gridColumn: 3, gridRow: 7, zIndex: 1 }}>
            <EqCellB value={b.eq.mid} min={b.eqRange.min} max={b.eqRange.max} onChange={b.onEqChange('mid')} color={ORANGE} ghost={isGhost('B.eq.mid')} killed={b.kills.mid !== null} onKill={b.onKill('mid')} midiAction={{ type: 'DECK_EQ_MID', deck: 'B' }} />
          </div>

          {/* ── Row 9: LOW (with EQ band background) ─────────── */}
          <div className="mixi-eq-band" style={{ gridColumn: '1 / -1', gridRow: 9 }} />
          <div style={{ gridColumn: 1, gridRow: 9, zIndex: 1 }}>
            <EqCellA value={a.eq.low} min={a.eqRange.min} max={a.eqRange.max} onChange={a.onEqChange('low')} color={CYAN} ghost={isGhost('A.eq.low')} killed={a.kills.low !== null} onKill={a.onKill('low')} midiAction={{ type: 'DECK_EQ_LOW', deck: 'A' }} />
          </div>
          <div style={{ gridColumn: 2, gridRow: 9, zIndex: 1 }}><IcLow /></div>
          <div style={{ gridColumn: 3, gridRow: 9, zIndex: 1 }}>
            <EqCellB value={b.eq.low} min={b.eqRange.min} max={b.eqRange.max} onChange={b.onEqChange('low')} color={ORANGE} ghost={isGhost('B.eq.low')} killed={b.kills.low !== null} onKill={b.onKill('low')} midiAction={{ type: 'DECK_EQ_LOW', deck: 'B' }} />
          </div>

          {/* ── Row 11: COLOR (with EQ band background) ──────────── */}
          <div className="mixi-eq-band" style={{ gridColumn: '1 / -1', gridRow: 11 }} />
          <div style={{ gridColumn: 1, gridRow: 11, zIndex: 1 }}>
            <Knob value={a.colorFx} min={-1} max={1} center={0} onChange={a.onColorFxChange} bipolar color={CYAN} scale={0.8} ghost={isGhost('A.colorFx')} midiAction={{ type: 'DECK_FILTER', deck: 'A' }} />
          </div>
          <div style={{ gridColumn: 2, gridRow: 11, zIndex: 1 }}><IcColor /></div>
          <div style={{ gridColumn: 3, gridRow: 11, zIndex: 1 }}>
            <Knob value={b.colorFx} min={-1} max={1} center={0} onChange={b.onColorFxChange} bipolar color={ORANGE} scale={0.8} ghost={isGhost('B.colorFx')} midiAction={{ type: 'DECK_FILTER', deck: 'B' }} />
          </div>

          {/* ── Row 10: spacer (1fr absorbs remaining space) ── */}

          {/* ── Row 11: Faders + VU Meters ────────────────────── */}
          <div style={{ gridColumn: 1, gridRow: 13 }} className="flex flex-col items-center gap-1">
            <div className="flex items-end gap-1">
              <VuMeter deckId="A" />
              <Fader value={a.volume} min={0} max={1} onChange={a.onVolumeChange} orientation="vertical" length={140} color={CYAN} ghost={isGhost('A.volume')} midiAction={{ type: 'DECK_VOL', deck: 'A' }} />
            </div>
            <VolumeLcd value={a.volume} color={CYAN} />
          </div>
          <div style={{ gridColumn: 2, gridRow: '13 / 15' }} className="flex items-end">
            <MasterVuMeter />
          </div>
          <div style={{ gridColumn: 3, gridRow: 13 }} className="flex flex-col items-center gap-1">
            <div className="flex items-end gap-1">
              <Fader value={b.volume} min={0} max={1} onChange={b.onVolumeChange} orientation="vertical" length={140} color={ORANGE} ghost={isGhost('B.volume')} midiAction={{ type: 'DECK_VOL', deck: 'B' }} />
              <VuMeter deckId="B" />
            </div>
            <VolumeLcd value={b.volume} color={ORANGE} />
          </div>
        </div>
      </div>

      {/* ── Headphone strip ──────────────────────────────────── */}
      <HeadphoneStrip />

      {/* Crossfader */}
      <div className="mixi-crossfader-area w-full flex flex-col items-center gap-0 rounded-md bg-zinc-900/50 px-3 py-2 border border-zinc-800/40">
        <Fader value={crossfader} min={0} max={1} onChange={onCrossfaderChange} orientation="horizontal" length={260} color="#fff" ghost={isGhost('crossfader')} capSize={[40, 14]} midiAction={{ type: 'CROSSFADER' }} />
        <div className="flex w-full items-center justify-between px-1 mt-0.5">
          <span className="text-[11px] font-black" style={{ color: CYAN }}>A</span>
          <span className="text-[11px] font-black" style={{ color: ORANGE }}>B</span>
        </div>
      </div>

    </div>
  );
};

// ── Headphone Strip: [CUE_A] [MIX] [SPLIT] [VOL] [CUE_B] ──

const HeadphoneStrip: FC = () => {
  const cueA = useMixiStore((s) => s.decks.A.cueActive);
  const cueB = useMixiStore((s) => s.decks.B.cueActive);
  const toggleCueA = useMixiStore((s) => s.toggleCue);
  const hpMix = useMixiStore((s) => s.headphones.mix);
  const hpLevel = useMixiStore((s) => s.headphones.level);
  const splitMode = useMixiStore((s) => s.headphones.splitMode);
  const setHpMix = useMixiStore((s) => s.setHeadphoneMix);
  const setHpLevel = useMixiStore((s) => s.setHeadphoneLevel);
  const toggleSplit = useMixiStore((s) => s.toggleSplitMode);

  return (
    <div
      className="w-full flex items-center justify-center rounded-md bg-zinc-900/50 border border-zinc-800/40 px-2 py-1.5"
    >
      {/* CUE A */}
      <div className="flex-1 flex justify-center">
        <CueBtn active={cueA} color={CYAN} onClick={() => toggleCueA('A')} title="CUE A" />
      </div>
      <div className="w-px self-stretch bg-zinc-800/40" />
      {/* MIX */}
      <div className="flex-1 flex justify-center [&_span]:!text-[7px]">
        <Knob value={hpMix} min={0} max={1} onChange={setHpMix} color={COLOR_HP} scale={0.55} label="MIX" />
      </div>
      <div className="w-px self-stretch bg-zinc-800/40" />
      {/* SPLIT */}
      <div className="flex-1 flex justify-center">
        <SplitBtn active={splitMode} onClick={toggleSplit} />
      </div>
      <div className="w-px self-stretch bg-zinc-800/40" />
      {/* VOL */}
      <div className="flex-1 flex justify-center [&_span]:!text-[7px]">
        <Knob value={hpLevel} min={0} max={1} onChange={setHpLevel} color={COLOR_HP} scale={0.55} label="VOL" />
      </div>
      <div className="w-px self-stretch bg-zinc-800/40" />
      {/* CUE B */}
      <div className="flex-1 flex justify-center">
        <CueBtn active={cueB} color={ORANGE} onClick={() => toggleCueA('B')} title="CUE B" />
      </div>
    </div>
  );
};

const CueBtn: FC<{ active: boolean; color: string; onClick: () => void; title: string }> = ({ active, color, onClick, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="mixi-btn rounded-full flex items-center justify-center transition-all duration-150 shrink-0"
    style={{
      width: 26,
      height: 26,
      background: active ? 'var(--srf-mid)' : 'var(--srf-raised)',
      border: `1.5px solid ${active ? `${color}88` : 'var(--srf-light)'}`,
      boxShadow: active
        ? `inset 0 0 6px ${color}22, 0 0 4px ${color}33`
        : 'none',
    }}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      style={active ? { filter: `drop-shadow(0 0 3px ${color}88)` } : undefined}
    >
      <path d="M3 18v-6a9 9 0 0 1 18 0v6"
        stroke={active ? color : 'var(--txt-secondary)'} strokeWidth={active ? 2.5 : 1.5} strokeLinecap="round" fill="none" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z"
        stroke={active ? color : 'var(--txt-secondary)'} strokeWidth={active ? 2 : 1.5} fill={active ? color : 'none'} />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z"
        stroke={active ? color : 'var(--txt-secondary)'} strokeWidth={active ? 2 : 1.5} fill={active ? color : 'none'} />
    </svg>
  </button>
);

const SplitBtn: FC<{ active: boolean; onClick: () => void }> = ({ active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title="Split mode (L=CUE, R=Master)"
    className="mixi-btn rounded-full flex items-center justify-center transition-all duration-150 shrink-0"
    style={{
      width: 26,
      height: 26,
      background: active ? 'var(--srf-mid)' : 'var(--srf-raised)',
      border: `1.5px solid ${active ? `${COLOR_HP}66` : 'var(--srf-light)'}`,
      boxShadow: active ? `inset 0 0 6px ${COLOR_HP}22, 0 0 4px ${COLOR_HP}22` : 'none',
    }}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      style={active ? { filter: `drop-shadow(0 0 3px ${COLOR_HP}88)` } : undefined}
    >
      <line x1="12" y1="4" x2="12" y2="20" stroke={active ? COLOR_HP : 'var(--txt-secondary)'} strokeWidth={active ? 2 : 1.5} strokeLinecap="round" />
      <path d="M8 9L5 12L8 15" fill="none" stroke={active ? COLOR_HP : 'var(--txt-secondary)'} strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 9L19 12L16 15" fill="none" stroke={active ? COLOR_HP : 'var(--txt-secondary)'} strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
);
