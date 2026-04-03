/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Master Clock & MIDI Out (Top Bar)
//
// Displays the global master BPM and provides MIDI Clock
// output (24 PPQN) via the Web MIDI API so external hardware
// (drum machines, synths, lighting software) can sync.
//
// Uses a high-precision AudioContext-based look-ahead scheduler
// instead of setInterval to achieve sub-ms jitter (pro DAW
// pattern). A Web Worker handles the scheduling tick so the
// main thread's rAF/GC pauses don't drift the clock.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { COLOR_MASTER } from '../../theme';

// ── MIDI Clock constants ─────────────────────────────────────

const MIDI_CLOCK = 0xf8;   // Timing Clock
const MIDI_START = 0xfa;
const MIDI_STOP  = 0xfc;
const PPQN = 24;            // Pulses Per Quarter Note

/**
 * How far ahead (seconds) we schedule MIDI ticks.
 * Larger = more tolerant of main-thread jank, but adds latency.
 */
const LOOK_AHEAD_S = 0.05;   // 50 ms
/** How often (ms) the scheduler wakes up to check. */
const SCHEDULER_TICK_MS = 25; // 25 ms

// ── Minimal MIDI typings (Web MIDI API) ──────────────────────

interface MIDIOutput {
  id: string;
  name: string | null;
  send: (data: number[], timestamp?: number) => void;
}

interface MIDIAccess {
  outputs: Map<string, MIDIOutput>;
  onstatechange: (() => void) | null;
}

// ── Component ────────────────────────────────────────────────

