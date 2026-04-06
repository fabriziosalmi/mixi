/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileBrowser — Track browser for mobile
//
// Scrollable track list with search, BPM, key display.
// Tap [A] or [B] to load a track onto a deck.
// Same store (browserStore) and same loadToDeck logic as desktop.
// ─────────────────────────────────────────────────────────────

import { useCallback, type FC } from 'react';
import { useBrowserStore, type TrackEntry } from '../../store/browserStore';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../theme';
import type { DeckId } from '../../types';

// ── Load-to-deck (same logic as desktop TrackBrowser) ────────

async function loadToDeck(track: TrackEntry, deck: DeckId) {
  try {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const res = await fetch(track.audioUrl);
    const buf = await res.arrayBuffer();
    await engine.loadTrack(deck, buf);

    const name = `${track.artist ? track.artist + ' - ' : ''}${track.title}`;
    useMixiStore.getState().setDeckTrackName(deck, name);
    useMixiStore.getState().setDeckTrackLoaded(deck, true);
  } catch {
    // silent on mobile — no log dependency
  }
}

// ── Format helpers ───────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Component ────────────────────────────────────────────────

interface MobileBrowserProps {
  maxHeight?: number | string;
}

export const MobileBrowser: FC<MobileBrowserProps> = ({ maxHeight = '100%' }) => {
  const tracks = useBrowserStore((s) => s.tracks);
  const search = useBrowserStore((s) => s.search);
  const setSearch = useBrowserStore((s) => s.setSearch);

  // Filter tracks by search
  const filtered = search
    ? tracks.filter((t) => {
        const q = search.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.key.toLowerCase().includes(q)
        );
      })
    : tracks;

  const onLoad = useCallback(
    (track: TrackEntry, deck: DeckId) => {
      loadToDeck(track, deck);
    },
    [],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        maxHeight,
        overflow: 'hidden',
        background: '#0a0a0a',
        borderRadius: 6,
        border: '1px solid #222',
      }}
    >
      {/* Search bar */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search tracks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            height: 32,
            background: '#151515',
            border: '1px solid #333',
            borderRadius: 4,
            padding: '0 8px',
            color: '#ccc',
            fontSize: 12,
            fontFamily: 'var(--font-ui)',
            outline: 'none',
          }}
        />
      </div>

      {/* Track list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: '#444',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {tracks.length === 0 ? 'No tracks — load from desktop' : 'No matches'}
          </div>
        ) : (
          filtered.map((track) => (
            <TrackRow key={track.id} track={track} onLoad={onLoad} />
          ))
        )}
      </div>
    </div>
  );
};

// ── Track row ────────────────────────────────────────────────

const TrackRow: FC<{
  track: TrackEntry;
  onLoad: (track: TrackEntry, deck: DeckId) => void;
}> = ({ track, onLoad }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 8px',
      borderBottom: '1px solid #1a1a1a',
      minHeight: 44,
    }}
  >
    {/* Info */}
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <div
        style={{
          fontSize: 12,
          color: '#ccc',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {track.title || 'Untitled'}
      </div>
      <div
        style={{
          fontSize: 10,
          color: '#666',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          gap: 8,
          marginTop: 1,
        }}
      >
        <span>{track.artist || '—'}</span>
        {track.bpm > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {track.bpm.toFixed(1)}
          </span>
        )}
        {track.key && <span>{track.key}</span>}
        {track.duration > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {formatDuration(track.duration)}
          </span>
        )}
      </div>
    </div>

    {/* Load buttons */}
    <button
      onClick={() => onLoad(track, 'A')}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        border: `1px solid ${COLOR_DECK_A}44`,
        borderRadius: 4,
        background: `${COLOR_DECK_A}11`,
        color: COLOR_DECK_A,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      A
    </button>
    <button
      onClick={() => onLoad(track, 'B')}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        border: `1px solid ${COLOR_DECK_B}44`,
        borderRadius: 4,
        background: `${COLOR_DECK_B}11`,
        color: COLOR_DECK_B,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      B
    </button>
  </div>
);
