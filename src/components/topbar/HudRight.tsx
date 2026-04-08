/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Topbar HUD Right — Recording + Global Controls
//
// Aligned with Deck B column via CSS subgrid.
// Contains: RecPanel, Track Browser toggle, SkinSelector,
//           VFX toggle, Panic button, Settings gear.
// ─────────────────────────────────────────────────────────────

import { useCallback, useState, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { useMidiClockActive, toggleMidiClock } from '../hud/MasterClock';
import { RecPanel } from '../hud/RecPanel';
import { SkinSelector } from '../hud/SkinSelector';
import { HudNotifications } from './HudNotifications';

interface HudRightProps {
  toggleBrowser: () => void;
  browserOpen: boolean;
  vfxActive: boolean;
  setVfxActive: React.Dispatch<React.SetStateAction<boolean>>;
  handlePanic: () => void;
  toggleSettings: () => void;
  updateAvailable: boolean;
}

export const HudRight: FC<HudRightProps> = ({
  toggleBrowser, browserOpen, vfxActive, setVfxActive,
  handlePanic, toggleSettings, updateAvailable,
}) => (
  <div className="flex items-center gap-1.5 justify-self-stretch h-full">
    {/* Notification area — fills space between center and controls */}
    <HudNotifications />

    {/* Controls group */}
    <div
      className="flex items-center gap-2 shrink-0 rounded-md px-3 py-1 overflow-hidden h-full"
      style={{
        background: 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
      }}
    >
    <QuantizeBtn />
    <MidiClockBtn />
    <div className="w-px self-stretch my-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
    <div className="flex items-center h-full">
      <RecPanel />
    </div>
    <div className="w-px self-stretch my-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
    <div className="flex items-center gap-1.5">
      {/* Track Browser toggle */}
      <button
        type="button"
        onClick={toggleBrowser}
        className="rounded p-0.5 transition-all duration-150"
        title="Track Browser (Tab)"
        style={{
          color: browserOpen ? 'var(--clr-master)' : 'var(--txt-muted)',
          filter: browserOpen ? 'drop-shadow(0 0 4px var(--clr-master)88)' : 'none',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>

      {/* Skin selector */}
      <SkinSelector />

      {/* VFX toggle — Space Invader */}
      <button
        type="button"
        onClick={() => setVfxActive((v) => !v)}
        className={`rounded p-0.5 transition-all duration-300 ${vfxActive ? 'mixi-vfx-btn' : ''}`}
        title={vfxActive ? 'VFX: ON' : 'VFX: OFF'}
        style={{
          color: vfxActive ? 'var(--txt-white)' : 'var(--txt-muted)',
          filter: vfxActive ? 'drop-shadow(0 0 6px #ff00ff88)' : 'none',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="1" width="2" height="2" />
          <rect x="11" y="1" width="2" height="2" />
          <rect x="5" y="3" width="2" height="2" />
          <rect x="9" y="3" width="2" height="2" />
          <rect x="3" y="5" width="10" height="2" />
          <rect x="1" y="7" width="2" height="2" />
          <rect x="3" y="7" width="2" height="2" />
          <rect x="5" y="7" width="6" height="2" />
          <rect x="11" y="7" width="2" height="2" />
          <rect x="13" y="7" width="2" height="2" />
          <rect x="1" y="9" width="2" height="2" />
          <rect x="5" y="9" width="2" height="2" />
          <rect x="9" y="9" width="2" height="2" />
          <rect x="13" y="9" width="2" height="2" />
          <rect x="3" y="11" width="2" height="2" />
          <rect x="5" y="11" width="2" height="2" />
          <rect x="9" y="11" width="2" height="2" />
          <rect x="11" y="11" width="2" height="2" />
        </svg>
      </button>

      {/* Panic button — reset all FX/EQ/loops */}
      <button
        type="button"
        onClick={handlePanic}
        className="rounded p-0.5 text-zinc-600 hover:text-red-400 transition-colors duration-150 active:scale-90"
        title="Panic Reset (Esc) — flatten EQ, kill FX, exit loops"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </button>

      {/* Settings gear */}
      <button
        type="button"
        onClick={toggleSettings}
        className="mixi-gear relative rounded p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        title={updateAvailable ? 'Settings — Update available!' : 'Settings'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {updateAvailable && (
          <span className="absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full bg-orange-500 ring-1 ring-zinc-900" />
        )}
      </button>

      {/* Help — opens docs */}
      <a
        href="https://fabriziosalmi.github.io/mixi/guide/getting-started"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded p-0.5 text-zinc-600 hover:text-cyan-400 transition-colors"
        title="Help & Documentation"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </a>

      {/* GitHub — star on hover */}
      <GitHubStarBtn />
    </div>
    </div>
  </div>
);

// ── Quantize + MIDI Clock (moved from HudCenter) ───────────

const QuantizeBtn: FC = () => {
  const qA = useMixiStore((s) => s.decks.A.quantize);
  const qB = useMixiStore((s) => s.decks.B.quantize);
  const setQuantize = useMixiStore((s) => s.setQuantize);
  const active = qA && qB;
  const partial = qA || qB;
  const toggle = useCallback(() => { const n = !active; setQuantize('A', n); setQuantize('B', n); }, [active, setQuantize]);
  return (
    <button type="button" onClick={toggle}
      className="text-[10px] font-mono font-black rounded px-1.5 py-0.5 transition-all active:scale-95"
      style={{
        color: active ? '#000' : partial ? 'var(--status-warn)' : 'var(--txt-muted)',
        backgroundColor: active ? 'var(--status-ok)' : partial ? 'rgba(245,158,11,0.15)' : 'transparent',
        border: `1px solid ${active ? 'var(--status-ok)' : partial ? 'var(--status-warn)' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? '0 0 8px var(--status-ok)66' : 'none',
      }}
      title={`Quantize: ${active ? 'ON' : partial ? 'Partial' : 'OFF'}`}
    >Q</button>
  );
};

/** GitHub icon → morphs to star on hover. Links to repo for starring. */
const GitHubStarBtn: FC = () => {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href="https://github.com/fabriziosalmi/mixi"
      target="_blank"
      rel="noopener noreferrer"
      className="rounded p-0.5 transition-all duration-300"
      title="Star MIXI on GitHub"
      style={{
        color: hovered ? '#f5c518' : 'var(--txt-muted)',
        filter: hovered ? 'drop-shadow(0 0 6px rgba(245,197,24,0.5))' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered ? (
        /* Star icon */
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ) : (
        /* GitHub mark */
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
        </svg>
      )}
    </a>
  );
};

const MidiClockBtn: FC = () => {
  const active = useMidiClockActive();
  return (
    <button type="button" onClick={toggleMidiClock}
      className="text-[10px] font-mono font-black rounded px-1.5 py-0.5 transition-all active:scale-95"
      style={{
        color: active ? '#000' : 'var(--txt-muted)',
        backgroundColor: active ? 'var(--status-ok)' : 'transparent',
        border: `1px solid ${active ? 'var(--status-ok)' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? '0 0 8px var(--status-ok)66' : 'none',
      }}
      title={active ? 'MIDI Clock active' : 'Enable MIDI Clock'}
    >M</button>
  );
};