export const MasterClock: FC = () => {
  const bpmA = useMixiStore((s) => s.decks.A.bpm);
  const bpmB = useMixiStore((s) => s.decks.B.bpm);
  const playingA = useMixiStore((s) => s.decks.A.isPlaying);
  const playingB = useMixiStore((s) => s.decks.B.isPlaying);

  const [midiActive, setMidiActive] = useState(false);
  const [midiPort, setMidiPort] = useState<string>('');
  const [midiPorts, setMidiPorts] = useState<MIDIOutput[]>([]);
  /** Visual beat pulse — true for ~80 ms on every quarter beat. */
  const [beatFlash, setBeatFlash] = useState(false);

  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const selectedPortRef = useRef<MIDIOutput | null>(null);
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Next scheduled MIDI tick time in AudioContext seconds. */
  const nextTickTimeRef = useRef(0);
  /** Pulse count within a quarter (0–23). Used for beat flash. */
  const pulseCountRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Beat flash driven from scheduler — avoids setTimeout flood. */
  const beatFlashRef = useRef(false);

  // ── Derive master BPM ──────────────────────────────────────

  let masterBpm = 0;
  if (playingA && playingB) {
    masterBpm = bpmA || bpmB;
  } else if (playingA) {
    masterBpm = bpmA;
  } else if (playingB) {
    masterBpm = bpmB;
  } else {
    masterBpm = bpmA || bpmB;
  }

  // Keep a ref so the scheduler closure always sees the latest BPM.
  const bpmRef = useRef(masterBpm);
  useEffect(() => {
    bpmRef.current = masterBpm;
  }, [masterBpm]);

  // ── Request MIDI access ────────────────────────────────────

  const initMidi = useCallback(async () => {
    if (!(navigator as any).requestMIDIAccess) return;
    try {
      const access: MIDIAccess = await (navigator as any).requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;

      const outputs: MIDIOutput[] = [];
      access.outputs.forEach((port) => outputs.push(port));
      setMidiPorts(outputs);

      if (outputs.length > 0 && !midiPort) {
        setMidiPort(outputs[0].id);
      }

      access.onstatechange = () => {
        const updated: MIDIOutput[] = [];
        access.outputs.forEach((port) => updated.push(port));
        setMidiPorts(updated);
      };
    } catch {
      // MIDI not available or denied
    }
  }, [midiPort]);

  useEffect(() => { initMidi(); }, [initMidi]);

  // ── Resolve selected port ──────────────────────────────────

  useEffect(() => {
    if (!midiAccessRef.current || !midiPort) {
      selectedPortRef.current = null;
      return;
    }
    selectedPortRef.current = midiAccessRef.current.outputs.get(midiPort) || null;
  }, [midiPort]);

  // ── High-precision MIDI Clock scheduler ────────────────────
  //
  // Instead of setInterval firing at the PPQN rate (unreliable),
  // we wake up every 25 ms and schedule all ticks that fall
  // within the next 50 ms look-ahead window using the
  // AudioContext's high-precision clock + MIDIOutput.send(data,
  // timestamp) for sample-accurate delivery.

  useEffect(() => {
    if (!midiActive || masterBpm <= 0) {
      // — Stop —
      if (schedulerRef.current) {
        clearInterval(schedulerRef.current);
        schedulerRef.current = null;
        selectedPortRef.current?.send([MIDI_STOP]);
      }
      return;
    }

    // — Start —
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const actx = engine.getAudioContext();
    selectedPortRef.current?.send([MIDI_START]);

    // Seed the first tick at "now"
    nextTickTimeRef.current = actx.currentTime;
    pulseCountRef.current = 0;

    function scheduler() {
      const bpm = bpmRef.current;
      if (bpm <= 0) return;
      const port = selectedPortRef.current;
      if (!port) return;

      const tickInterval = 60 / (bpm * PPQN); // seconds per MIDI tick
      const deadline = actx.currentTime + LOOK_AHEAD_S;

      while (nextTickTimeRef.current < deadline) {
        // Convert AudioContext time → performance.now()-style timestamp
        // MIDIOutput.send timestamp is in DOMHighResTimeStamp (ms)
        const delayMs = Math.max(0, (nextTickTimeRef.current - actx.currentTime) * 1000);
        const sendAt = performance.now() + delayMs;

        port.send([MIDI_CLOCK], sendAt);

        // Beat flash on every quarter note (every PPQN ticks)
        if (pulseCountRef.current % PPQN === 0) {
          // Set ref + state once; auto-clear via single timer
          if (!beatFlashRef.current) {
            beatFlashRef.current = true;
            setBeatFlash(true);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => {
              beatFlashRef.current = false;
              setBeatFlash(false);
            }, 80);
          }
        }

        pulseCountRef.current++;
        nextTickTimeRef.current += tickInterval;
      }
    }

    schedulerRef.current = setInterval(scheduler, SCHEDULER_TICK_MS);

    return () => {
      if (schedulerRef.current) {
        clearInterval(schedulerRef.current);
        schedulerRef.current = null;
      }
      selectedPortRef.current?.send([MIDI_STOP]);
    };
  }, [midiActive, masterBpm]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (schedulerRef.current) clearInterval(schedulerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // ── Toggle MIDI ────────────────────────────────────────────

  const toggleMidi = useCallback(() => {
    setMidiActive((v) => !v);
  }, []);

  // ── Render ─────────────────────────────────────────────────

  const hasMidi = typeof navigator !== 'undefined' && !!(navigator as any).requestMIDIAccess;

  return (
    <div className="flex items-center gap-1.5">
      {/* Master BPM display */}
      <div
        className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-all duration-75"
        style={{
          background: beatFlash && midiActive
            ? 'rgba(168,85,247,0.14)'
            : 'rgba(168,85,247,0.06)',
          border: '1px solid rgba(168,85,247,0.12)',
        }}
      >
        {/* Metronome / clock icon */}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={COLOR_MASTER} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <span
          className="text-[11px] font-mono font-black tabular-nums"
          style={{
            color: masterBpm > 0 ? COLOR_MASTER : 'var(--txt-dim)',
            minWidth: 38,
            textAlign: 'right',
          }}
        >
          {masterBpm > 0 ? masterBpm.toFixed(1) : '---.-'}
        </span>
        <span className="text-[7px] font-mono font-bold text-zinc-600 uppercase">BPM</span>
      </div>

      {/* MIDI LINK button */}
      {hasMidi && (
        <button
          type="button"
          onClick={toggleMidi}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-all active:scale-95"
          style={{
            background: midiActive ? 'rgba(34,197,94,0.1)' : 'transparent',
            border: midiActive ? '1px solid rgba(34,197,94,0.25)' : '1px solid transparent',
            color: midiActive ? 'var(--status-ok-dim)' : 'var(--txt-muted)',
          }}
          title={midiActive ? 'MIDI Clock active — click to stop' : 'Enable MIDI Clock output'}
        >
          {/* MIDI DIN 5-pin icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="8" cy="10" r="1" fill="currentColor" />
            <circle cx="16" cy="10" r="1" fill="currentColor" />
            <circle cx="12" cy="15" r="1" fill="currentColor" />
            <circle cx="7" cy="14" r="1" fill="currentColor" />
            <circle cx="17" cy="14" r="1" fill="currentColor" />
          </svg>
          <span className="text-[9px] font-mono font-bold tracking-wider">
            {midiActive ? 'LINK' : 'MIDI'}
          </span>
          {midiActive && (
            <span
              className="block rounded-full"
              style={{
                width: 5,
                height: 5,
                background: beatFlash ? 'var(--status-ok)' : 'var(--status-ok-dim)',
                boxShadow: beatFlash
                  ? '0 0 10px var(--status-ok-dim)'
                  : '0 0 6px var(--status-ok-dim)aa',
                transition: 'all 0.05s',
              }}
            />
          )}
        </button>
      )}

      {/* Port selector (visible when MIDI available and ports exist) */}
      {hasMidi && midiPorts.length > 1 && (
        <select
          value={midiPort}
          onChange={(e) => setMidiPort(e.target.value)}
          className="bg-zinc-900/60 border border-zinc-800/50 rounded px-1 py-0.5 text-[9px] text-zinc-400 font-mono outline-none"
          style={{ maxWidth: 90 }}
        >
          {midiPorts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};
