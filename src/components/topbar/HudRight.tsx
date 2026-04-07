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

import type { FC } from 'react';
import { RecPanel } from '../hud/RecPanel';
import { SkinSelector } from '../hud/SkinSelector';

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
  <div
    className="flex items-center gap-2 justify-self-end rounded-md px-3 py-1 overflow-hidden"
    style={{
      background: 'rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
    }}
  >
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
    </div>
  </div>
);
