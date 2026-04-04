/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – TurboKick Deck v2  ·  Single Synth Kick Machine
//
// Layout (top→bottom):
//   HEADER      status · deck · BPM · sync · eject
//   SEQUENCER   1×16 step grid
//   BODY        big trigger pad  |  synth + FX + LFO knobs
//   VALVES      dual valve strip (tube + punch)
//   TRANSPORT   play/stop · swing · MST vol · CLR · 4/4
// ─────────────────────────────────────────────────────────────

import {
  useCallback, useEffect, useRef, useState, type FC,
} from 'react';
import { TurboKickEngine } from './TurboKickEngine';
import {
  defaultFx, defaultValves, defaultSteps, defaultSynth,
  type FxKnobId, type ValveId, type TurboKickSnapshot,
} from './types';
import { Knob } from '../../components/controls/Knob';
import type { HouseDeckProps } from '../index';
import speakerImg from './TurboKick.jpg';

// ── Knob configs ────────────────────────────────────────────

/** Row 1 knobs: the big macros + FX. */
const ROW1_KNOBS: { id: FxKnobId; label: string; default: number; color: string }[] = [
  { id: 'thump',     label: 'THUMP', default: 0.5,  color: '#ef4444' },
  { id: 'tune',      label: 'TUNE',  default: 0.35, color: '#ef4444' },
  { id: 'filter',    label: 'FLT',   default: 0.75, color: '#f59e0b' },
  { id: 'resonance', label: 'RES',   default: 0,    color: '#f59e0b' },
  { id: 'delay',     label: 'DLY',   default: 0,    color: '#f59e0b' },
  { id: 'rumble',    label: 'RUMBLE', default: 0,    color: '#a855f7' },
];

/** Row 2 knobs: LFO + transport knobs. */
const ROW2_LFO: { id: FxKnobId; label: string; color: string }[] = [
  { id: 'lfoRate',   label: 'RATE',  color: '#22d3ee' },
  { id: 'lfoDepth',  label: 'DPTH',  color: '#22d3ee' },
];

const VALVE_DEFS: { id: ValveId; label: string; sub: string; color: string }[] = [
  { id: 'tubeA',  label: 'VALVE A', sub: 'TUBE',  color: '#f59e0b' },
  { id: 'punchB', label: 'VALVE B', sub: 'PUNCH', color: '#ef4444' },
];

// ── Main Component ──────────────────────────────────────────

