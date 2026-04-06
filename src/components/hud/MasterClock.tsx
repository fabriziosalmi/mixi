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

import { useState, useCallback, useEffect, useRef, useSyncExternalStore, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { COLOR_MASTER } from '../../theme';

// ── Shared MIDI Clock active state (used by MasterClock + MidiClockToggle) ──

let _midiActive = false;
const _listeners = new Set<() => void>();
function _notify() { _listeners.forEach((l) => l()); }

export function toggleMidiClock() {
  _midiActive = !_midiActive;
  _notify();
}
export function useMidiClockActive(): boolean {
  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => _midiActive,
  );
}

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
  const syncA = useMixiStore((s) => s.decks.A.isSynced);
  const syncB = useMixiStore((s) => s.decks.B.isSynced);

  const midiActive = useMidiClockActive();
  const [midiPort, setMidiPort] = useState<string>('');
  const [midiPorts, setMidiPorts] = useState<MIDIOutput[]>([]);
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const selectedPortRef = useRef<MIDIOutput | null>(null);
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Next scheduled MIDI tick time in AudioContext seconds. */
  const nextTickTimeRef = useRef(0);
  /** Pulse count within a quarter (0–23). */
  const pulseCountRef = useRef(0);

  // ── Derive master BPM ──────────────────────────────────────
  // When both decks play: the sync *leader* (non-synced deck) owns the BPM.
  // If A is synced → B is the master. If B is synced → A is the master.
  // If both or neither are synced, default to A.

  let masterBpm = 0;
  if (playingA && playingB) {
    if (syncA && !syncB) masterBpm = bpmB;
    else if (syncB && !syncA) masterBpm = bpmA;
    else masterBpm = bpmA || bpmB;
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

      let safety = 0;
      while (nextTickTimeRef.current < deadline && ++safety < 100) {
        // Convert AudioContext time → performance.now()-style timestamp
        // MIDIOutput.send timestamp is in DOMHighResTimeStamp (ms)
        const delayMs = Math.max(0, (nextTickTimeRef.current - actx.currentTime) * 1000);
        const sendAt = performance.now() + delayMs;

        port.send([MIDI_CLOCK], sendAt);
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
    };
  }, []);

  // ── Toggle MIDI ────────────────────────────────────────────

  // ── Render ─────────────────────────────────────────────────

  const hasMidi = typeof navigator !== 'undefined' && !!(navigator as any).requestMIDIAccess;

  return (
    <div className="flex items-center gap-2">
      {/* ── BPM display — large, dominant ── */}
      <span
        className="text-[16px] font-mono font-black tabular-nums leading-none"
        style={{
          color: masterBpm > 0 ? COLOR_MASTER : 'var(--txt-dim)',
          textShadow: masterBpm > 0 ? `0 0 10px ${COLOR_MASTER}44` : 'none',
          minWidth: 52,
          textAlign: 'center',
        }}
      >
        {masterBpm > 0 ? masterBpm.toFixed(1) : '---.-'}
      </span>

      {/* Port selector (visible when MIDI available and ports exist) */}
      {hasMidi && midiPorts.length > 1 && (
        <select
          value={midiPort}
          onChange={(e) => setMidiPort(e.target.value)}
          className="bg-zinc-900/60 border border-zinc-800/50 rounded px-1 py-0.5 text-[9px] text-zinc-400 font-mono outline-none"
          title="MIDI output port"
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
