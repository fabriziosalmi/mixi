/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Topbar HUD Center — Master Clock + System Telemetry
//
// Aligned with Mixer column via CSS subgrid.
// Contains: QuantizeToggle, MasterClock, AudioOutDot, CpuBadge,
//           MiniMasterVu, MidiClockToggle.
// ─────────────────────────────────────────────────────────────

import { useCallback, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MasterClock, useMidiClockActive, toggleMidiClock } from '../hud/MasterClock';
import { CpuBadge, AudioOutDot } from '../hud/SystemHud';

// ── QuantizeToggle (master, affects both decks) ────────────

const QuantizeToggle: FC = () => {
  const qA = useMixiStore((s) => s.decks.A.quantize);
  const qB = useMixiStore((s) => s.decks.B.quantize);
  const setQuantize = useMixiStore((s) => s.setQuantize);
  const active = qA && qB;
  const partial = qA || qB;

  const toggle = useCallback(() => {
    const next = !active;
    setQuantize('A', next);
    setQuantize('B', next);
  }, [active, setQuantize]);

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-[10px] font-mono font-black rounded px-1.5 py-0.5 transition-all active:scale-95"
      style={{
        color: active ? '#000' : partial ? 'var(--status-warn)' : 'var(--txt-muted)',
        backgroundColor: active ? 'var(--status-ok)' : partial ? 'rgba(245,158,11,0.15)' : 'transparent',
        border: `1px solid ${active ? 'var(--status-ok)' : partial ? 'var(--status-warn)' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? '0 0 8px var(--status-ok)66' : 'none',
      }}
      title={`Quantize: ${active ? 'ON (all decks)' : partial ? 'Partial' : 'OFF'}`}
    >
      Q
    </button>
  );
};

// ── MidiClockToggle ─────────────────────────────────────────

const MidiClockToggle: FC = () => {
  const active = useMidiClockActive();
  return (
    <button
      type="button"
      onClick={toggleMidiClock}
      className="text-[10px] font-mono font-black rounded px-1.5 py-0.5 transition-all active:scale-95"
      style={{
        color: active ? '#000' : 'var(--txt-muted)',
        backgroundColor: active ? 'var(--status-ok)' : 'transparent',
        border: `1px solid ${active ? 'var(--status-ok)' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? '0 0 8px var(--status-ok)66' : 'none',
      }}
      title={active ? 'MIDI Clock active — click to stop' : 'Enable MIDI Clock output'}
    >
      M
    </button>
  );
};

// ── Main HudCenter Component ────────────────────────────────

export const HudCenter: FC = () => (
  <div
    className="mixi-master-hud flex flex-col justify-self-stretch rounded-md px-3 py-1 overflow-hidden"
    style={{
      background: 'rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
      minWidth: 0,
      maxWidth: '100%',
    }}
  >
    <div className="flex items-center justify-self-stretch gap-2">
      <QuantizeToggle />
      <div
        className="mixi-master-hud flex flex-col flex-1 rounded-md px-3 py-1 overflow-hidden"
        style={{
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
          minWidth: 0,
        }}
      >
        <div className="flex items-center justify-between w-full">
          <MasterClock />
          <AudioOutDot />
          <CpuBadge />
        </div>
      </div>
      <MidiClockToggle />
    </div>
  </div>
);
