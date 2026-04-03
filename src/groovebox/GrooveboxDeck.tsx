/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Groovebox Deck  ·  Aerospace UI
//
// Layout (top→bottom):
//   HEADER      status · deck · BPM · sync · eject
//   SEQUENCER   4×16 step grid · M/S per voice
//   CH-STRIP    vertical fader + pan knob per voice + master
//   PADS        4×4 MPC trigger pads  |  2×4 303-style FX pads
//   TRANSPORT   play/stop · swing · clear · 4/4
// ─────────────────────────────────────────────────────────────

import {
  useCallback, useEffect, useRef, useState, type FC,
} from 'react';
import { GrooveboxEngine } from './GrooveboxEngine';
import {
  VOICES, defaultVoiceMixer, fourOnFloorPattern,
  type VoiceId, type GrooveboxSnapshot,
} from './types';
import { Knob } from '../components/controls/Knob';
import { Fader } from '../components/controls/Fader';
import { useSampleNames } from '../hooks/useSampleNames';
import { SampleManager } from '../audio/SampleManager';
import type { DeckId } from '../types';

// ── Voice config (hex colors for alpha variants) ─────────────

const VOICE_LABELS: Record<VoiceId, string> = {
  kick: 'KCK', snare: 'SNR', hat: 'HAT', perc: 'PRC',
};

/** Hex colors so we can append 2-char alpha suffixes inline. */
const VOICE_COLORS: Record<VoiceId, string> = {
  kick:  '#ef4444',
  snare: '#f59e0b',
  hat:   '#22d3ee',
  perc:  '#a855f7',
};

// ── MPC velocity tiers (ghost → accent) ─────────────────────

const MPC_VELOCITIES = [0.3, 0.5, 0.75, 1.0] as const;
const MPC_VEL_LABELS = ['GHO', 'SFT', 'MED', 'ACC'] as const;
const MPC_BG = ['14', '1f', '2e', '40'] as const;
const MPC_BD = ['1a', '28', '38', '55'] as const;

// ── 303-style FX pads ────────────────────────────────────────

type FxId = 'lpf' | 'hpf' | 'delay' | 'reverb' | 'gate' | 'distort' | 'flanger' | 'stutter';

interface FxPadDef { id: FxId; label: string; color: string; }

const FX_PADS: FxPadDef[] = [
  { id: 'lpf',     label: 'LPF',   color: '#00d4aa' },
  { id: 'hpf',     label: 'HPF',   color: '#00aaff' },
  { id: 'delay',   label: 'DLY',   color: '#7755ff' },
  { id: 'reverb',  label: 'RVB',   color: '#cc44ff' },
  { id: 'gate',    label: 'GATE',  color: '#ff8800' },
  { id: 'distort', label: 'DIST',  color: '#ff3355' },
  { id: 'flanger', label: 'FLG',   color: '#22cc77' },
  { id: 'stutter', label: 'STT',   color: '#ffcc00' },
];

// ── Props ────────────────────────────────────────────────────

interface GrooveboxDeckProps {
  deckId: DeckId;
  color: string;
  onSwitchToTrack: () => void;
}

// ── SequencerRow ─────────────────────────────────────────────

interface SeqRowProps {
  voice: VoiceId; steps: boolean[]; currentStep: number;
  color: string; dimmed: boolean; muted: boolean; soloed: boolean;
  sampleName?: string;
  onDropSample: (file: File) => void;
  onToggleStep: (step: number) => void;
  onToggleMute: () => void; onToggleSolo: () => void;
}

