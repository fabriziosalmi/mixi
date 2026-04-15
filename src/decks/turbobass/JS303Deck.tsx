/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// JS303 Deck — v2 UI (Iter 4 + Iter 3/5 controls)
//
// Industrial chassis, VFD display, LED glow sequencer,
// filter visualizer, macro knobs, pattern bank, ghost sequence.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { JS303Engine } from './JS303Engine';
import {
  type JS303Snapshot, type SynthParamId, type FxKnobId,
  defaultSynth, defaultFx, defaultSteps,
  STEP_COUNT, MAX_STEPS, BANK_COUNT, PATTERNS_PER_BANK, SCALE_NAMES,
} from './types';
import { BANK_NAMES } from './JS303Patterns';
import { Knob } from '../../components/controls/Knob';
import type { HouseDeckProps } from '../index';

// ── Helpers ─────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

// VFD-style green-cyan glow color
const VFD = '#00e5c8';
const ACID = '#00ff88';
const ACCENT_CLR = '#f59e0b';
const SLIDE_CLR = '#06b6d4';
const DIST_CLR = '#ef4444';

// ── Filter Visualizer ───────────────────────────────────────

function drawFilterCurve(
  canvas: HTMLCanvasElement,
  cutoff: number,
  resonance: number,
  color: string,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    const x = (w * i) / 4;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  // Compute LP response curve
  const cutoffHz = 20 * Math.pow(900, cutoff);
  const Q = 1 + resonance * 20;
  ctx.beginPath();
  for (let i = 0; i < w; i++) {
    // Log frequency: 20Hz → 20kHz
    const freq = 20 * Math.pow(1000, i / w);
    const ratio = freq / cutoffHz;
    const mag = 1 / Math.sqrt(Math.pow(1 - ratio * ratio, 2) + Math.pow(ratio / Q, 2));
    // dB to pixels: 0dB = center, ±24dB = top/bottom
    const dB = 20 * Math.log10(Math.max(mag, 0.001));
    const y = h / 2 - (dB / 24) * (h / 2);
    if (i === 0) ctx.moveTo(i, Math.max(0, Math.min(h, y)));
    else ctx.lineTo(i, Math.max(0, Math.min(h, y)));
  }

  // Glow layer
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.stroke();

  // Bright line on top
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── Component ───────────────────────────────────────────────

export const JS303Deck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<JS303Snapshot>({
    isPlaying: false, currentStep: -1, bpm: 130, syncToMaster: true,
    steps: defaultSteps(), synth: defaultSynth(), fx: defaultFx(),
    masterVolume: 0.8, swing: 0,
    patternLength: 16, transpose: 0, acidMacro: 0,
    currentBank: 0, currentPattern: 0,
    crossfaderLink: false, ghostSequenceReady: false,
    engineReady: false, patternName: '',
  });

  const engineRef = useRef<JS303Engine | null>(null);
  const filterCanvasRef = useRef<HTMLCanvasElement>(null);
  const [showNoteEditor, setShowNoteEditor] = useState<number | null>(null);
  const [scaleIdx, setScaleIdx] = useState(4); // minorPent
  const [stepMode, setStepMode] = useState<16 | 32>(16); // 16 or 32 step view

  // ── Engine lifecycle ──────────────────────────────────────
  useEffect(() => {
    const engine = new JS303Engine(deckId);
    engine.init();
    engineRef.current = engine;
    setSnapshot(s => ({ ...s, engineReady: true, patternName: engine.getPatternName() }));

    engine.onStepChange = (step) => {
      setSnapshot(s => ({ ...s, currentStep: step, bpm: engine.bpm }));
    };

    engine.onGhostReady = (ready) => {
      setSnapshot(s => ({ ...s, ghostSequenceReady: ready }));
    };

    return () => engine.destroy();
  }, [deckId]);

  // ── Filter visualizer ────────────────────────────────────
  useEffect(() => {
    const canvas = filterCanvasRef.current;
    if (canvas) {
      drawFilterCurve(canvas, snapshot.synth.cutoff, snapshot.synth.resonance, color);
    }
  }, [snapshot.synth.cutoff, snapshot.synth.resonance, color]);

  // ── Callbacks (ALL before any conditional return) ─────────

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (snapshot.isPlaying) {
      engine.stop();
      setSnapshot(s => ({ ...s, isPlaying: false, currentStep: -1 }));
    } else {
      engine.engage();
      setSnapshot(s => ({ ...s, isPlaying: true }));
    }
  }, [snapshot.isPlaying]);

  const toggleGate = useCallback((idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const step = snapshot.steps[idx];
    engine.updateStep(idx, { gate: !step.gate });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], gate: !step.gate };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const toggleAccent = useCallback((idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateStep(idx, { accent: !snapshot.steps[idx].accent });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], accent: !newSteps[idx].accent };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const toggleSlide = useCallback((idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateStep(idx, { slide: !snapshot.steps[idx].slide });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], slide: !newSteps[idx].slide };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const toggleTie = useCallback((idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateStep(idx, { tie: !snapshot.steps[idx].tie });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], tie: !newSteps[idx].tie };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const toggleUp = useCallback((idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const newUp = !snapshot.steps[idx].up;
    engine.updateStep(idx, { up: newUp, down: false });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], up: newUp, down: false };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const toggleDown = useCallback((idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const newDown = !snapshot.steps[idx].down;
    engine.updateStep(idx, { down: newDown, up: false });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], down: newDown, up: false };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const setStepNote = useCallback((idx: number, note: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateStep(idx, { note });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], note };
      return { ...s, steps: newSteps };
    });
  }, []);

  const setSynth = useCallback((id: SynthParamId, v: number) => {
    engineRef.current?.setSynthParam(id, v);
    setSnapshot(s => ({ ...s, synth: { ...s.synth, [id]: v } }));
  }, []);

  const setFx = useCallback((id: FxKnobId, v: number) => {
    engineRef.current?.setFx(id, v);
    setSnapshot(s => ({ ...s, fx: { ...s.fx, [id]: v } }));
  }, []);

  const loadPattern = useCallback((bank: number, pattern: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.loadPattern(bank, pattern);
    setSnapshot(s => ({
      ...s,
      steps: engine.steps.map(st => ({ ...st })),
      currentBank: bank,
      currentPattern: pattern,
      patternName: engine.getPatternName(),
    }));
  }, []);

  const doRandomize = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const scale = SCALE_NAMES[scaleIdx] ?? 'minorPent';
    engine.randomize(scale, 36 + (snapshot.transpose % 12));
    setSnapshot(s => ({ ...s, steps: engine.steps.map(st => ({ ...st })) }));
  }, [scaleIdx, snapshot.transpose]);

  const doMutate = useCallback((amount: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.mutate(amount);
    setSnapshot(s => ({ ...s, steps: engine.steps.map(st => ({ ...st })) }));
  }, []);

  // Now safe to early-return
  if (!snapshot.engineReady) return null;

  const bpm = snapshot.bpm;
  const patternName = snapshot.patternName;

  // ── Inline Styles ─────────────────────────────────────────

  const chassis: React.CSSProperties = {
    background: 'linear-gradient(180deg, #1a1a1e 0%, #111114 50%, #0d0d10 100%)',
    fontSize: 11,
    // Subtle metallic noise texture via repeating gradient
    backgroundImage: `
      linear-gradient(180deg, #1a1a1e 0%, #111114 50%, #0d0d10 100%),
      repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,0.008) 2px, rgba(255,255,255,0.008) 4px)
    `,
  };

  const sectionBorder = '1px solid rgba(255,255,255,0.06)';
  const screwDot: React.CSSProperties = {
    width: 4, height: 4, borderRadius: '50%',
    background: 'radial-gradient(circle, #333 0%, #1a1a1a 100%)',
    border: '0.5px solid #444',
    flexShrink: 0,
  };

  return (
    <div className="flex flex-col h-full w-full select-none overflow-hidden" style={chassis}>
      {/* ═══ HEADER — VFD Display ════════════════════════════ */}
      <div className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: sectionBorder }}>
        <div className="flex items-center gap-2">
          <div style={screwDot} />
          <span className="w-2 h-2 rounded-full transition-all duration-300"
            style={{
              background: snapshot.isPlaying ? color : 'var(--txt-muted)',
              boxShadow: snapshot.isPlaying ? `0 0 8px ${color}, 0 0 3px ${color}` : 'none',
            }} />
          <span className="font-bold tracking-widest text-[10px]" style={{ color }}>{deckId}</span>
          <span className="text-[10px] font-bold tracking-wider" style={{ color }}>TURBOBASS</span>
          {/* VFD Display */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded"
            style={{
              background: 'rgba(0,0,0,0.6)',
              border: '1px solid rgba(0,229,200,0.15)',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8)',
            }}>
            <span className="font-mono text-[10px] font-bold tracking-wider"
              style={{ color: VFD, textShadow: `0 0 6px ${VFD}66, 0 0 2px ${VFD}44` }}>
              {BANK_NAMES[snapshot.currentBank]}-{String(snapshot.currentPattern + 1).padStart(2, '0')}
            </span>
            <span className="text-[8px] font-mono" style={{ color: `${VFD}88` }}>│</span>
            <span className="font-mono text-[9px]"
              style={{ color: `${VFD}aa`, textShadow: `0 0 4px ${VFD}33` }}>
              {patternName}
            </span>
            <span className="text-[8px] font-mono" style={{ color: `${VFD}88` }}>│</span>
            <span className="font-mono text-[10px] tabular-nums font-bold"
              style={{ color: VFD, textShadow: `0 0 6px ${VFD}66` }}>
              {bpm.toFixed(1)}
            </span>
            {snapshot.transpose !== 0 && (
              <>
                <span className="text-[8px] font-mono" style={{ color: `${VFD}88` }}>│</span>
                <span className="font-mono text-[9px] font-bold"
                  style={{ color: ACCENT_CLR, textShadow: `0 0 4px ${ACCENT_CLR}44` }}>
                  {snapshot.transpose > 0 ? '+' : ''}{snapshot.transpose}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {snapshot.ghostSequenceReady && (
            <button type="button"
              onClick={() => {
                engineRef.current?.acceptGhostSequence();
                setSnapshot(s => ({
                  ...s,
                  steps: engineRef.current!.steps.map(st => ({ ...st })),
                  ghostSequenceReady: false,
                }));
              }}
              className="text-[8px] font-bold px-1.5 py-0.5 rounded animate-pulse"
              style={{
                color: '#a855f7',
                border: '1px solid rgba(168,85,247,0.4)',
                background: 'rgba(168,85,247,0.1)',
                textShadow: '0 0 6px rgba(168,85,247,0.6)',
              }}>
              GHOST
            </button>
          )}
          <button type="button"
            onClick={() => {
              const e = engineRef.current;
              if (e) e.syncToMaster = !snapshot.syncToMaster;
              setSnapshot(s => ({ ...s, syncToMaster: !s.syncToMaster }));
            }}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              color: snapshot.syncToMaster ? VFD : 'var(--txt-muted)',
              border: `1px solid ${snapshot.syncToMaster ? VFD + '44' : 'rgba(255,255,255,0.08)'}`,
              textShadow: snapshot.syncToMaster ? `0 0 4px ${VFD}66` : 'none',
            }}>SYNC</button>
          <button type="button" onClick={onSwitchToTrack}
            className="text-[9px] text-zinc-500 hover:text-white px-1 transition-colors">EJECT</button>
          <div style={screwDot} />
        </div>
      </div>

      {/* ═══ SEQUENCER — Roland-style horizontal rows ════════ */}
      <div className="px-2 py-0.5 shrink-0 flex flex-col" style={{ borderBottom: sectionBorder }}>
        {/* Render 1 or 2 pages of 16 steps depending on stepMode */}
        {Array.from({ length: stepMode === 32 ? 2 : 1 }, (_, row) => {
          const offset = row * STEP_COUNT;
          const stepsInRow = snapshot.steps.slice(offset, offset + STEP_COUNT);

          return (
            <div key={`page-${row}`} className="flex flex-col"
              style={{ marginBottom: row === 0 && stepMode === 32 ? 3 : 0 }}>

              {/* Row label for 32-step mode */}
              {stepMode === 32 && (
                <div className="text-[7px] font-mono mb-0.5"
                  style={{ color: `${VFD}66` }}>{row === 0 ? '1-16' : '17-32'}</div>
              )}

              {/* ── LED row ──────────────────────────────────── */}
              <div className="flex gap-0.5 mb-0.5 pl-[22px]">
                {stepsInRow.map((step, i) => {
                  const idx = offset + i;
                  const active = snapshot.currentStep === idx;
                  const dimmed = idx >= snapshot.patternLength;
                  return (
                    <div key={`led-${idx}`} className="flex-1 flex justify-center"
                      style={{ marginRight: i % 4 === 3 && i < STEP_COUNT - 1 ? 4 : 0 }}>
                      <div className="rounded-full transition-all duration-75"
                        style={{
                          width: 5, height: 5,
                          background: dimmed ? 'rgba(255,255,255,0.03)'
                            : active ? '#fff'
                            : step.gate ? (step.accent ? ACCENT_CLR : color)
                            : 'rgba(255,255,255,0.06)',
                          boxShadow: dimmed ? 'none'
                            : active ? `0 0 6px #fff, 0 0 10px ${color}`
                            : step.gate ? `0 0 4px ${step.accent ? ACCENT_CLR : color}66`
                            : 'none',
                        }} />
                    </div>
                  );
                })}
              </div>

              {/* ── GATE buttons (compact fixed height) ───── */}
              <div className="flex gap-0.5 pl-[22px]">
                {stepsInRow.map((step, i) => {
                  const idx = offset + i;
                  const active = snapshot.currentStep === idx;
                  const dimmed = idx >= snapshot.patternLength;
                  return (
                    <div key={`gate-${idx}`}
                      onClick={() => toggleGate(idx)}
                      onContextMenu={(e) => { e.preventDefault(); setShowNoteEditor(showNoteEditor === idx ? null : idx); }}
                      className="flex-1 rounded-sm cursor-pointer transition-all duration-75 active:scale-95 relative"
                      style={{
                        height: stepMode === 32 ? 18 : 24,
                        marginRight: i % 4 === 3 && i < STEP_COUNT - 1 ? 4 : 0,
                        opacity: dimmed ? 0.2 : 1,
                        background: step.gate
                          ? `linear-gradient(180deg, ${color}dd 0%, ${color}88 100%)`
                          : 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
                        boxShadow: step.gate
                          ? `inset 0 1px 0 rgba(255,255,255,0.2), 0 1px 3px rgba(0,0,0,0.4)${active ? `, 0 0 8px ${color}66` : ''}`
                          : 'inset 0 1px 2px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.04)',
                        borderTop: active ? '2px solid #fff' : '2px solid transparent',
                      }}>
                      {/* Note editor popup */}
                      {showNoteEditor === idx && (
                        <div className="absolute z-50 p-1 rounded"
                          style={{
                            top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4,
                            background: 'rgba(0,0,0,0.95)',
                            border: `1px solid ${color}44`,
                            boxShadow: `0 4px 12px rgba(0,0,0,0.8), 0 0 8px ${color}22`,
                          }}>
                          <div className="grid grid-cols-4 gap-0.5" style={{ width: 80 }}>
                            {Array.from({ length: 24 }, (_, n) => 36 + n).map(note => (
                              <button key={note} type="button"
                                onClick={(e) => { e.stopPropagation(); setStepNote(idx, note); setShowNoteEditor(null); }}
                                className="text-[7px] font-mono px-0.5 py-0.5 rounded hover:opacity-100 transition-opacity"
                                style={{
                                  opacity: step.note === note ? 1 : 0.5,
                                  color: step.note === note ? color : '#888',
                                  background: step.note === note ? `${color}22` : 'transparent',
                                }}>
                                {midiToName(note)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── NOTE names row ──────────────────────────── */}
              <div className="flex gap-0.5 mt-0.5 pl-[22px]">
                {stepsInRow.map((step, i) => (
                  <div key={`note-${offset + i}`} className="flex-1 text-center"
                    style={{ marginRight: i % 4 === 3 && i < STEP_COUNT - 1 ? 4 : 0 }}>
                    <span className="text-[6px] font-mono"
                      style={{ color: step.gate ? 'rgba(255,255,255,0.4)' : 'transparent' }}>
                      {midiToName(step.note)}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── ACCENT row ──────────────────────────────── */}
              <StepParamRow
                label="ACC" labelColor={ACCENT_CLR}
                steps={stepsInRow} offset={offset}
                isActive={(s) => s.accent && s.gate}
                activeColor={ACCENT_CLR}
                onToggle={(idx) => toggleAccent(idx)}
                patternLength={snapshot.patternLength}
              />

              {/* ── SLIDE row ──────────────────────────────── */}
              <StepParamRow
                label="SLD" labelColor={SLIDE_CLR}
                steps={stepsInRow} offset={offset}
                isActive={(s) => s.slide && s.gate}
                activeColor={SLIDE_CLR}
                onToggle={(idx) => toggleSlide(idx)}
                patternLength={snapshot.patternLength}
              />

              {/* ── TIE row ────────────────────────────────── */}
              <StepParamRow
                label="TIE" labelColor="#22d3ee"
                steps={stepsInRow} offset={offset}
                isActive={(s) => s.tie && s.gate}
                activeColor="#22d3ee"
                onToggle={(idx) => toggleTie(idx)}
                patternLength={snapshot.patternLength}
              />

              {/* ── OCTAVE UP row ──────────────────────────── */}
              <StepParamRow
                label="UP" labelColor={ACCENT_CLR}
                steps={stepsInRow} offset={offset}
                isActive={(s) => s.up && s.gate}
                activeColor={ACCENT_CLR}
                onToggle={(idx) => toggleUp(idx)}
                patternLength={snapshot.patternLength}
              />

              {/* ── OCTAVE DOWN row ────────────────────────── */}
              <StepParamRow
                label="DN" labelColor={SLIDE_CLR}
                steps={stepsInRow} offset={offset}
                isActive={(s) => s.down && s.gate}
                activeColor={SLIDE_CLR}
                onToggle={(idx) => toggleDown(idx)}
                patternLength={snapshot.patternLength}
              />
            </div>
          );
        })}
      </div>

      {/* ═══ SYNTH + FX — Three-Row Layout ═════════════════ */}
      <div className="flex flex-col shrink-0" style={{ borderBottom: sectionBorder }}>

        {/* ── Row 1: MAIN CONTROLS — CUT RES ENV DEC (big knobs) + ACID ── */}
        <div className="flex items-center justify-center gap-1 px-2 py-1.5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
          {/* Filter Visualizer */}
          <div className="flex flex-col items-center justify-center px-1" style={{ minWidth: 64 }}>
            <canvas ref={filterCanvasRef} width={56} height={32}
              className="rounded"
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.06)',
              }} />
            <span className="text-[5px] text-zinc-600 mt-0.5 tracking-wider">FILTER</span>
          </div>

          {/* Big Knobs: CUT RES ENV DEC */}
          <div className="flex items-center gap-3 px-2">
            <BigKnob label="CUT" value={snapshot.synth.cutoff} onChange={(v: number) => setSynth('cutoff', v)} color={color} />
            <BigKnob label="RES" value={snapshot.synth.resonance} onChange={(v: number) => setSynth('resonance', v)} color={color} />
            <BigKnob label="ENV" value={snapshot.synth.envMod} onChange={(v: number) => setSynth('envMod', v)} color={color} />
            <BigKnob label="DEC" value={snapshot.synth.decay} onChange={(v: number) => setSynth('decay', v)} color={color} />
          </div>

          <div className="w-px self-stretch my-1" style={{ background: 'rgba(255,255,255,0.06)' }} />

          {/* ACID Macro */}
          <div className="flex flex-col items-center gap-0.5 px-2">
            <Knob value={snapshot.acidMacro} min={0} max={1}
              onChange={(v: number) => {
                engineRef.current!.acidMacro = v;
                setSnapshot(s => ({
                  ...s, acidMacro: v,
                  synth: { ...engineRef.current!.synthParams },
                }));
              }}
              color={ACID} scale={0.7} />
            <span className="text-[7px] font-bold tracking-wider"
              style={{ color: ACID, textShadow: `0 0 4px ${ACID}44` }}>ACID</span>
          </div>

          <div className="w-px self-stretch my-1" style={{ background: 'rgba(255,255,255,0.06)' }} />

          {/* Wave toggle */}
          <div className="flex flex-col items-center gap-1 px-1">
            <button type="button"
              onClick={() => setSynth('waveform', snapshot.synth.waveform > 0.5 ? 0 : 1)}
              className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
              style={{
                color, border: `1px solid ${color}33`,
                background: `${color}0a`,
              }}>
              {snapshot.synth.waveform > 0.5 ? 'SQR' : 'SAW'}
            </button>
            <MiniKnob label="TUNE" value={snapshot.synth.tuning}
              onChange={(v: number) => setSynth('tuning', v)} color={color} bipolar />
          </div>
        </div>

        {/* ── Row 2: Tone + Control + Effects ─────────────────── */}
        <div className="flex items-center px-1 py-0.5">
          {/* Tone */}
          <div className="flex items-center gap-1 px-1">
            <MiniKnob label="ACC" value={snapshot.synth.accent} onChange={(v: number) => setSynth('accent', v)} color={ACCENT_CLR} />
            <MiniKnob label="DRV" value={snapshot.synth.drive} onChange={(v: number) => setSynth('drive', v)} color={DIST_CLR} />
            <MiniKnob label="SUB" value={snapshot.synth.subLevel} onChange={(v: number) => setSynth('subLevel', v)} color={color} />
            <MiniKnob label="DFT" value={snapshot.synth.drift} onChange={(v: number) => setSynth('drift', v)} color="#666" />
          </div>

          <div className="w-px self-stretch my-0.5" style={{ background: 'rgba(255,255,255,0.06)' }} />

          {/* Control */}
          <div className="flex items-center gap-1 px-1">
            <MiniKnob label="GATE" value={snapshot.synth.gateLength} onChange={(v: number) => setSynth('gateLength', v)} color={SLIDE_CLR} />
            <MiniKnob label="SLDT" value={snapshot.synth.slideTime} onChange={(v: number) => setSynth('slideTime', v)} color={SLIDE_CLR} />
            <MiniKnob label="TRK" value={snapshot.synth.filterTracking} onChange={(v: number) => setSynth('filterTracking', v)} color={ACCENT_CLR} />
          </div>

          <div className="w-px self-stretch my-0.5" style={{ background: 'rgba(255,255,255,0.06)' }} />

          {/* Effects */}
          <div className="flex items-center gap-1 px-1">
            <MiniKnob label="DST" value={snapshot.fx.distShape} onChange={(v: number) => setFx('distShape', v)} color={DIST_CLR} />
            <MiniKnob label="DLY" value={snapshot.fx.delaySend} onChange={(v: number) => setFx('delaySend', v)} color={SLIDE_CLR} />
            <MiniKnob label="FB" value={snapshot.fx.delayFeedback} onChange={(v: number) => setFx('delayFeedback', v)} color={SLIDE_CLR} />
            <MiniKnob label="REV" value={snapshot.fx.reverbSend} onChange={(v: number) => setFx('reverbSend', v)} color="#a855f7" />
            <MiniKnob label="CHO" value={snapshot.fx.chorusMix} onChange={(v: number) => setFx('chorusMix', v)} color="#a855f7" />
            <MiniKnob label="LFO" value={snapshot.fx.filterLfoDepth} onChange={(v: number) => setFx('filterLfoDepth', v)} color={color} />
          </div>
        </div>
      </div>

      {/* ═══ PERFORMANCE BAR ═════════════════════════════════ */}
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: sectionBorder }}>
        {/* Pattern Bank */}
        <div className="flex gap-0.5">
          {Array.from({ length: BANK_COUNT }, (_, b) => (
            <button key={b} type="button"
              onClick={() => loadPattern(b, snapshot.currentPattern)}
              className="text-[8px] font-bold px-1 py-0.5 rounded transition-all"
              style={{
                color: b === snapshot.currentBank ? VFD : '#555',
                background: b === snapshot.currentBank ? `${VFD}15` : 'transparent',
                border: `1px solid ${b === snapshot.currentBank ? VFD + '44' : '#333'}`,
                textShadow: b === snapshot.currentBank ? `0 0 4px ${VFD}66` : 'none',
              }}>
              {BANK_NAMES[b]}
            </button>
          ))}
        </div>

        {/* Pattern Select */}
        <div className="flex gap-0.5">
          {Array.from({ length: PATTERNS_PER_BANK }, (_, p) => (
            <button key={p} type="button"
              onClick={() => loadPattern(snapshot.currentBank, p)}
              className="text-[7px] font-mono px-0.5 rounded transition-all"
              style={{
                color: p === snapshot.currentPattern ? color : '#444',
                background: p === snapshot.currentPattern ? `${color}15` : 'transparent',
                border: `1px solid ${p === snapshot.currentPattern ? color + '33' : 'transparent'}`,
              }}>
              {p + 1}
            </button>
          ))}
        </div>

        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Shift L/R */}
        <button type="button" onClick={() => {
          engineRef.current?.shiftLeft();
          setSnapshot(s => ({ ...s, steps: engineRef.current!.steps.map(st => ({ ...st })) }));
        }}
          className="text-[9px] font-bold text-zinc-500 hover:text-white px-1 transition-colors">◀</button>
        <button type="button" onClick={() => {
          engineRef.current?.shiftRight();
          setSnapshot(s => ({ ...s, steps: engineRef.current!.steps.map(st => ({ ...st })) }));
        }}
          className="text-[9px] font-bold text-zinc-500 hover:text-white px-1 transition-colors">▶</button>

        {/* 16/32 toggle */}
        <button type="button"
          onClick={() => {
            const next = stepMode === 16 ? 32 : 16;
            setStepMode(next);
            // If switching to 32 and patternLength was 16, extend it
            if (next === 32 && snapshot.patternLength <= 16) {
              engineRef.current!.patternLength = 32;
              setSnapshot(s => ({ ...s, patternLength: 32 }));
            } else if (next === 16 && snapshot.patternLength > 16) {
              engineRef.current!.patternLength = 16;
              setSnapshot(s => ({ ...s, patternLength: 16 }));
            }
          }}
          className="text-[8px] font-bold font-mono px-1.5 py-0.5 rounded transition-all"
          style={{
            color: stepMode === 32 ? ACCENT_CLR : '#666',
            border: `1px solid ${stepMode === 32 ? ACCENT_CLR + '44' : '#333'}`,
          }}>
          {stepMode}
        </button>

        {/* Length */}
        <div className="flex items-center gap-0.5">
          <span className="text-[7px] text-zinc-600">LEN</span>
          <button type="button" onClick={() => {
            const len = Math.max(1, snapshot.patternLength - 1);
            engineRef.current!.patternLength = len;
            setSnapshot(s => ({ ...s, patternLength: len }));
          }}
            className="text-[8px] text-zinc-500 hover:text-white px-0.5">-</button>
          <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color, minWidth: 14, textAlign: 'center' }}>
            {snapshot.patternLength}
          </span>
          <button type="button" onClick={() => {
            const len = Math.min(MAX_STEPS, snapshot.patternLength + 1);
            engineRef.current!.patternLength = len;
            setSnapshot(s => ({ ...s, patternLength: len }));
          }}
            className="text-[8px] text-zinc-500 hover:text-white px-0.5">+</button>
        </div>

        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Transpose */}
        <div className="flex items-center gap-0.5">
          <span className="text-[7px] text-zinc-600">KEY</span>
          <button type="button" onClick={() => {
            const t = snapshot.transpose - 1;
            engineRef.current!.transpose = t;
            setSnapshot(s => ({ ...s, transpose: t }));
          }}
            className="text-[8px] text-zinc-500 hover:text-white px-0.5">-</button>
          <span className="text-[9px] font-mono font-bold tabular-nums"
            style={{ color: ACCENT_CLR, minWidth: 18, textAlign: 'center' }}>
            {snapshot.transpose > 0 ? '+' : ''}{snapshot.transpose}
          </span>
          <button type="button" onClick={() => {
            const t = snapshot.transpose + 1;
            engineRef.current!.transpose = t;
            setSnapshot(s => ({ ...s, transpose: t }));
          }}
            className="text-[8px] text-zinc-500 hover:text-white px-0.5">+</button>
        </div>

        {/* Scale selector for randomizer */}
        <button type="button"
          onClick={() => setScaleIdx((scaleIdx + 1) % SCALE_NAMES.length)}
          className="text-[7px] font-mono text-zinc-500 hover:text-white px-1 rounded"
          style={{ border: '1px solid #333' }}>
          {SCALE_NAMES[scaleIdx]}
        </button>
      </div>

      {/* ═══ TRANSPORT ═══════════════════════════════════════ */}
      <div className="flex items-center justify-between px-2 py-1">
        <button type="button" onClick={togglePlay}
          className="px-3 py-1 rounded font-bold text-[9px] tracking-widest transition-all active:scale-95"
          style={{
            border: `1px solid ${snapshot.isPlaying ? color : 'rgba(255,255,255,0.1)'}`,
            color: snapshot.isPlaying ? '#fff' : 'var(--txt-muted)',
            background: snapshot.isPlaying
              ? `linear-gradient(180deg, ${color}33 0%, ${color}11 100%)`
              : 'transparent',
            boxShadow: snapshot.isPlaying ? `0 0 12px ${color}33, inset 0 1px 0 rgba(255,255,255,0.1)` : 'none',
            textShadow: snapshot.isPlaying ? `0 0 8px ${color}` : 'none',
          }}>
          {snapshot.isPlaying ? '■ STOP' : '▶ ENGAGE'}
        </button>

        <div className="flex items-center gap-1">
          <MiniKnob label="SWG" value={snapshot.swing}
            onChange={(v: number) => { engineRef.current!.swing = v; setSnapshot(s => ({ ...s, swing: v })); }}
            color="var(--txt-muted)" max={0.5} />
          <MiniKnob label="VOL" value={snapshot.masterVolume}
            onChange={(v: number) => { engineRef.current!.masterVolume = v; setSnapshot(s => ({ ...s, masterVolume: v })); }}
            color="var(--txt-muted)" />

          <div className="w-px h-3" style={{ background: 'rgba(255,255,255,0.06)' }} />

          <button type="button" onClick={doRandomize}
            className="text-[7px] font-bold px-1 py-0.5 rounded active:scale-95"
            style={{ color: ACID, border: `1px solid ${ACID}33` }}>RND</button>
          <button type="button" onClick={() => doMutate(0.3)}
            className="text-[7px] font-bold px-1 py-0.5 rounded active:scale-95"
            style={{ color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>MUT</button>
          <button type="button"
            onClick={() => { engineRef.current?.copyPattern(); }}
            className="text-[7px] font-bold px-1 py-0.5 rounded active:scale-95"
            style={{ color: SLIDE_CLR, border: `1px solid ${SLIDE_CLR}33` }}>CPY</button>
          <button type="button"
            onClick={() => {
              engineRef.current?.pastePattern();
              setSnapshot(s => ({ ...s, steps: engineRef.current!.steps.map(st => ({ ...st })) }));
            }}
            className="text-[7px] font-bold px-1 py-0.5 rounded active:scale-95"
            style={{
              // eslint-disable-next-line react-hooks/refs
              color: engineRef.current?.hasClipboard ? SLIDE_CLR : '#444',
              // eslint-disable-next-line react-hooks/refs
              border: `1px solid ${engineRef.current?.hasClipboard ? SLIDE_CLR + '33' : '#333'}`,
            }}>PST</button>

          <div className="w-px h-3" style={{ background: 'rgba(255,255,255,0.06)' }} />

          <button type="button"
            onClick={() => { engineRef.current?.clearPattern(); setSnapshot(s => ({ ...s, steps: s.steps.map(st => ({ ...st, gate: false })) })); }}
            className="text-[7px] font-bold text-zinc-500 hover:text-red-400 px-1 py-0.5 rounded active:scale-95"
            style={{ border: '1px solid #333' }}>CLR</button>
          <button type="button"
            onClick={() => { engineRef.current?.resetPattern(); setSnapshot(s => ({ ...s, steps: defaultSteps() })); }}
            className="text-[7px] font-bold text-zinc-500 hover:text-white px-1 py-0.5 rounded active:scale-95"
            style={{ border: '1px solid #333' }}>RST</button>
          <button type="button"
            onClick={() => {
              engineRef.current?.panic();
              setSnapshot(s => ({
                ...s,
                synth: { ...defaultSynth() },
                fx: { ...defaultFx() },
                acidMacro: 0,
              }));
            }}
            className="text-[7px] font-bold px-1 py-0.5 rounded active:scale-95"
            style={{ color: DIST_CLR, border: `1px solid ${DIST_CLR}33` }}>PNC</button>
          <button type="button"
            onClick={() => {
              const e = engineRef.current;
              if (e) e.crossfaderLink = !snapshot.crossfaderLink;
              setSnapshot(s => ({ ...s, crossfaderLink: !s.crossfaderLink }));
            }}
            className="text-[7px] font-bold px-1 py-0.5 rounded"
            style={{
              color: snapshot.crossfaderLink ? ACCENT_CLR : '#555',
              border: `1px solid ${snapshot.crossfaderLink ? ACCENT_CLR + '44' : '#333'}`,
            }}>X↔F</button>
        </div>
      </div>
    </div>
  );
};

// ── Step Parameter Row (ACC / SLD / UP / DN) ────────────────

const StepParamRow: FC<{
  label: string;
  labelColor: string;
  steps: import('./types').JS303Step[];
  offset: number;
  isActive: (step: import('./types').JS303Step) => boolean;
  activeColor: string;
  onToggle: (idx: number) => void;
  patternLength: number;
}> = ({ label, labelColor, steps, offset, isActive, activeColor, onToggle, patternLength }) => (
  <div className="flex items-center gap-0.5 mt-px">
    <span className="text-[6px] font-bold w-5 text-right pr-0.5 shrink-0"
      style={{ color: `${labelColor}66` }}>{label}</span>
    {steps.map((step, i) => {
      const idx = offset + i;
      const active = isActive(step);
      const dimmed = idx >= patternLength;
      return (
        <div key={`${label}-${idx}`}
          onClick={() => onToggle(idx)}
          className="flex-1 cursor-pointer rounded-sm transition-all active:scale-90"
          style={{
            height: 12,
            marginRight: i % 4 === 3 && i < STEP_COUNT - 1 ? 4 : 0,
            opacity: dimmed ? 0.15 : 1,
            background: active
              ? activeColor
              : 'rgba(255,255,255,0.04)',
            boxShadow: active
              ? `0 0 4px ${activeColor}66, inset 0 1px 0 rgba(255,255,255,0.2)`
              : 'inset 0 1px 1px rgba(0,0,0,0.2)',
          }}
        />
      );
    })}
  </div>
);

// ── Mini Knob wrapper ───────────────────────────────────────

const MiniKnob: FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
  min?: number;
  max?: number;
  bipolar?: boolean;
}> = ({ label, value, onChange, color, min = 0, max = 1, bipolar }) => (
  <div className="flex flex-col items-center gap-0.5">
    <Knob value={value} min={min} max={max} onChange={onChange}
      color={color} scale={0.55}
      bipolar={bipolar} center={bipolar ? (min + max) / 2 : undefined} />
    <span className="text-[7px] font-bold tracking-wide" style={{ color: '#555' }}>{label}</span>
  </div>
);

// ── Big Knob wrapper (for main synth controls) ─────────────

const BigKnob: FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
  min?: number;
  max?: number;
}> = ({ label, value, onChange, color, min = 0, max = 1 }) => (
  <div className="flex flex-col items-center gap-0.5">
    <Knob value={value} min={min} max={max} onChange={onChange}
      color={color} scale={0.75} />
    <span className="text-[8px] font-bold tracking-wider" style={{ color }}>{label}</span>
  </div>
);
