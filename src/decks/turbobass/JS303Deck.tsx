/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { JS303Engine } from './JS303Engine';
import {
  type JS303Snapshot, type SynthParamId, type FxKnobId,
  defaultSynth, defaultFx, defaultSteps, STEP_COUNT,
} from './types';
import { Knob } from '../../components/controls/Knob';
import type { HouseDeckProps } from '../index';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

export const JS303Deck: FC<HouseDeckProps> = ({ deckId, color, onSwitchToTrack }) => {
  const [snapshot, setSnapshot] = useState<JS303Snapshot>({
    isPlaying: false, currentStep: -1, bpm: 130, syncToMaster: true,
    steps: defaultSteps(), synth: defaultSynth(), fx: defaultFx(),
    masterVolume: 0.8, swing: 0,
  });

  const engineRef = useRef<JS303Engine | null>(null);

  useEffect(() => {
    const engine = new JS303Engine(deckId);
    engine.init();
    engineRef.current = engine;

    engine.onStepChange = (step) => {
      setSnapshot(s => ({ ...s, currentStep: step }));
    };

    return () => engine.destroy();
  }, [deckId]);

  // ALL hooks MUST be called before any conditional return
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
    const step = snapshot.steps[idx];
    engine.updateStep(idx, { accent: !step.accent });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], accent: !step.accent };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const toggleSlide = useCallback((idx: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const step = snapshot.steps[idx];
    engine.updateStep(idx, { slide: !step.slide });
    setSnapshot(s => {
      const newSteps = [...s.steps];
      newSteps[idx] = { ...newSteps[idx], slide: !step.slide };
      return { ...s, steps: newSteps };
    });
  }, [snapshot.steps]);

  const setSynth = useCallback((id: SynthParamId, v: number) => {
    engineRef.current?.setSynthParam(id, v);
    setSnapshot(s => ({ ...s, synth: { ...s.synth, [id]: v } }));
  }, []);

  const setFx = useCallback((id: FxKnobId, v: number) => {
    engineRef.current?.setFx(id, v);
    setSnapshot(s => ({ ...s, fx: { ...s.fx, [id]: v } }));
  }, []);

  // Now safe to early-return
  if (!engineRef.current) return null;

  const bpm = snapshot.syncToMaster ? (engineRef.current?.bpm ?? snapshot.bpm) : snapshot.bpm;

  return (
    <div className="flex flex-col h-full w-full select-none overflow-hidden" style={{ fontSize: 11 }}>
      {/* HEADER */}
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--brd-default)' }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: snapshot.isPlaying ? color : 'var(--txt-muted)' }} />
          <span className="font-bold tracking-widest text-[10px]" style={{ color }}>{deckId}</span>
          <span className="text-[10px] font-bold tracking-wider" style={{ color }}>TURBOBASS</span>
          <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--txt-muted)' }}>{bpm.toFixed(1)} BPM</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => {
              const e = engineRef.current;
              if (e) { e.syncToMaster = !snapshot.syncToMaster; }
              setSnapshot(s => ({ ...s, syncToMaster: !s.syncToMaster }));
            }}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              color: snapshot.syncToMaster ? color : 'var(--txt-muted)',
              border: `1px solid ${snapshot.syncToMaster ? color + '44' : 'var(--brd-default)'}`,
            }}
          >SYNC</button>
          <button type="button" onClick={onSwitchToTrack} className="text-[9px] text-zinc-500 hover:text-white px-1">EJECT</button>
        </div>
      </div>

      {/* SEQUENCER */}
      <div className="flex gap-0.5 px-2 py-2" style={{ borderBottom: '1px solid var(--brd-default)' }}>
        {snapshot.steps.map((step, i) => (
          <div key={i} className="flex-1 flex flex-col items-center cursor-pointer select-none"
            style={{ gap: 1, marginRight: i % 4 === 3 && i < STEP_COUNT - 1 ? 4 : 0 }}>
            <div onClick={() => toggleGate(i)} className="w-full rounded-sm transition-all"
              style={{
                height: 20,
                background: step.gate ? color : 'rgba(255,255,255,0.04)',
                opacity: step.gate ? 0.8 : 0.3,
                borderTop: snapshot.currentStep === i ? '2px solid white' : '2px solid transparent',
              }} />
            <div onClick={() => toggleAccent(i)} className="w-1.5 h-1.5 rounded-full cursor-pointer"
              style={{ background: step.accent && step.gate ? '#f59e0b' : 'rgba(255,255,255,0.08)' }} title="Accent" />
            <div onClick={() => toggleSlide(i)} className="w-1.5 h-1.5 rounded-full cursor-pointer"
              style={{ background: step.slide && step.gate ? '#06b6d4' : 'rgba(255,255,255,0.08)' }} title="Slide" />
            <span className="text-[7px] text-zinc-600">{step.gate ? midiToName(step.note) : ''}</span>
          </div>
        ))}
      </div>

      {/* SYNTH KNOBS */}
      <div className="flex items-center justify-center gap-3 px-3 py-3 flex-1">
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.synth.cutoff} min={0} max={1} onChange={(v: number) => setSynth('cutoff', v)} color={color} scale={0.7} />
          <span className="text-[8px] text-zinc-500">CUT</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.synth.resonance} min={0} max={1} onChange={(v: number) => setSynth('resonance', v)} color={color} scale={0.7} />
          <span className="text-[8px] text-zinc-500">RES</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.synth.envMod} min={0} max={1} onChange={(v: number) => setSynth('envMod', v)} color={color} scale={0.7} />
          <span className="text-[8px] text-zinc-500">ENV</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.synth.decay} min={0} max={1} onChange={(v: number) => setSynth('decay', v)} color={color} scale={0.7} />
          <span className="text-[8px] text-zinc-500">DEC</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.synth.accent} min={0} max={1} onChange={(v: number) => setSynth('accent', v)} color="#f59e0b" scale={0.7} />
          <span className="text-[8px] text-zinc-500">ACC</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.synth.tuning} min={0} max={1} center={0.5} bipolar onChange={(v: number) => setSynth('tuning', v)} color={color} scale={0.7} />
          <span className="text-[8px] text-zinc-500">TUNE</span>
        </div>
        <button type="button" onClick={() => setSynth('waveform', snapshot.synth.waveform > 0.5 ? 0 : 1)}
          className="flex flex-col items-center gap-1 px-2 py-1 rounded" style={{ border: '1px solid var(--brd-default)' }}>
          <span className="text-[10px] font-mono" style={{ color }}>{snapshot.synth.waveform > 0.5 ? 'SQR' : 'SAW'}</span>
          <span className="text-[7px] text-zinc-500">WAVE</span>
        </button>
        <div className="w-px h-8 bg-zinc-800 mx-1" />
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.fx.distShape} min={0} max={1} onChange={(v: number) => setFx('distShape', v)} color="#ef4444" scale={0.6} />
          <span className="text-[8px] text-zinc-500">DIST</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.fx.delaySend} min={0} max={1} onChange={(v: number) => setFx('delaySend', v)} color="#06b6d4" scale={0.6} />
          <span className="text-[8px] text-zinc-500">DLY</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Knob value={snapshot.fx.delayFeedback} min={0} max={1} onChange={(v: number) => setFx('delayFeedback', v)} color="#06b6d4" scale={0.6} />
          <span className="text-[8px] text-zinc-500">FB</span>
        </div>
      </div>

      {/* TRANSPORT */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--brd-default)' }}>
        <button type="button" onClick={togglePlay}
          className="px-4 py-1.5 rounded font-bold text-[10px] tracking-widest transition-all active:scale-95"
          style={{
            border: `1px solid ${snapshot.isPlaying ? color : 'var(--brd-default)'}`,
            color: snapshot.isPlaying ? color : 'var(--txt-muted)',
            background: snapshot.isPlaying ? color + '15' : 'transparent',
          }}>
          {snapshot.isPlaying ? 'STOP' : 'ENGAGE'}
        </button>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-0.5">
            <Knob value={snapshot.swing} min={0} max={0.5} onChange={(v: number) => { engineRef.current!.swing = v; setSnapshot(s => ({ ...s, swing: v })); }} color="var(--txt-muted)" scale={0.5} />
            <span className="text-[7px] text-zinc-600">SWG</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <Knob value={snapshot.masterVolume} min={0} max={1} onChange={(v: number) => { engineRef.current!.masterVolume = v; setSnapshot(s => ({ ...s, masterVolume: v })); }} color="var(--txt-muted)" scale={0.5} />
            <span className="text-[7px] text-zinc-600">VOL</span>
          </div>
          <button type="button" onClick={() => { engineRef.current?.clearPattern(); setSnapshot(s => ({ ...s, steps: s.steps.map(st => ({ ...st, gate: false })) })); }}
            className="text-[8px] font-bold text-zinc-500 hover:text-red-400 px-1.5 py-0.5 rounded border border-zinc-800 active:scale-95">CLR</button>
          <button type="button" onClick={() => { engineRef.current?.resetPattern(); setSnapshot(s => ({ ...s, steps: defaultSteps() })); }}
            className="text-[8px] font-bold text-zinc-500 hover:text-white px-1.5 py-0.5 rounded border border-zinc-800 active:scale-95">ACID</button>
        </div>
      </div>
    </div>
  );
};