const SequencerRow: FC<SeqRowProps> = ({
  voice, steps, currentStep, color, dimmed, muted, soloed, sampleName,
  onDropSample, onToggleStep, onToggleMute, onToggleSolo,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
  <div
    className="flex items-center gap-1 transition-opacity relative"
    style={{ opacity: dimmed ? 0.22 : 1, marginBottom: 4 }}
    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
    onDragLeave={() => setIsDragOver(false)}
    onDrop={(e) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('audio/')) {
        onDropSample(file);
      }
    }}
  >
    {isDragOver && (
      <div className="absolute inset-0 z-10 bg-white/10 rounded flex items-center justify-center border border-dashed border-white/50 backdrop-blur-sm pointer-events-none">
        <span className="text-[10px] font-bold text-white tracking-widest drop-shadow-md">DROP AUDIO</span>
      </div>
    )}
    <div className="flex flex-col items-end shrink-0" style={{ width: 28, marginRight: 2 }}>
      <span
        className="text-[7px] font-mono font-black tracking-wider leading-none"
        style={{ color }}
      >
        {VOICE_LABELS[voice]}
      </span>
      {sampleName && (
        <span className="text-[5px] text-zinc-500 font-mono truncate max-w-full block leading-none mt-[2px]" title={sampleName}>
          {sampleName.substring(0, 5)}
        </span>
      )}
    </div>

    <div className="flex gap-[2px] flex-1 min-w-0">
      {steps.map((on, i) => {
        const isCurrent = i === currentStep;
        const isBar    = i % 8 === 0;
        const isBeat   = i % 4 === 0;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onToggleStep(i)}
            className="flex-1 rounded-[2px] transition-all duration-75 active:scale-90"
            style={{
              aspectRatio: '1',
              maxHeight: 20,
              background: on
                ? (isCurrent ? color : `${color}99`)
                : (isCurrent ? 'rgba(255,255,255,0.22)'
                  : isBar  ? 'rgba(255,255,255,0.07)'
                  : isBeat ? 'rgba(255,255,255,0.05)'
                  :          'rgba(255,255,255,0.03)'),
              border: `1px solid ${on
                ? (isCurrent ? color : `${color}44`)
                : (isCurrent ? 'rgba(255,255,255,0.30)'
                  : isBar    ? 'rgba(255,255,255,0.12)'
                  :            'rgba(255,255,255,0.05)')}`,
              boxShadow: on && isCurrent ? `0 0 6px ${color}77` : 'none',
            }}
          />
        );
      })}
    </div>

    <button
      type="button"
      onClick={onToggleMute}
      className="text-[6px] font-mono font-bold rounded shrink-0 transition-all active:scale-95"
      style={{
        width: 14, height: 14,
        background: muted ? 'rgba(239,68,68,0.22)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${muted ? '#ef444488' : 'rgba(255,255,255,0.10)'}`,
        color: muted ? '#ef4444' : 'rgba(255,255,255,0.25)',
      }}
    >M</button>

    <button
      type="button"
      onClick={onToggleSolo}
      className="text-[6px] font-mono font-bold rounded shrink-0 transition-all active:scale-95"
      style={{
        width: 14, height: 14,
        background: soloed ? 'rgba(251,191,36,0.22)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${soloed ? '#fbbf2488' : 'rgba(255,255,255,0.10)'}`,
        color: soloed ? '#fbbf24' : 'rgba(255,255,255,0.25)',
      }}
    >S</button>
  </div>
  );
};

// ── ChannelFaderStrip ────────────────────────────────────────

interface ChannelFaderStripProps {
  label: string; value: number; onChange: (v: number) => void; color: string;
  pan?: number; onPanChange?: (v: number) => void;
  isMaster?: boolean;
}

const ChannelFaderStrip: FC<ChannelFaderStripProps> = ({
  label, value, onChange, color, pan, onPanChange, isMaster = false,
}) => (
  <div className="flex flex-col items-center gap-0.5">
    <span
      className="text-[6px] font-mono font-bold tracking-wider mb-0.5"
      style={{ color: isMaster ? color : 'rgba(255,255,255,0.35)' }}
    >
      {label}
    </span>
    <Fader
      value={value}
      min={0}
      max={1}
      onChange={onChange}
      orientation="vertical"
      length={52}
      color={color}
      capSize={[22, 13]}
    />
    {onPanChange != null && pan != null ? (
      <Knob
        value={pan}
        min={-1}
        max={1}
        onChange={onPanChange}
        color={color}
        scale={0.38}
        defaultValue={0}
        bipolar
      />
    ) : (
      <div style={{ height: 20 }} />
    )}
  </div>
);

// ── Main Component ────────────────────────────────────────────

