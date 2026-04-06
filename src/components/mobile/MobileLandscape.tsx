/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileLandscape — Dual-deck mixing layout (landscape)
//
// ┌─────────────────────────────────────────────────────────┐
// │  ▶A  BPM:128  ═══════ WAVEFORM A ═══════  SYNC  VOL   │
// │  ▶B  BPM:126  ═══════ WAVEFORM B ═══════  SYNC  VOL   │
// │               ◄━━━━━━━ XFADER ━━━━━━━━►                │
// └─────────────────────────────────────────────────────────┘
//
// All touch targets ≥ 48×48px (Apple HIG + Material Design)
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
import type { DeckId } from '../../types';

// ── Constants ────────────────────────────────────────────────

const DECK_IDS: DeckId[] = ['A', 'B'];
const COLORS: Record<DeckId, string> = { A: COLOR_DECK_A, B: COLOR_DECK_B };

// ── DeckRow ──────────────────────────────────────────────────

const DeckRow: FC<{ deckId: DeckId }> = ({ deckId }) => {
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

  // ── Volume slider (horizontal) ──

  const volRef = useRef<HTMLDivElement>(null);

  const onVolPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const rect = volRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setVolume(deckId, ratio);
    },
    [deckId, setVolume],
  );

  const onVolPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons === 0) return;
      const rect = volRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setVolume(deckId, ratio);
    },
    [deckId, setVolume],
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        minHeight: 56,
        borderBottom: '1px solid #222',
      }}
    >
      {/* ── Play button ── */}
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
          fontSize: 20,
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

      {/* ── Track info ── */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div
          style={{
            fontSize: 11,
            color: '#666',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {trackName || `DECK ${deckId}`}
        </div>

        {/* ── Waveform ── */}
        <div style={{ marginTop: 2 }}>
          <MobileWaveform deckId={deckId} height={32} color={color} />
        </div>
      </div>

      {/* ── BPM ── */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          fontWeight: 700,
          color: color,
          minWidth: 52,
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        {bpm > 0 ? bpm.toFixed(1) : '---'}
      </div>

      {/* ── Sync button ── */}
      <button
        onClick={toggleSync}
        style={{
          width: 48,
          height: 32,
          flexShrink: 0,
          border: `1px solid ${isSynced ? '#a855f7' : '#444'}`,
          borderRadius: 6,
          background: isSynced ? '#a855f722' : 'transparent',
          color: isSynced ? '#a855f7' : '#666',
          fontSize: 11,
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

      {/* ── Volume slider ── */}
      <div
        ref={volRef}
        onPointerDown={onVolPointerDown}
        onPointerMove={onVolPointerMove}
        style={{
          width: 64,
          height: 24,
          flexShrink: 0,
          background: '#111',
          borderRadius: 4,
          position: 'relative',
          touchAction: 'none',
          cursor: 'pointer',
          border: '1px solid #333',
        }}
        aria-label={`Volume Deck ${deckId}`}
        role="slider"
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
            background: `${color}55`,
            borderRadius: 3,
            transition: 'width 30ms',
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

// ── Crossfader ───────────────────────────────────────────────

const MobileCrossfader: FC = () => {
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
      // Haptic snap at center (0.50 ± 0.02)
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
        padding: '4px 16px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 10, color: COLOR_DECK_A, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>A</span>
      <div
        ref={trackRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        style={{
          flex: 1,
          height: 28,
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
            top: 4,
            width: 1,
            height: 20,
            background: '#333',
          }}
        />
        {/* Cap */}
        <div
          style={{
            position: 'absolute',
            left: `calc(${crossfader * 100}% - 14px)`,
            top: 2,
            width: 28,
            height: 24,
            background: '#555',
            borderRadius: 4,
            border: '1px solid #777',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 12, height: 2, background: '#aaa', borderRadius: 1 }} />
        </div>
      </div>
      <span style={{ fontSize: 10, color: COLOR_DECK_B, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>B</span>
    </div>
  );
};

// ── Toolbar button ───────────────────────────────────────────

const ToolBtn: FC<{ label: string; active?: boolean; color?: string; onClick: () => void }> = ({
  label, active, color = '#888', onClick,
}) => (
  <button
    onClick={onClick}
    style={{
      height: 26,
      padding: '0 10px',
      border: `1px solid ${active ? color : '#333'}`,
      borderRadius: 4,
      background: active ? `${color}22` : 'transparent',
      color: active ? color : '#666',
      fontSize: 10,
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

// ── MobileLandscape ──────────────────────────────────────────

export const MobileLandscape: FC = () => {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayTab, setOverlayTab] = useState<OverlayTab>('eq');
  const [overlayDeck, setOverlayDeck] = useState<DeckId>('A');
  const [browserOpen, setBrowserOpen] = useState(false);

  const openOverlay = useCallback((tab: OverlayTab) => {
    setOverlayTab(tab);
    setOverlayOpen(true);
    setBrowserOpen(false);
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
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid #222',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: '#555',
            letterSpacing: 4,
            fontFamily: 'var(--font-mono)',
          }}
        >
          MIXI
        </span>
      </div>

      {/* Deck rows */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {DECK_IDS.map((id) => (
          <DeckRow key={id} deckId={id} />
        ))}
      </div>

      {/* Crossfader + toolbar */}
      <MobileCrossfader />
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          padding: '0 16px 6px',
          flexShrink: 0,
        }}
      >
        <ToolBtn label="EQ" active={overlayOpen && overlayTab === 'eq'} onClick={() => openOverlay('eq')} />
        <ToolBtn label="PADS" active={overlayOpen && overlayTab === 'pads'} onClick={() => openOverlay('pads')} />
        <ToolBtn
          label="BROWSE"
          active={browserOpen}
          onClick={() => { setBrowserOpen(!browserOpen); setOverlayOpen(false); }}
        />
        <ToolBtn
          label="PANIC"
          color="#ef4444"
          onClick={() => { mobilePanic(); }}
        />
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

      {/* Browser overlay */}
      {browserOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onClick={() => setBrowserOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
          />
          <div
            style={{
              position: 'relative',
              height: '60vh',
              background: '#0d0d0d',
              borderTop: '2px solid #33333366',
              borderRadius: '12px 12px 0 0',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: '#444' }} />
            </div>
            <div style={{ padding: '0 8px 8px', height: 'calc(100% - 20px)' }}>
              <MobileBrowser maxHeight="100%" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