export const TurboKickDeck: FC<HouseDeckProps> = ({
  deckId, color, onSwitchToTrack,
}) => {
  const engineRef = useRef<TurboKickEngine | null>(null);

  const [snap, setSnap] = useState<TurboKickSnapshot>(() => ({
    isPlaying: false,
    engaged: false,
    currentStep: -1,
    bpm: 170,
    syncToMaster: true,
    steps: defaultSteps(),
    synth: defaultSynth(),
    fx: defaultFx(),
    valves: defaultValves(),
    masterVolume: 0.8,
    swing: 0,
  }));

  const [padFlash, setPadFlash] = useState(false);
  /** 'beat' = normal quarter, 'down' = first beat of bar, null = off */
  const [beatFlash, setBeatFlash] = useState<'beat' | 'down' | null>(null);

  // ── Init engine ───────────────────────────────────────────

  useEffect(() => {
    const eng = new TurboKickEngine(deckId);
    eng.init();
    eng.onStepChange = (step) => setSnap((s) => ({ ...s, currentStep: step, engaged: eng.isEngaged }));
    eng.onKickTrigger = (step: number) => {
      setPadFlash(true);
      setTimeout(() => setPadFlash(false), 60);
      // Downbeat = step 0, beat = steps 4,8,12
      const isDownbeat = step === 0;
      setBeatFlash(isDownbeat ? 'down' : 'beat');
      setTimeout(() => setBeatFlash(null), isDownbeat ? 120 : 80);
    };
    engineRef.current = eng;
    setSnap({
      isPlaying: eng.isPlaying,
      engaged: eng.isEngaged,
      currentStep: eng.currentStep,
      bpm: eng.bpm,
      syncToMaster: eng.syncToMaster,
      steps: [...eng.steps],
      synth: eng.synthParams,
      fx: eng.fx,
      valves: eng.valves,
      masterVolume: eng.masterVolume,
      swing: eng.swing,
    });
    return () => { eng.destroy(); engineRef.current = null; };
  }, [deckId]);

  // ── Actions ───────────────────────────────────────────────

  const toggleEngage = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.isPlaying) eng.stop(); else eng.engage();
    setSnap((s) => ({ ...s, isPlaying: eng.isPlaying, engaged: eng.isEngaged }));
  }, []);

  const toggleStep = useCallback((step: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.toggleStep(step);
    setSnap((s) => ({ ...s, steps: [...eng.steps] }));
  }, []);

  const hitPad = useCallback(() => {
    engineRef.current?.hitPad(1.0);
    setPadFlash(true);
    setTimeout(() => setPadFlash(false), 80);
  }, []);

  const setFx = useCallback((id: FxKnobId, v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setFx(id, v);
    setSnap((s) => ({ ...s, fx: { ...s.fx, [id]: v } }));
  }, []);

  const setValve = useCallback((id: ValveId, v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setValve(id, v);
    setSnap((s) => ({ ...s, valves: { ...s.valves, [id]: v } }));
  }, []);

  const setMasterVol = useCallback((v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.masterVolume = v;
    setSnap((s) => ({ ...s, masterVolume: v }));
  }, []);

  const setSwing = useCallback((v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.swing = v;
    setSnap((s) => ({ ...s, swing: v }));
  }, []);

  const toggleSync = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.syncToMaster = !eng.syncToMaster;
    setSnap((s) => ({ ...s, syncToMaster: eng.syncToMaster, bpm: eng.bpm }));
  }, []);

  const clearPat = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.clearPattern();
    setSnap((s) => ({ ...s, steps: [...eng.steps] }));
  }, []);

  const resetPat = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.resetPattern();
    setSnap((s) => ({ ...s, steps: [...eng.steps] }));
  }, []);

  // ── BPM refresh ───────────────────────────────────────────

  useEffect(() => {
    if (!snap.syncToMaster) return;
    const timer = setInterval(() => {
      const eng = engineRef.current;
      if (eng) setSnap((s) => s.bpm === eng.bpm ? s : { ...s, bpm: eng.bpm });
    }, 500);
    return () => clearInterval(timer);
  }, [snap.syncToMaster]);

  // ── Derived ───────────────────────────────────────────────

  const { isPlaying, engaged, currentStep, bpm, syncToMaster, steps, fx, valves, masterVolume, swing } = snap;

  // ── Speaker pump intensity — driven by drive + valves ─────
  // Higher drive/valves = bigger physical cone excursion
  const pumpIntensity = Math.min(1, (fx.thump ?? 0.5) * 0.3 + valves.tubeA * 0.4 + valves.punchB * 0.4);
  // Base scale bump on flash: 1.04 (clean) → 1.14 (maxed out)
  const pumpScale = 1.04 + pumpIntensity * 0.10;
  // Slight Y stretch for "cone pushing toward you" effect
  const pumpScaleY = pumpScale + pumpIntensity * 0.03;

  // ── Shockwave state ────────────────────────────────────────
  const [shockwave, setShockwave] = useState(false);

  // Trigger shockwave on kick
  useEffect(() => {
    if (padFlash) {
      setShockwave(true);
      const t = setTimeout(() => setShockwave(false), 250);
      return () => clearTimeout(t);
    }
  }, [padFlash]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{
        background: 'var(--srf-base)',
        border: '1px solid var(--brd-subtle)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        borderRadius: 10,
      }}
    >
      {/* Strobo flash — entire deck flashes white on kick */}
      {padFlash && (
        <div className="absolute inset-0 pointer-events-none rounded-[10px] z-50" style={{ background: 'rgba(255,255,255,0.025)' }} />
      )}

      {/* HEADER — matches standard deck layout */}
      <div
        className="mixi-deck-header flex items-center gap-2 px-3 pt-2.5 pb-1 shrink-0 relative z-10"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${isPlaying ? 'mixi-dot-pulse' : ''}`}
          style={{ backgroundColor: isPlaying ? '#ef4444' : 'var(--txt-muted)', boxShadow: isPlaying ? '0 0 8px #ef4444' : 'none' }}
        />
        <span className="text-[10px] font-black tracking-[0.15em]" style={{ color }}>{deckId}</span>
        <span
          className="text-[7px] font-mono font-bold tracking-[0.25em] rounded px-1.5 py-0.5"
          style={{ background: 'var(--srf-raised)', border: '1px solid rgba(255,255,255,0.06)', color: '#ef4444' }}
        >
          TURBOKICK
        </span>
        {engaged && (
          <span className="text-[6px] font-mono font-bold tracking-wider animate-pulse" style={{ color: '#f59e0b' }}>ENGAGE...</span>
        )}
        <div
          className="flex items-baseline gap-0.5 rounded px-2 py-0.5 ml-1"
          style={{ background: 'var(--srf-deep)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span className="text-sm font-mono font-black" style={{ color: 'var(--txt-white)', fontFeatureSettings: '"tnum"' }}>
            {bpm > 0 ? bpm.toFixed(1) : '---.-'}
          </span>
          <span className="text-[6px] font-mono font-bold ml-0.5" style={{ color: 'var(--txt-muted)' }}>BPM</span>
        </div>
        <button
          type="button"
          onClick={toggleSync}
          className="text-[7px] font-mono font-bold tracking-wider rounded px-1.5 py-0.5 transition-all mixi-btn"
          style={{
            background: syncToMaster ? `${color}14` : 'transparent',
            border: `1px solid ${syncToMaster ? color + '44' : 'rgba(255,255,255,0.08)'}`,
            color: syncToMaster ? color : 'var(--txt-muted)',
          }}
        >
          {syncToMaster ? 'SYNC' : 'FREE'}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => { engineRef.current?.stop(); onSwitchToTrack(); }}
          className="rounded p-1 transition-colors mixi-btn"
          style={{ color: 'var(--txt-muted)' }}
          title="Back to Track Deck"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5,18 12,6 19,18" />
            <line x1="5" y1="22" x2="19" y2="22" />
          </svg>
        </button>
      </div>

      {/* ── BODY ─────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative z-10">

        {/* ── KNOBS — rack plate rows ────────────────────────── */}
        <div className="shrink-0 flex flex-col gap-1 px-2 py-2">
          {/* Plate 1: THUMP · FLT · RES · DLY · RUMBLE */}
          <div
            className="flex items-end justify-around gap-2 px-2 py-2 rounded"
            style={{ background: 'var(--srf-mid)', borderTop: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)' }}
          >
            {ROW1_KNOBS.map((k) => (
              <div key={k.id} className="flex flex-col items-center gap-0.5">
                <Knob value={fx[k.id]} min={0} max={1} onChange={(v) => setFx(k.id, v)} color={k.color} scale={0.75} defaultValue={k.default} />
                <span
                  className="text-[5px] font-mono font-bold tracking-[0.15em] uppercase"
                  style={{
                    color: k.id === 'thump' || k.id === 'rumble' ? k.color : 'var(--txt-secondary)',
                    textShadow: k.id === 'thump' || k.id === 'rumble' ? `0 0 4px ${k.color}44` : 'none',
                  }}
                >{k.label}</span>
              </div>
            ))}
          </div>
          {/* Plate 2: LFO · SWG · MST · CLR · 4/4 */}
          <div
            className="flex items-end justify-around gap-2 px-2 py-2 rounded"
            style={{ background: 'var(--srf-mid)', borderTop: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)' }}
          >
            {ROW2_LFO.map((k) => (
              <div key={k.id} className="flex flex-col items-center gap-0.5">
                <Knob value={fx[k.id]} min={0} max={1} onChange={(v) => setFx(k.id, v)} color={k.color} scale={0.75} defaultValue={0} />
                <span className="text-[5px] font-mono font-bold tracking-[0.15em]" style={{ color: 'var(--txt-secondary)' }}>{k.label}</span>
              </div>
            ))}
            <div className="h-7 border-r" style={{ borderColor: 'var(--brd-subtle)' }} />
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={swing} min={0} max={0.5} onChange={setSwing} color="var(--txt-secondary)" scale={0.75} defaultValue={0} />
              <span className="text-[5px] font-mono font-bold tracking-[0.15em]" style={{ color: 'var(--txt-secondary)' }}>SWG</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={masterVolume} min={0} max={1} onChange={setMasterVol} color="#ef4444" scale={0.75} defaultValue={0.8} />
              <span className="text-[5px] font-mono font-bold tracking-[0.15em]" style={{ color: 'var(--txt-secondary)' }}>MST</span>
            </div>
            <div className="h-7 border-r" style={{ borderColor: 'var(--brd-subtle)' }} />
            <div className="flex gap-1 self-center">
              <button type="button" onClick={clearPat} className="mixi-btn text-[6px] font-mono font-bold tracking-wider rounded px-2 py-1 transition-all" style={{ background: 'var(--srf-raised)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.02)', color: 'var(--txt-secondary)' }}>CLR</button>
              <button type="button" onClick={resetPat} className="mixi-btn text-[6px] font-mono font-bold tracking-wider rounded px-2 py-1 transition-all" style={{ background: 'var(--srf-raised)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.02)', color: '#ef4444' }}>4/4</button>
            </div>
          </div>
        </div>

        {/* ── SEQUENCER — recessed, 4-beat groups, taller pads ── */}
        <div
          className="shrink-0 mx-2 mb-1 px-1 py-1 rounded-md"
          style={{ background: 'var(--srf-deep)', boxShadow: 'inset 0 2px 8px #000' }}
        >
          <div className="flex flex-1 min-w-0">
            {steps.map((on, i) => {
              const isCurrent = i === currentStep;
              const groupGap = i > 0 && i % 4 === 0;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleStep(i)}
                  className="flex-1 rounded mixi-pad transition-all duration-75"
                  style={{
                    height: 32,
                    marginLeft: groupGap ? 5 : 1,
                    background: on
                      ? '#ff0044'
                      : 'var(--srf-raised)',
                    border: 'none',
                    boxShadow: on
                      ? (isCurrent
                        ? 'inset 0 0 12px rgba(255,255,255,0.6), 0 0 18px #ff0044, 0 0 4px #ff0044'
                        : 'inset 0 0 8px rgba(255,255,255,0.3), 0 0 10px #ff004466')
                      : 'inset 0 1px 2px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.02)',
                    // Playhead — bright white top border
                    borderTop: isCurrent ? '2px solid #fff' : '2px solid transparent',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* ── SPEAKER — recessed + shockwave + blend-mode ─── */}
        <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0 relative">

          {/* Beat-flash glow circle — behind speaker */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              width: '70%',
              maxWidth: 320,
              aspectRatio: '1',
              background: beatFlash === 'down'
                ? 'radial-gradient(circle, rgba(255,255,255,0.2) 0%, rgba(255,200,0,0.08) 35%, transparent 65%)'
                : beatFlash === 'beat'
                  ? 'radial-gradient(circle, rgba(255,200,0,0.12) 0%, rgba(255,150,0,0.04) 35%, transparent 60%)'
                  : 'transparent',
              boxShadow: beatFlash === 'down'
                ? '0 0 50px rgba(255,255,255,0.15), 0 0 100px rgba(255,200,0,0.08)'
                : beatFlash === 'beat'
                  ? '0 0 30px rgba(255,200,0,0.1)'
                  : 'none',
              transition: beatFlash ? 'none' : 'background 0.12s ease-out, box-shadow 0.12s ease-out',
            }}
          />

          {/* Speaker recess — machined metal bezel */}
          <div
            className="absolute rounded-full"
            style={{
              width: '66%',
              maxWidth: 300,
              aspectRatio: '1',
              background: 'radial-gradient(circle, #070707 58%, #0e0e0e 76%, #151515 80%, #0e0e0e 84%, #080808 100%)',
              border: '1px solid rgba(255,255,255,0.04)',
              boxShadow: `
                inset 0 8px 25px rgba(0,0,0,1),
                inset 0 -3px 10px rgba(0,0,0,0.5),
                inset 0 0 0 4px rgba(0,0,0,0.8),
                0 0 0 1px rgba(255,255,255,0.03),
                0 4px 20px rgba(0,0,0,0.6)
              `,
            }}
          />

          {/* Shockwave ring — expands and fades */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              width: '55%',
              maxWidth: 240,
              aspectRatio: '1',
              border: '2px solid rgba(255,255,255,0.3)',
              opacity: shockwave ? 0.4 : 0,
              transform: shockwave ? 'scale(1.6)' : 'scale(1)',
              transition: shockwave ? 'transform 0.25s ease-out, opacity 0.25s ease-out' : 'none',
            }}
          />

          {/* Speaker image — screen blend to remove black bg */}
          <button
            type="button"
            onPointerDown={hitPad}
            className="relative rounded-full overflow-hidden active:scale-[0.97] select-none z-10"
            style={{
              width: '55%',
              maxWidth: 240,
              aspectRatio: '1',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              filter: padFlash ? 'brightness(1.5) drop-shadow(0 0 15px rgba(255,100,0,0.4))' : 'brightness(0.9)',
              transition: 'filter 0.06s ease-out',
            }}
          >
            <img
              src={speakerImg}
              alt="Kick"
              className="w-full h-full object-contain pointer-events-none"
              style={{
                mixBlendMode: 'screen',
                transform: padFlash ? `scale(${pumpScale}, ${pumpScaleY})` : 'scale(1)',
                transition: 'transform 0.06s ease-out',
              }}
            />
          </button>

        </div>

        {/* ── VALVES — rack plate style ──────────────────────── */}
        <div
          className="shrink-0 flex items-center gap-0 mx-2 mb-2 rounded"
          style={{
            background: 'var(--srf-mid)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
          }}
        >
          {VALVE_DEFS.map((v, idx) => {
            const val = valves[v.id];
            return (
              <div
                key={v.id}
                className="flex-1 flex items-center gap-3 px-3 py-3"
                style={idx === 0 ? { borderRight: '1px solid rgba(255,255,255,0.04)' } : {}}
              >
                {/* Valve icon */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0">
                  <circle cx="12" cy="12" r="9" stroke={v.color} strokeWidth="1.5" strokeOpacity={0.4} />
                  <path d="M8 15 C8 11, 12 9, 12 6 C12 9, 16 11, 16 15" stroke={v.color} strokeWidth="1.5" strokeLinecap="round" strokeOpacity={0.6} />
                  <circle cx="12" cy="16" r="2" fill={v.color} fillOpacity={0.3} />
                </svg>
                <Knob value={val} min={0} max={1} onChange={(x) => setValve(v.id, x)} color={v.color} scale={0.6} defaultValue={0} />
                {/* Big LED */}
                <div
                  className="shrink-0 rounded-full transition-all duration-150"
                  style={{
                    width: 18,
                    height: 18,
                    background: val > 0.01
                      ? `radial-gradient(circle, ${v.color} 0%, ${v.color}44 60%, transparent 100%)`
                      : `radial-gradient(circle, ${v.color}15 0%, transparent 70%)`,
                    border: `1.5px solid ${val > 0.01 ? v.color + '88' : v.color + '20'}`,
                    boxShadow: val > 0.3 ? `0 0 ${8 + val * 14}px ${v.color}${Math.round(val * 200).toString(16).padStart(2, '0')}` : 'none',
                    opacity: 0.3 + val * 0.7,
                  }}
                />
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-100"
                    style={{
                      width: `${val * 100}%`,
                      background: `linear-gradient(90deg, ${v.color}44, ${v.color})`,
                      boxShadow: val > 0.5 ? `0 0 6px ${v.color}88` : 'none',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── ENGAGE BAR — full width, 80s TURBO style ────── */}
        <button
          type="button"
          onClick={toggleEngage}
          className="shrink-0 mx-2 mb-2 rounded transition-all duration-100 mixi-btn flex items-center justify-center"
          style={{
            height: 44,
            borderRadius: 4,
            background: isPlaying
              ? 'linear-gradient(180deg, var(--srf-mid) 0%, var(--srf-base) 100%)'
              : 'linear-gradient(180deg, var(--srf-raised) 0%, var(--srf-base) 100%)',
            border: isPlaying ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(255,255,255,0.08)',
            boxShadow: isPlaying
              ? 'inset 0 2px 4px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.01)'
              : 'inset 0 1px 2px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.02)',
          }}
        >
          <span
            className="font-mono font-black uppercase select-none"
            style={{
              fontSize: 16,
              color: isPlaying ? 'var(--txt-dim)' : 'var(--txt-secondary)',
              textShadow: isPlaying
                ? 'inset 0 1px 0 rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.04)'
                : '0 1px 2px rgba(0,0,0,0.5)',
              letterSpacing: '0.4em',
            }}
          >
            {isPlaying ? 'STOP' : 'PLAY'}
          </span>
        </button>

      </div>
    </div>
  );
};
