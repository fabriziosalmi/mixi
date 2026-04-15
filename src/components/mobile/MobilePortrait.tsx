/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobilePortrait — Single-deck focus with mini-strip for the
// other deck. Tap deck indicator to switch. Crossfader pinned
// at the bottom for thumb access.
//
// ┌───────────────────────────┐
// │  [+]   A ● ○ B    MIXI   │
// ├───────────────────────────┤
// │  FOCUS DECK — big card    │
// │  waveform, BPM, controls │
// │  EQ / FX / PADS toolbar  │
// ├───────────────────────────┤
// │  mini-strip: other deck   │
// ├───────────────────────────┤
// │  ◄━━━ CROSSFADER ━━━━━►  │
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
import { MobileTrackLoader } from './MobileTrackLoader';
import { mobilePanic } from './mobilePanic';
import { MobileDeckSlot } from './MobileDeckSlot';
import { MobileDeckPicker } from './MobileDeckPicker';
import type { DeckId } from '../../types';

// ── Constants ────────────────────────────────────────────────

const COLORS: Record<DeckId, string> = { A: COLOR_DECK_A, B: COLOR_DECK_B };

// ── Beat pulse hook ─────────────────────────────────────────

function useBeatPulse(deckId: DeckId, isPlaying: boolean): boolean {
  const [pulse, setPulse] = useState(false);
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);
  useEffect(() => {
    if (!isPlaying || bpm <= 0) return;
    const interval = 60000 / bpm;
    const id = setInterval(() => {
      setPulse(true);
      setTimeout(() => setPulse(false), 200);
    }, interval);
    return () => clearInterval(id);
  }, [isPlaying, bpm]);
  return pulse;
}

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

// ── FocusDeck — the big hero card ───────────────────────────