export const GrooveboxDeck: FC<GrooveboxDeckProps> = ({
  deckId, color, onSwitchToTrack,
}) => {
  const engineRef = useRef<GrooveboxEngine | null>(null);
  const sampleNames = useSampleNames();

  const [snapshot, setSnapshot] = useState<GrooveboxSnapshot>(() => ({
    isPlaying: false,
    currentStep: -1,
    bpm: 128,
    syncToMaster: true,
    pattern: fourOnFloorPattern(),
    mixer: defaultVoiceMixer(),
    masterVolume: 0.8,
    swing: 0,
  }));

  const [activeFx,    setActiveFx]    = useState<Set<FxId>>(new Set());
  const [flashedPads, setFlashedPads] = useState<Set<string>>(new Set());

  // ── Init engine ───────────────────────────────────────────

  useEffect(() => {
    const eng = new GrooveboxEngine(deckId);
    eng.init();
    eng.onStepChange = (step) => setSnapshot((s) => ({ ...s, currentStep: step }));
    engineRef.current = eng;
    setSnapshot({
      isPlaying:    eng.isPlaying,
      currentStep:  eng.currentStep,
      bpm:          eng.bpm,
      syncToMaster: eng.syncToMaster,
      pattern:      eng.pattern,
      mixer:        eng.mixer,
      masterVolume: eng.masterVolume,
      swing:        eng.swing,
    });
    return () => { eng.destroy(); engineRef.current = null; };
  }, [deckId]);

  // ── Actions ───────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.isPlaying) eng.stop(); else eng.play();
    setSnapshot((s) => ({ ...s, isPlaying: eng.isPlaying }));
  }, []);

  const toggleStep = useCallback((voice: VoiceId, step: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.toggleStep(voice, step);
    setSnapshot((s) => ({
      ...s,
      pattern: {
        ...s.pattern,
        [voice]: { ...s.pattern[voice], steps: [...eng.pattern[voice].steps] },
      },
    }));
  }, []);

  const setVoiceVol = useCallback((voice: VoiceId, vol: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setVoiceVolume(voice, vol);
    setSnapshot((s) => ({
      ...s,
      pattern: {
        ...s.pattern,
        [voice]: { ...s.pattern[voice], volume: vol },
      },
    }));
  }, []);

  const setMasterVol = useCallback((v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.masterVolume = v;
    setSnapshot((s) => ({ ...s, masterVolume: v }));
  }, []);

  const setSwing = useCallback((v: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.swing = v;
    setSnapshot((s) => ({ ...s, swing: v }));
  }, []);

  const toggleSync = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.syncToMaster = !eng.syncToMaster;
    setSnapshot((s) => ({ ...s, syncToMaster: eng.syncToMaster, bpm: eng.bpm }));
  }, []);

  const setVoicePan = useCallback((voice: VoiceId, pan: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setVoicePan(voice, pan);
    setSnapshot((s) => ({
      ...s,
      mixer: { ...s.mixer, [voice]: { ...s.mixer[voice], pan } },
    }));
  }, []);

  const toggleMute = useCallback((voice: VoiceId) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.toggleVoiceMute(voice);
    setSnapshot((s) => ({ ...s, mixer: eng.mixer }));
  }, []);

  const toggleSolo = useCallback((voice: VoiceId) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.toggleVoiceSolo(voice);
    setSnapshot((s) => ({ ...s, mixer: eng.mixer }));
  }, []);

  const clearPat = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.clearPattern();
    setSnapshot((s) => ({ ...s, pattern: eng.pattern }));
  }, []);

  const resetPat = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.resetPattern();
    setSnapshot((s) => ({ ...s, pattern: eng.pattern }));
  }, []);

  const hitVoice = useCallback((voice: VoiceId, velocity: number) => {
    engineRef.current?.hitVoiceNow(voice, velocity);
    const key = `${voice}-${velocity}`;
    setFlashedPads((s) => new Set([...s, key]));
    setTimeout(() => setFlashedPads((s) => { const n = new Set(s); n.delete(key); return n; }), 100);
  }, []);

  useEffect(() => {
    const onMidiPadHit = (e: any) => {
      const { deck, voice, velocity } = e.detail;
      if (deck === deckId) {
        hitVoice(voice, velocity);
      }
    };
    window.addEventListener('MIXIMIDI_GROOVEBOX_PAD', onMidiPadHit);
    return () => window.removeEventListener('MIXIMIDI_GROOVEBOX_PAD', onMidiPadHit);
  }, [deckId, hitVoice]);

  const toggleFx = useCallback((id: FxId) => {
    setActiveFx((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  // ── BPM refresh ───────────────────────────────────────────

  useEffect(() => {
    if (!snapshot.syncToMaster) return;
    const timer = setInterval(() => {
      const eng = engineRef.current;
      if (eng) setSnapshot((s) => s.bpm === eng.bpm ? s : { ...s, bpm: eng.bpm });
    }, 500);
    return () => clearInterval(timer);
  }, [snapshot.syncToMaster]);

  // ── Derived ───────────────────────────────────────────────

  const { pattern, mixer, currentStep, isPlaying, bpm, syncToMaster, masterVolume, swing } = snapshot;

  const isVoiceDimmed = (v: VoiceId) =>
    mixer[v].mute || (VOICES.some((x) => mixer[x].solo) && !mixer[v].solo);

  // ── Render ────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #000d1f 0%, #000510 100%)',
        border: `1px solid ${color}28`,
        boxShadow: `0 0 48px ${color}08, inset 0 1px 0 rgba(255,255,255,0.04)`,
        borderRadius: 10,
      }}
    >
      {/* HEADER */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{
          borderBottom: `1px solid ${color}18`,
          background: `linear-gradient(180deg, ${color}07 0%, transparent 100%)`,
        }}
      >
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${isPlaying ? 'mixi-dot-pulse' : ''}`}
          style={{ backgroundColor: isPlaying ? color : '#3f3f46', boxShadow: isPlaying ? `0 0 8px ${color}cc` : 'none' }}
        />
        <span className="text-[10px] font-black tracking-[0.2em]" style={{ color }}>{deckId}</span>
        <span
          className="text-[7px] font-mono font-bold tracking-[0.25em] rounded px-1.5 py-0.5"
          style={{ background: `${color}10`, border: `1px solid ${color}28`, color }}
        >
          GROOVEBOX
        </span>
        <div
          className="flex items-baseline gap-0.5 rounded px-2 py-0.5 ml-1"
          style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span className="text-sm font-mono font-black" style={{ color: 'var(--txt-white)', fontFeatureSettings: '"tnum"' }}>
            {bpm > 0 ? bpm.toFixed(1) : '---.-'}
          </span>
          <span className="text-[6px] font-mono font-bold ml-0.5" style={{ color: '#52525b' }}>BPM</span>
        </div>
        <button
          type="button"
          onClick={toggleSync}
          className="text-[7px] font-mono font-bold tracking-wider rounded px-1.5 py-0.5 transition-all"
          style={{
            background: syncToMaster ? `${color}14` : 'transparent',
            border: `1px solid ${syncToMaster ? color + '44' : 'rgba(255,255,255,0.08)'}`,
            color: syncToMaster ? color : '#52525b',
          }}
        >
          {syncToMaster ? 'SYNC' : 'FREE'}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => { engineRef.current?.stop(); onSwitchToTrack(); }}
          className="rounded p-1 transition-colors"
          style={{ color: '#52525b' }}
          title="Back to Track Deck"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5,18 12,6 19,18" />
            <line x1="5" y1="22" x2="19" y2="22" />
          </svg>
        </button>
      </div>

      {/* BODY */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

        {/* SEQUENCER */}
        <div
          className="shrink-0 px-3 pt-2 pb-1.5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          {VOICES.map((voice) => (
            <SequencerRow
              key={voice}
              voice={voice}
              sampleName={sampleNames[voice]}
              onDropSample={(file) => SampleManager.getInstance().importFile(voice, file)}
              steps={pattern[voice].steps}
              currentStep={isPlaying ? currentStep : -1}
              color={VOICE_COLORS[voice]}
              dimmed={isVoiceDimmed(voice)}
              muted={mixer[voice].mute}
              soloed={mixer[voice].solo}
              onToggleStep={(step) => toggleStep(voice, step)}
              onToggleMute={() => toggleMute(voice)}
              onToggleSolo={() => toggleSolo(voice)}
            />
          ))}
        </div>

        {/* CHANNEL STRIP */}
        <div
          className="shrink-0 flex items-end justify-around px-4 pt-2 pb-2 gap-2"
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: 'rgba(0,0,0,0.25)',
          }}
        >
          {VOICES.map((voice) => (
            <ChannelFaderStrip
              key={voice}
              label={VOICE_LABELS[voice]}
              value={pattern[voice].volume}
              onChange={(v) => setVoiceVol(voice, v)}
              color={VOICE_COLORS[voice]}
              pan={mixer[voice].pan}
              onPanChange={(v) => setVoicePan(voice, v)}
            />
          ))}
          <div style={{ width: 1, height: 60, background: 'rgba(255,255,255,0.06)', alignSelf: 'center' }} />
          <ChannelFaderStrip
            label="MST"
            value={masterVolume}
            onChange={setMasterVol}
            color={color}
            isMaster
          />
        </div>

        {/* PADS */}
        <div className="flex flex-1 min-h-0">

          {/* MPC 4x4 */}
          <div
            className="flex-1 flex flex-col p-2 min-w-0"
            style={{ borderRight: '1px solid rgba(255,255,255,0.04)' }}
          >
            <div className="flex gap-[2px] mb-1 shrink-0">
              <div style={{ width: 26 }} />
              {MPC_VEL_LABELS.map((l) => (
                <span
                  key={l}
                  className="flex-1 text-center text-[5px] font-mono font-bold tracking-wider"
                  style={{ color: 'rgba(255,255,255,0.18)' }}
                >
                  {l}
                </span>
              ))}
            </div>

            <div className="flex flex-col flex-1 gap-[3px] min-h-0">
              {VOICES.map((voice) => (
                <div key={voice} className="flex-1 flex items-stretch gap-[3px] min-h-0">
                  <span
                    className="text-[6px] font-mono font-black shrink-0 self-center"
                    style={{ color: VOICE_COLORS[voice], width: 26, textAlign: 'right', paddingRight: 4 }}
                  >
                    {VOICE_LABELS[voice]}
                  </span>
                  {MPC_VELOCITIES.map((vel, colIdx) => {
                    const padKey = `${voice}-${vel}`;
                    const isFlash = flashedPads.has(padKey);
                    const vc = VOICE_COLORS[voice];
                    return (
                      <button
                        key={padKey}
                        type="button"
                        onPointerDown={() => hitVoice(voice, vel)}
                        className="flex-1 rounded-[4px] transition-all duration-75 active:scale-95 min-h-0"
                        style={{
                          background: isFlash ? vc : `${vc}${MPC_BG[colIdx]}`,
                          border:     `1px solid ${isFlash ? vc : `${vc}${MPC_BD[colIdx]}`}`,
                          boxShadow:  isFlash ? `0 0 16px ${vc}cc` : 'none',
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* 303 FX Pads 2x4 */}
          <div className="flex flex-col p-2 shrink-0" style={{ width: 120 }}>
            <span
              className="text-[5px] font-mono font-bold tracking-[0.4em] block mb-1 shrink-0"
              style={{ color: 'rgba(255,255,255,0.18)' }}
            >
              303 FX
            </span>
            <div
              className="flex-1 grid grid-cols-2 min-h-0 gap-[3px]"
              style={{ gridAutoRows: '1fr' }}
            >
              {FX_PADS.map((fx) => {
                const isActive = activeFx.has(fx.id);
                return (
                  <button
                    key={fx.id}
                    type="button"
                    onClick={() => toggleFx(fx.id)}
                    className="rounded-[4px] flex items-center justify-center transition-all duration-100 active:scale-95 min-h-0"
                    style={{
                      background: isActive ? `${fx.color}22` : 'rgba(255,255,255,0.025)',
                      border: `1px solid ${isActive ? fx.color + '55' : 'rgba(255,255,255,0.07)'}`,
                      boxShadow: isActive ? `0 0 10px ${fx.color}44, inset 0 0 6px ${fx.color}11` : 'none',
                    }}
                  >
                    <span
                      className="text-[6px] font-mono font-black tracking-wider leading-none"
                      style={{ color: isActive ? fx.color : 'rgba(255,255,255,0.20)' }}
                    >
                      {fx.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* TRANSPORT */}
        <div
          className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.04)',
            background: `linear-gradient(0deg, ${color}05 0%, transparent 100%)`,
          }}
        >
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-full flex items-center justify-center transition-all active:scale-95 shrink-0"
            style={{
              width: 38, height: 38,
              background: isPlaying
                ? `radial-gradient(circle, ${color}44, ${color}18)`
                : 'radial-gradient(circle, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
              border: `2px solid ${isPlaying ? color : 'rgba(255,255,255,0.12)'}`,
              boxShadow: isPlaying ? `0 0 18px ${color}55` : 'none',
            }}
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill={color}>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,255,255,0.75)">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            )}
          </button>

          <div className="flex flex-col items-center gap-0.5">
            <Knob
              value={swing}
              min={0}
              max={0.5}
              onChange={setSwing}
              color="var(--txt-secondary)"
              scale={0.75}
              defaultValue={0}
            />
            <span className="text-[6px] font-mono font-bold tracking-wider" style={{ color: '#52525b' }}>SWG</span>
          </div>

          <span className="flex-1" />

          <button
            type="button"
            onClick={clearPat}
            className="text-[7px] font-mono font-bold tracking-wider rounded px-2 py-1 transition-all active:scale-95"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.09)',
              color: 'rgba(255,255,255,0.3)',
            }}
          >
            CLR
          </button>
          <button
            type="button"
            onClick={resetPat}
            className="text-[7px] font-mono font-bold tracking-wider rounded px-2 py-1 transition-all active:scale-95"
            style={{
              background: `${color}0e`,
              border: `1px solid ${color}33`,
              color,
            }}
          >
            4/4
          </button>
        </div>

      </div>
    </div>
  );
};
