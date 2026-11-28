/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

import { useState, useRef, useEffect, type FC } from 'react';
import { deckRegistry } from '../../decks/registry';
import type { DeckId, DeckMode } from '../../types';

interface DeckModeSelectorProps {
  deckId: DeckId;
  currentMode: DeckMode;
  color: string;
  onSelectMode: (mode: DeckMode) => void;
}

const CORE_MODES = new Set<string>(['groovebox', 'turbokick', 'js303']);

export const DeckModeSelector: FC<DeckModeSelectorProps> = ({
  deckId,
  currentMode,
  color,
  onSelectMode,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const allDecks = deckRegistry.getAll();
  const coreDecks = allDecks.filter((d) => CORE_MODES.has(d.mode));
  const communityDecks = allDecks.filter((d) => !CORE_MODES.has(d.mode));
  const activeEntry = currentMode === 'track' ? undefined : deckRegistry.findByMode(currentMode);

  const pillLabel = activeEntry ? activeEntry.label : 'TRACK';
  const pillColor = activeEntry ? activeEntry.accentColor : color;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Deck ${deckId} mode: ${pillLabel}`}
        title={`Switch Deck ${deckId} mode (${allDecks.length + 1} modes available)`}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider transition-all active:scale-95"
        style={{
          color: activeEntry ? pillColor : 'var(--txt-bright)',
          background: activeEntry ? `${pillColor}1a` : 'rgba(255,255,255,0.05)',
          border: `1px solid ${activeEntry ? `${pillColor}66` : 'rgba(255,255,255,0.12)'}`,
        }}
      >
        <span>{pillLabel}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}
          aria-hidden="true"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-[120] w-48 max-h-72 overflow-y-auto mixi-settings-scroll rounded-lg p-1.5 shadow-2xl"
          style={{
            background: '#111115',
            border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.85)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { onSelectMode('track'); setOpen(false); }}
            className="w-full flex items-center justify-between rounded px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors hover:bg-white/[0.06]"
            style={{
              color: currentMode === 'track' ? color : 'var(--txt-bright)',
              background: currentMode === 'track' ? `${color}15` : 'transparent',
            }}
          >
            <span>TRACK DECK</span>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          </button>

          <div className="px-2 pt-2 pb-1 text-[8px] font-mono uppercase tracking-widest" style={{ color: 'var(--txt-dim)' }}>
            Core Instruments ({coreDecks.length})
          </div>
          {coreDecks.map((d) => (
            <button
              key={d.mode}
              type="button"
              role="menuitem"
              onClick={() => { onSelectMode(d.mode); setOpen(false); }}
              className="w-full flex items-center justify-between rounded px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors hover:bg-white/[0.06]"
              style={{
                color: currentMode === d.mode ? d.accentColor : 'var(--txt-primary)',
                background: currentMode === d.mode ? `${d.accentColor}15` : 'transparent',
              }}
            >
              <span>{d.label}</span>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.accentColor }} />
            </button>
          ))}

          {communityDecks.length > 0 && (
            <>
              <div className="px-2 pt-2 pb-1 text-[8px] font-mono uppercase tracking-widest" style={{ color: 'var(--txt-dim)' }}>
                Pluggable Synths ({communityDecks.length})
              </div>
              {communityDecks.map((d) => (
                <button
                  key={d.mode}
                  type="button"
                  role="menuitem"
                  onClick={() => { onSelectMode(d.mode); setOpen(false); }}
                  className="w-full flex items-center justify-between rounded px-2 py-1 text-[9.5px] font-mono font-semibold uppercase tracking-wider transition-colors hover:bg-white/[0.06]"
                  style={{
                    color: currentMode === d.mode ? d.accentColor : 'var(--txt-secondary)',
                    background: currentMode === d.mode ? `${d.accentColor}15` : 'transparent',
                  }}
                >
                  <span>{d.label}</span>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.accentColor }} />
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
