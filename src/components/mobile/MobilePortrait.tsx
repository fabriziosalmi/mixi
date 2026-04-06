/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobilePortrait — Monitor / curator mode (portrait)
//
// ┌───────────────────────────┐
// │  MIXI                     │
// │  ┌───────────────────────┐│
// │  │  DECK A               ││
// │  │  Track — BPM — ▶ SYNC││
// │  │  ══ waveform mini ══  ││
// │  │  VOL ▓▓▓▓▓░░░░░░░░░  ││
// │  └───────────────────────┘│
// │  ◄━━━━━ XFADER ━━━━━━━►  │
// │  ┌───────────────────────┐│
// │  │  DECK B               ││
// │  │  Track — BPM — ▶ SYNC││
// │  │  ══ waveform mini ══  ││
// │  │  VOL ▓▓▓▓▓░░░░░░░░░  ││
// │  └───────────────────────┘│
// └───────────────────────────┘
//
// All touch targets ≥ 48×48px
// ─────────────────────────────────────────────────────────────

import { useCallback, useRef, useState, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../theme';
import { useHaptics } from '../../hooks/useHaptics';
import { MobileWaveform } from './MobileWaveform';
import { OverlayPanel, type OverlayTab } from './overlay/OverlayPanel';
import { OverlayEQ } from './overlay/OverlayEQ';
import { OverlayPads } from './overlay/OverlayPads';
import { MobileBrowser } from './MobileBrowser';
import { mobilePanic } from './mobilePanic';
import { MobileDeckSlot } from './MobileDeckSlot';
import { MobileDeckPicker } from './MobileDeckPicker';
import type { DeckId } from '../../types';

// ── Constants ────────────────────────────────────────────────

const COLORS: Record<DeckId, string> = { A: COLOR_DECK_A, B: COLOR_DECK_B };

// ── DeckCard ─────────────────────────────────────────────────

const DeckCard: FC<{ deckId: DeckId }> = ({ deckId }) => {
  const color = COLORS[deckId];

  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);
  const trackName = useMixiStore((s) => s.decks[deckId].trackName);
  const isSynced = useMixiStore((s) => s.decks[deckId].isSynced);
  const volume = useMixiStore((s) => s.decks[deckId].volume);
  const setPlaying = useMixiStore((s) => s.setDeckPlaying);
  const syncDeck = useMixiStore((s) => s.syncDeck);
  const unsyncDeck = useMixiStore((s) => s.unsyncDeck);
  const setVolume = useMixiStore((s) => s.setDeckVolume);

  const togglePlay = useCallback(
    () => setPlaying(deckId, !isPlaying),
    [deckId, isPlaying, setPlaying],
  );

  const toggleSync = useCallback(
    () => (isSynced ? unsyncDeck(deckId) : syncDeck(deckId)),
    [deckId, isSynced, syncDeck, unsyncDeck],
  );

  // ── Volume slider ──
  const volRef = useRef<HTMLDivElement>(null);

  const onVolPointer = useCallback(
    (e: React.PointerEvent) => {
      if (e.type === 'pointerdown') {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
      if (e.type === 'pointermove' && e.buttons === 0) return;
      e.preventDefault();
      const rect = volRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setVolume(deckId, ratio);
    },
    [deckId, setVolume],
  );

  return (
    <div
      style={{
        background: '#111',
        borderRadius: 8,
        border: `1px solid ${color}33`,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* ── Header: label + track name ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: color,
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}
        >
          DECK {deckId}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: '#999',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {trackName || 'No track loaded'}
        </span>
      </div>

      {/* ── Waveform ── */}
      <MobileWaveform deckId={deckId} height={40} color={color} />

      {/* ── Controls row: Play | BPM | Sync ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={togglePlay}
          style={{
            width: 48,
            height: 48,
            flexShrink: 0,
            border: `2px solid ${isPlaying ? color : '#444'}`,
            borderRadius: '50%',
            background: isPlaying ? `${color}22` : 'transparent',
            color: isPlaying ? color : '#888',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label={`${isPlaying ? 'Pause' : 'Play'} Deck ${deckId}`}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>

        <div
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: 22,
            fontWeight: 700,
            color: color,
            textAlign: 'center',
          }}
        >
          {bpm > 0 ? bpm.toFixed(1) : '---.-'}
          <span style={{ fontSize: 10, color: '#555', marginLeft: 4 }}>BPM</span>
        </div>

        <button
          onClick={toggleSync}
          style={{
            width: 56,
            height: 36,
            flexShrink: 0,
            border: `1px solid ${isSynced ? '#a855f7' : '#444'}`,
            borderRadius: 6,
            background: isSynced ? '#a855f722' : 'transparent',
            color: isSynced ? '#a855f7' : '#666',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label={`Sync Deck ${deckId}`}
        >
          SYNC
        </button>
      </div>

      {/* ── Volume slider (horizontal) ── */}
      <div
        ref={volRef}
        onPointerDown={onVolPointer}
        onPointerMove={onVolPointer}
        style={{
          width: '100%',
          height: 24,
          background: '#0a0a0a',
          borderRadius: 4,
          position: 'relative',
          touchAction: 'none',
          cursor: 'pointer',
          border: '1px solid #222',
        }}
        role="slider"
        aria-label={`Volume Deck ${deckId}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${volume * 100}%`,
            background: `${color}44`,
            borderRadius: 3,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(${volume * 100}% - 3px)`,
            top: 2,
            width: 6,
            height: 20,
            background: color,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
};

// ── Crossfader (portrait) ────────────────────────────────────

const PortraitCrossfader: FC = () => {
  const crossfader = useMixiStore((s) => s.crossfader);
  const setCrossfader = useMixiStore((s) => s.setCrossfader);
  const trackRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const prevRef = useRef(crossfader);

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      if (e.type === 'pointerdown') {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
      if (e.type === 'pointermove' && e.buttons === 0) return;
      e.preventDefault();
      const rect = trackRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      // Haptic snap at center
      const prev = prevRef.current;
      if ((prev < 0.48 || prev > 0.52) && ratio >= 0.48 && ratio <= 0.52) {
        haptics.snap();
      }
      prevRef.current = ratio;
      setCrossfader(ratio);
    },
    [setCrossfader, haptics],
  );

  return (
    <div
      style={{
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 12, color: COLOR_DECK_A, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>A</span>
      <div
        ref={trackRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        style={{
          flex: 1,
          height: 32,
          background: '#111',
          borderRadius: 6,
          position: 'relative',
          touchAction: 'none',
          cursor: 'pointer',
          border: '1px solid #333',
        }}
        role="slider"
        aria-label="Crossfader"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(crossfader * 100)}
      >
        {/* Center mark */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 5,
            width: 1,
            height: 22,
            background: '#333',
          }}
        />
        {/* Cap */}
        <div
          style={{
            position: 'absolute',
            left: `calc(${crossfader * 100}% - 16px)`,
            top: 2,
            width: 32,
            height: 28,
            background: '#555',
            borderRadius: 4,
            border: '1px solid #777',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 14, height: 2, background: '#aaa', borderRadius: 1 }} />
        </div>
      </div>
      <span style={{ fontSize: 12, color: COLOR_DECK_B, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>B</span>
    </div>
  );
};

// ── Deck area (routes track vs custom) ───────────────────────

const PortraitDeckArea: FC<{
  deckId: DeckId;
  openOverlay: (tab: OverlayTab, deck: DeckId) => void;
}> = ({ deckId, openOverlay }) => {
  const mode = useMixiStore((s) => s.deckModes[deckId]);
  const color = deckId === 'A' ? COLOR_DECK_A : COLOR_DECK_B;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <MobileDeckPicker deckId={deckId} />
        <div style={{ flex: 1 }} />
        {mode === 'track' && (
          <>
            <PortraitToolBtn label="EQ" onClick={() => openOverlay('eq', deckId)} />
            <PortraitToolBtn label="PADS" onClick={() => openOverlay('pads', deckId)} />
          </>
        )}
      </div>
      {mode === 'track'
        ? <DeckCard deckId={deckId} />
        : <MobileDeckSlot deckId={deckId} color={color} />
      }
    </div>
  );
};

// ── MobilePortrait ───────────────────────────────────────────

export const MobilePortrait: FC = () => {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayTab, setOverlayTab] = useState<OverlayTab>('eq');
  const [overlayDeck, setOverlayDeck] = useState<DeckId>('A');

  const openOverlay = useCallback((tab: OverlayTab, deck: DeckId) => {
    setOverlayTab(tab);
    setOverlayDeck(deck);
    setOverlayOpen(true);
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0a0a0a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'var(--font-ui)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: '1px solid #222',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 48 }} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#555',
            letterSpacing: 6,
            fontFamily: 'var(--font-mono)',
          }}
        >
          MIXI
        </span>
        <button
          onClick={() => mobilePanic()}
          style={{
            width: 48,
            height: 24,
            border: '1px solid #ef444466',
            borderRadius: 4,
            background: 'transparent',
            color: '#ef4444',
            fontSize: 9,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          PANIC
        </button>
      </div>

      {/* Decks + Crossfader */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 12px',
          flexShrink: 0,
        }}
      >
        {/* Deck A */}
        <PortraitDeckArea deckId="A" openOverlay={openOverlay} />
        <PortraitCrossfader />
        {/* Deck B */}
        <PortraitDeckArea deckId="B" openOverlay={openOverlay} />
      </div>

      {/* Browser (bottom half) */}
      <div
        style={{
          flex: 1,
          padding: '4px 12px 8px',
          overflow: 'hidden',
        }}
      >
        <MobileBrowser maxHeight="100%" />
      </div>

      {/* Overlay */}
      <OverlayPanel
        isOpen={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        activeDeck={overlayDeck}
        onDeckSwitch={setOverlayDeck}
        activeTab={overlayTab}
        onTabChange={setOverlayTab}
      >
        {overlayTab === 'eq' && <OverlayEQ deckId={overlayDeck} />}
        {overlayTab === 'pads' && <OverlayPads deckId={overlayDeck} />}
      </OverlayPanel>
    </div>
  );
};

// ── Portrait tool button ─────────────────────────────────────

const PortraitToolBtn: FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      height: 22,
      padding: '0 8px',
      border: '1px solid #333',
      borderRadius: 3,
      background: 'transparent',
      color: '#666',
      fontSize: 9,
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      cursor: 'pointer',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
    }}
  >
    {label}
  </button>
);
