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

import { useCallback, useRef, useState, type FC } from 'react';
import { useBrowserStore, type TrackEntry } from '../../store/browserStore';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../theme';
import { MobileTrackLoader } from './MobileTrackLoader';
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
        background: 'var(--m-bg)',
        borderRadius: 6,
        border: '1px solid var(--m-border)',
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
            height: 44,
            background: 'var(--m-input-bg)',
            border: '1px solid var(--m-border)',
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
          tracks.length === 0 ? (
            <MobileTrackLoader compact />
          ) : (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: '#444',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          >
            No matches
          </div>
          )
        ) : (
          filtered.map((track) => (
            <TrackRow key={track.id} track={track} onLoad={onLoad} />
          ))
        )}
      </div>
    </div>
  );
};

// ── Track row (swipeable) ───────────────────────────────────
// Swipe right → load to Deck A
// Swipe left  → load to Deck B
// Tap [A]/[B] buttons still work as fallback

const SWIPE_THRESHOLD = 60; // px to trigger

const TrackRow: FC<{
  track: TrackEntry;
  onLoad: (track: TrackEntry, deck: DeckId) => void;
}> = ({ track, onLoad }) => {
  const startXRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeHint, setSwipeHint] = useState<'A' | 'B' | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startXRef.current = e.clientX;
    setSwipeOffset(0);
    setSwipeHint(null);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    const dx = e.clientX - startXRef.current;
    setSwipeOffset(dx);
    if (dx > SWIPE_THRESHOLD) setSwipeHint('A');
    else if (dx < -SWIPE_THRESHOLD) setSwipeHint('B');
    else setSwipeHint(null);
  }, []);

  const onPointerUp = useCallback(() => {
    if (swipeHint === 'A') onLoad(track, 'A');
    else if (swipeHint === 'B') onLoad(track, 'B');
    setSwipeOffset(0);
    setSwipeHint(null);
  }, [swipeHint, track, onLoad]);

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderBottom: '1px solid var(--m-border)',
        minHeight: 44,
      }}
    >
      {/* Swipe hint backgrounds */}
      {swipeHint === 'A' && (
        <div style={{ position: 'absolute', inset: 0, background: `${COLOR_DECK_A}15`, display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 900, color: COLOR_DECK_A, fontFamily: 'var(--font-mono)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 6h8M7 3l3 3-3 3" /></svg>A
          </span>
        </div>
      )}
      {swipeHint === 'B' && (
        <div style={{ position: 'absolute', inset: 0, background: `${COLOR_DECK_B}15`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 900, color: COLOR_DECK_B, fontFamily: 'var(--font-mono)' }}>
            B<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 6H2M5 3L2 6l3 3" /></svg>
          </span>
        </div>
      )}

      {/* Content (translates with swipe) */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { setSwipeOffset(0); setSwipeHint(null); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          transform: swipeOffset !== 0 ? `translateX(${swipeOffset * 0.3}px)` : undefined,
          transition: swipeOffset === 0 ? 'transform 150ms' : 'none',
          touchAction: 'pan-y',
          position: 'relative',
          background: 'var(--m-bg)',
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

        {/* Load buttons (tap fallback) */}
        <button
          onClick={() => onLoad(track, 'A')}
          style={{
            width: 44,
            height: 44,
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
            width: 44,
            height: 44,
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
    </div>
  );
};
