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

import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { COLOR_DECK_A, COLOR_DECK_B, CUE_COLORS } from '../../theme';
import { useHaptics } from '../../hooks/useHaptics';
import { MobileWaveform } from './MobileWaveform';
import { MobileVuMeter } from './MobileVuMeter';
import { MobileWaveformOverview } from './MobileWaveformOverview';
import { OverlayPanel, type OverlayTab } from './overlay/OverlayPanel';
import { OverlayEQ } from './overlay/OverlayEQ';
import { OverlayPads } from './overlay/OverlayPads';
import { OverlayFX } from './overlay/OverlayFX';
import { OverlayHeadphones } from './overlay/OverlayHeadphones';
import { MobileBrowser } from './MobileBrowser';
import { MobileTrackLoader } from './MobileTrackLoader';
import { mobilePanic } from './mobilePanic';
import { MobileDeckSlot } from './MobileDeckSlot';
import { MobileDeckPicker } from './MobileDeckPicker';
import type { DeckId } from '../../types';

// ── Constants ────────────────────────────────────────────────

const COLORS: Record<DeckId, string> = { A: COLOR_DECK_A, B: COLOR_DECK_B };

// ── Time formatter ──────────────────────────────────────────

function fmtTime(s: number): string {
  if (s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function useCurrentTime(deckId: DeckId): number {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const tick = () => {
      const engine = MixiEngine.getInstance();
      setTime(engine.isInitialized ? engine.getCurrentTime(deckId) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deckId]);
  return time;
}

// ── DeckCard ─────────────────────────────────────────────────

const DeckCard: FC<{ deckId: DeckId }> = ({ deckId }) => {
  const color = COLORS[deckId];

  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);
  const trackName = useMixiStore((s) => s.decks[deckId].trackName);
  const isSynced = useMixiStore((s) => s.decks[deckId].isSynced);
  const volume = useMixiStore((s) => s.decks[deckId].volume);
  const musicalKey = useMixiStore((s) => s.decks[deckId].musicalKey);
  const duration = useMixiStore((s) => s.decks[deckId].duration);
  const hotCues = useMixiStore((s) => s.decks[deckId].hotCues);
  const activeLoop = useMixiStore((s) => s.decks[deckId].activeLoop);
  const setPlaying = useMixiStore((s) => s.setDeckPlaying);
  const syncDeck = useMixiStore((s) => s.syncDeck);
  const unsyncDeck = useMixiStore((s) => s.unsyncDeck);
  const setVolume = useMixiStore((s) => s.setDeckVolume);

  const currentTime = useCurrentTime(deckId);
  const cueCount = hotCues.filter((c) => c !== null).length;
  const haptics = useHaptics();

  const togglePlay = useCallback(
    () => { setPlaying(deckId, !isPlaying); haptics.tick(); },
    [deckId, isPlaying, setPlaying, haptics],
  );

  const toggleSync = useCallback(
    () => { isSynced ? unsyncDeck(deckId) : syncDeck(deckId); haptics.snap(); },
    [deckId, isSynced, syncDeck, unsyncDeck, haptics],
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
      className={isPlaying ? 'm-deck-card-playing' : 'm-deck-card'}
      style={{
        background: '#111',
        borderRadius: 8,
        border: `1px solid ${color}33`,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        '--m-glow': color,
      } as React.CSSProperties}
    >
      {/* ── Header: label + track name + cue dots + loop ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: color,
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}
        >
          {deckId}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 11,
            color: '#888',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {trackName || 'No track loaded'}
        </span>
        {/* Hot cue indicators */}
        {cueCount > 0 && (
          <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {hotCues.slice(0, 4).map((c, i) => (
              <span key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: c !== null ? CUE_COLORS[i % CUE_COLORS.length] : '#333',
              }} />
            ))}
          </span>
        )}
        {activeLoop && (
          <span style={{ fontSize: 8, color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0 }}>
            LOOP
          </span>
        )}
      </div>

      {/* ── Waveform overview + scrolling waveform ── */}
      <MobileWaveformOverview deckId={deckId} color={color} />
      <div
        className={isPlaying ? 'm-waveform-glow' : undefined}
        style={{ borderRadius: 4, overflow: 'hidden', border: activeLoop ? '1px solid #22c55e44' : `1px solid ${color}18`, '--m-glow': color } as React.CSSProperties}
      >
        <MobileWaveform deckId={deckId} height={48} color={color} />
      </div>
      <MobileVuMeter deckId={deckId} color={color} />

      {/* ── Controls row: Play | BPM+Key | Time | Sync ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          className={isPlaying ? 'm-play-active' : undefined}
          onClick={togglePlay}
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            border: `2px solid ${isPlaying ? color : '#444'}`,
            borderRadius: '50%',
            background: isPlaying ? `${color}22` : 'transparent',
            color: isPlaying ? color : '#888',
            fontSize: 16,
            '--m-glow': color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          } as React.CSSProperties}
          aria-label={`${isPlaying ? 'Pause' : 'Play'} Deck ${deckId}`}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>

        {/* BPM + key */}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span
            className={isPlaying ? 'm-glow-text' : undefined}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color, '--m-glow': color } as React.CSSProperties}
          >
            {bpm > 0 ? bpm.toFixed(1) : '---.-'}
          </span>
          {musicalKey && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#888', marginLeft: 6, fontWeight: 600 }}>
              {musicalKey}
            </span>
          )}
        </div>

        {/* Elapsed / duration */}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#555', flexShrink: 0 }}>
          {fmtTime(currentTime)}/{fmtTime(duration)}
        </span>

        <button
          className={isSynced ? 'm-synced' : undefined}
          onClick={toggleSync}
          style={{
            width: 48,
            height: 36,
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
            <PortraitToolBtn label="FX" onClick={() => openOverlay('fx', deckId)} />
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
  const [loaderOpen, setLoaderOpen] = useState(false);

  const openOverlay = useCallback((tab: OverlayTab, deck: DeckId) => {
    setOverlayTab(tab);
    setOverlayDeck(deck);
    setOverlayOpen(true);
    setLoaderOpen(false);
  }, []);

  return (
    <div
      className="m-noise"
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
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
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
        <button
          onClick={() => setLoaderOpen(!loaderOpen)}
          style={{
            width: 48,
            height: 28,
            border: `1px solid ${loaderOpen ? '#888' : '#333'}`,
            borderRadius: 4,
            background: loaderOpen ? '#ffffff11' : 'transparent',
            color: loaderOpen ? '#aaa' : '#666',
            fontSize: 18,
            fontWeight: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label="Add tracks"
        >
          +
        </button>
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

      {/* Decks + Crossfader — scrollable on small screens */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 12px',
          flexShrink: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
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

      {/* Loader overlay */}
      {loaderOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            onClick={() => setLoaderOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}
          />
          <div
            style={{
              position: 'relative',
              background: 'rgba(10,10,10,0.72)',
              backdropFilter: 'blur(16px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
              borderRadius: 12,
              border: '1px solid #333',
              padding: 8,
              minWidth: 280,
            }}
          >
            <MobileTrackLoader />
          </div>
        </div>
      )}

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
        {overlayTab === 'fx' && <OverlayFX deckId={overlayDeck} />}
        {overlayTab === 'hp' && <OverlayHeadphones />}
      </OverlayPanel>
    </div>
  );
};

// ── Portrait tool button ─────────────────────────────────────

const PortraitToolBtn: FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      height: 40,
      minWidth: 48,
      padding: '0 12px',
      border: '1px solid #333',
      borderRadius: 6,
      background: 'transparent',
      color: '#666',
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