const FocusDeck: FC<{
  deckId: DeckId;
  openOverlay: (tab: OverlayTab, deck: DeckId) => void;
}> = ({ deckId, openOverlay }) => {
  const color = COLORS[deckId];
  const mode = useMixiStore((s) => s.deckModes[deckId]);

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
  const beatPulse = useBeatPulse(deckId, isPlaying);
  const hasTrack = !!trackName;

  const togglePlay = useCallback(
    () => { setPlaying(deckId, !isPlaying); haptics.tick(); },
    [deckId, isPlaying, setPlaying, haptics],
  );

  const toggleSync = useCallback(
    () => { if (isSynced) unsyncDeck(deckId); else syncDeck(deckId); haptics.snap(); },
    [deckId, isSynced, syncDeck, unsyncDeck, haptics],
  );

  const volRef = useRef<HTMLDivElement>(null);
  const onVolPointer = useCallback(
    (e: React.PointerEvent) => {
      if (e.type === 'pointerdown') (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (e.type === 'pointermove' && e.buttons === 0) return;
      e.preventDefault();
      const rect = volRef.current!.getBoundingClientRect();
      setVolume(deckId, Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    },
    [deckId, setVolume],
  );

  // Non-track mode (groovebox, etc.)
  if (mode !== 'track') {
    return (
      <div style={{ padding: '8px 0' }}>
        <MobileDeckSlot deckId={deckId} color={color} />
      </div>
    );
  }

  // Empty state
  if (!hasTrack) {
    return (
      <div
        className="m-deck-card m-deck-accent"
        style={{
          background: 'var(--m-surface)',
          borderRadius: 14,
          border: `1px solid ${color}22`,
          padding: '40px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          '--m-glow': color,
        } as React.CSSProperties}
      >
        <div className="m-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </div>
        <span style={{ fontSize: 13, color: 'var(--m-text-3)', fontFamily: 'var(--font-ui)', textAlign: 'center', lineHeight: 1.5 }}>
          Tap <span style={{ color: 'var(--m-text-2)', fontWeight: 600 }}>+</span> to load a track
        </span>
      </div>
    );
  }

  return (
    <div
      className={`${isPlaying ? 'm-deck-card-playing' : 'm-deck-card'} m-deck-accent${beatPulse ? ' m-beat-pulse' : ''}`}
      style={{
        background: 'var(--m-surface)',
        borderRadius: 14,
        border: `1px solid ${color}33`,
        padding: '12px 14px 12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        '--m-glow': color,
        '--m-glow-dim': `${color}33`,
      } as React.CSSProperties}
    >
      {/* ── Header: track name + cue dots + loop ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            flex: 1,
            fontSize: 14,
            color: 'var(--m-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontWeight: 600,
          }}
        >
          {trackName}
        </span>
        {cueCount > 0 && (
          <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {hotCues.slice(0, 8).map((c, i) => (
              <span key={i} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: c !== null ? CUE_COLORS[i % CUE_COLORS.length] : '#333',
                boxShadow: c !== null ? `0 0 4px ${CUE_COLORS[i % CUE_COLORS.length]}44` : 'none',
              }} />
            ))}
          </span>
        )}
        {activeLoop && (
          <span style={{ fontSize: 9, color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0, textShadow: '0 0 6px #22c55e44' }}>
            LOOP
          </span>
        )}
      </div>

      {/* ── Waveform overview ── */}
      <MobileWaveformOverview deckId={deckId} color={color} />

      {/* ── Main waveform (tall for portrait focus) ── */}
      <div
        className={isPlaying ? 'm-waveform-glow' : undefined}
        style={{ borderRadius: 8, overflow: 'hidden', border: activeLoop ? '1px solid #22c55e44' : `1px solid ${color}18`, '--m-glow': color } as React.CSSProperties}
      >
        <MobileWaveform deckId={deckId} height={64} color={color} />
      </div>

      {/* ── VU meter ── */}
      <MobileVuMeter deckId={deckId} color={color} />

      {/* ── BPM hero + transport ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className={isPlaying ? 'm-play-active' : undefined}
          onClick={togglePlay}
          style={{
            width: 52,
            height: 52,
            flexShrink: 0,
            border: `2px solid ${isPlaying ? color : 'transparent'}`,
            borderRadius: '50%',
            background: isPlaying ? `${color}22` : 'var(--m-btn)',
            color: isPlaying ? color : 'var(--m-text-2)',
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
          {isPlaying
            ? <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" /></svg>
            : <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11l9-5.5z" /></svg>}
        </button>

        {/* BPM hero */}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span
            className={isPlaying ? 'm-glow-text' : undefined}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 800, color, letterSpacing: 1, '--m-glow': color } as React.CSSProperties}
          >
            {bpm > 0 ? bpm.toFixed(1) : '---.-'}
          </span>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {musicalKey && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--m-text-2)', fontWeight: 600 }}>
                {musicalKey}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#555' }}>
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>
          </div>
        </div>

        <button
          className={isSynced ? 'm-synced' : undefined}
          onClick={toggleSync}
          style={{
            width: 52,
            height: 40,
            flexShrink: 0,
            border: 'none',
            borderRadius: 10,
            background: isSynced ? '#a855f733' : 'var(--m-btn)',
            color: isSynced ? '#a855f7' : 'var(--m-text-3)',
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

      {/* ── Inline toolbar: EQ / FX / PADS / HP ── */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['eq', 'fx', 'pads', 'hp'] as OverlayTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => openOverlay(tab, deckId)}
            style={{
              flex: 1,
              height: 36,
              border: '1px solid var(--m-border)',
              borderRadius: 8,
              background: 'var(--m-btn)',
              color: 'var(--m-text-2)',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              letterSpacing: 1,
            }}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── Volume slider ── */}
      <div
        ref={volRef}
        onPointerDown={onVolPointer}
        onPointerMove={onVolPointer}
        style={{
          width: '100%',
          height: 28,
          background: 'var(--m-bg)',
          borderRadius: 6,
          position: 'relative',
          touchAction: 'none',
          cursor: 'pointer',
          border: '1px solid var(--m-border)',
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
            background: `linear-gradient(90deg, ${color}22 0%, ${color}55 100%)`,
            borderRadius: 5,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(${volume * 100}% - 4px)`,
            top: 3,
            width: 8,
            height: 22,
            background: color,
            borderRadius: 3,
            boxShadow: `0 0 6px ${color}44`,
          }}
        />
      </div>
    </div>
  );
};

// ── MiniDeckStrip — compact strip for the non-focused deck ──

const MiniDeckStrip: FC<{
  deckId: DeckId;
  onTap: () => void;
}> = ({ deckId, onTap }) => {
  const color = COLORS[deckId];
  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);
  const trackName = useMixiStore((s) => s.decks[deckId].trackName);
  const volume = useMixiStore((s) => s.decks[deckId].volume);
  const haptics = useHaptics();

  return (
    <button
      onClick={() => { onTap(); haptics.tick(); }}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--m-surface)',
        border: `1px solid ${color}22`,
        borderRadius: 10,
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Accent dot */}
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: isPlaying ? color : `${color}55`,
        boxShadow: isPlaying ? `0 0 6px ${color}66` : 'none',
        flexShrink: 0,
        transition: 'all 200ms',
      }} />

      {/* Deck label */}
      <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
        {deckId}
      </span>

      {/* Track name */}
      <span style={{
        flex: 1,
        fontSize: 11,
        color: 'var(--m-text-2)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textAlign: 'left',
      }}>
        {trackName || 'No track'}
      </span>

      {/* BPM */}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: isPlaying ? color : '#555', flexShrink: 0 }}>
        {bpm > 0 ? bpm.toFixed(1) : '---'}
      </span>

      {/* Mini volume bar */}
      <div style={{
        width: 32,
        height: 4,
        borderRadius: 2,
        background: '#222',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        <div style={{ width: `${volume * 100}%`, height: '100%', background: `${color}88`, borderRadius: 2 }} />
      </div>

      {/* Play state */}
      <span style={{ fontSize: 10, color: isPlaying ? color : '#555', flexShrink: 0 }}>
        {isPlaying
          ? <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" /></svg>
          : <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11l9-5.5z" /></svg>}
      </span>
    </button>
  );
};

// ── Crossfader ──────────────────────────────────────────────

const PortraitCrossfader: FC = () => {
  const crossfader = useMixiStore((s) => s.crossfader);
  const setCrossfader = useMixiStore((s) => s.setCrossfader);
  const trackRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const prevRef = useRef(crossfader);

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      if (e.type === 'pointerdown') (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (e.type === 'pointermove' && e.buttons === 0) return;
      e.preventDefault();
      const rect = trackRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const prev = prevRef.current;
      if ((prev < 0.48 || prev > 0.52) && ratio >= 0.48 && ratio <= 0.52) haptics.snap();
      prevRef.current = ratio;
      setCrossfader(ratio);
    },
    [setCrossfader, haptics],
  );

  return (
    <div style={{ padding: '6px 16px 2px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <span style={{ fontSize: 12, color: COLOR_DECK_A, fontWeight: 800, fontFamily: 'var(--font-mono)', textShadow: `0 0 8px ${COLOR_DECK_A}33` }}>A</span>
      <div
        ref={trackRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        style={{
          flex: 1,
          height: 36,
          background: 'var(--m-surface)',
          borderRadius: 10,
          position: 'relative',
          touchAction: 'none',
          cursor: 'pointer',
          border: '1px solid var(--m-border)',
        }}
        role="slider"
        aria-label="Crossfader"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(crossfader * 100)}
      >
        {/* Center mark */}
        <div style={{ position: 'absolute', left: 'calc(50% - 0.5px)', top: 5, width: 1, height: 26, background: '#444', boxShadow: '0 0 4px rgba(168,85,247,0.15)' }} />
        {/* Cap */}
        <div
          className={`m-xfader-cap${Math.abs(crossfader - 0.5) < 0.03 ? ' m-xfader-center' : ''}`}
          style={{
            position: 'absolute',
            left: `calc(${crossfader * 100}% - 20px)`,
            top: 3,
            width: 40,
            height: 30,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div className="m-xfader-cap-grip">
            <span /><span /><span />
          </div>
        </div>
      </div>
      <span style={{ fontSize: 12, color: COLOR_DECK_B, fontWeight: 800, fontFamily: 'var(--font-mono)', textShadow: `0 0 8px ${COLOR_DECK_B}33` }}>B</span>
    </div>
  );
};

// ── MobilePortrait ──────────────────────────────────────────

export const MobilePortrait: FC = () => {
  const [focusDeck, setFocusDeck] = useState<DeckId>('A');
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayTab, setOverlayTab] = useState<OverlayTab>('eq');
  const [overlayDeck, setOverlayDeck] = useState<DeckId>('A');
  const [loaderOpen, setLoaderOpen] = useState(false);

  const otherDeck: DeckId = focusDeck === 'A' ? 'B' : 'A';
  const haptics = useHaptics();

  const switchDeck = useCallback((d: DeckId) => {
    setFocusDeck(d);
    haptics.snap();
  }, [haptics]);

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
        background: 'var(--m-bg)',
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
      {/* ── Header ── */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid var(--m-border)',
          flexShrink: 0,
          gap: 8,
        }}
      >
        {/* Load tracks button */}
        <button
          onClick={() => setLoaderOpen(!loaderOpen)}
          style={{
            width: 36,
            height: 28,
            border: 'none',
            borderRadius: 8,
            background: loaderOpen ? 'var(--m-surface-3)' : 'var(--m-btn)',
            color: loaderOpen ? 'var(--m-text)' : 'var(--m-text-3)',
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

        <MobileDeckPicker deckId={focusDeck} />

        {/* Deck A/B switcher — center */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 4, alignItems: 'center' }}>
          {(['A', 'B'] as DeckId[]).map((d) => {
            const c = COLORS[d];
            const isFocus = d === focusDeck;
            return (
              <button
                key={d}
                onClick={() => switchDeck(d)}
                style={{
                  width: 40,
                  height: 28,
                  border: `1.5px solid ${isFocus ? c : '#333'}`,
                  borderRadius: 8,
                  background: isFocus ? `${c}22` : 'transparent',
                  color: isFocus ? c : '#555',
                  fontSize: 12,
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'all 200ms',
                  boxShadow: isFocus ? `0 0 8px ${c}22` : 'none',
                }}
              >
                {d}
              </button>
            );
          })}
        </div>

        {/* MIXI branding */}
        <span style={{ fontSize: 12, fontWeight: 700, color: '#444', letterSpacing: 4, fontFamily: 'var(--font-mono)' }}>
          MIXI
        </span>

        {/* Panic */}
        <button
          onClick={() => mobilePanic()}
          style={{
            width: 36,
            height: 24,
            border: 'none',
            borderRadius: 6,
            background: '#ef444418',
            color: '#ef4444',
            fontSize: 8,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            letterSpacing: 1,
          }}
        >
          RST
        </button>
      </div>

      {/* ── Main content ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '8px 12px 0',
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Focus deck — hero card */}
        <FocusDeck deckId={focusDeck} openOverlay={openOverlay} />

        {/* Mini strip for the other deck — tap to switch */}
        <MiniDeckStrip deckId={otherDeck} onTap={() => switchDeck(otherDeck)} />
      </div>

      {/* ── Crossfader — pinned at bottom ── */}
      <PortraitCrossfader />

      {/* ── Overlays ── */}

      {loaderOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <div onClick={() => setLoaderOpen(false)} className="m-overlay-backdrop-enter" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div className="m-overlay-enter" style={{
            position: 'relative',
            background: 'rgba(10,10,10,0.72)',
            backdropFilter: 'blur(16px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            borderRadius: 16,
            border: '1px solid var(--m-border)',
            padding: 8,
            minWidth: 280,
          }}>
            <MobileTrackLoader />
          </div>
        </div>
      )}

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
