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
import { OverlaySettings } from './overlay/OverlaySettings';
import { MobileRecPanel } from './MobileRecPanel';
import { MobilePitchFader } from './MobilePitchFader';
import { MobileBrowser } from './MobileBrowser';
import { MobileTrackLoader } from './MobileTrackLoader';
import { mobilePanic } from './mobilePanic';
import { MobileDeckSlot } from './MobileDeckSlot';
import { MobileDeckPicker } from './MobileDeckPicker';
import type { DeckId } from '../../types';

// ── Constants ────────────────────────────────────────────────

const DECK_IDS: DeckId[] = ['A', 'B'];
const COLORS: Record<DeckId, string> = { A: COLOR_DECK_A, B: COLOR_DECK_B };

// ── DeckRow ──────────────────────────────────────────────────

// ── NudgeBtn — press-and-hold pitch bend ────────────────────

const NUDGE_AMOUNT = 0.03; // ±3% pitch bend while held

const NudgeBtn: FC<{ deckId: DeckId; direction: -1 | 1; color: string }> = ({ deckId, direction, color }) => {
  const setPlaybackRate = useMixiStore((s) => s.setDeckPlaybackRate);
  const baseRateRef = useRef(1.0);
  const haptics = useHaptics();

  const onDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    baseRateRef.current = useMixiStore.getState().decks[deckId].playbackRate;
    setPlaybackRate(deckId, baseRateRef.current + direction * NUDGE_AMOUNT);
    haptics.tick();
  }, [deckId, direction, setPlaybackRate, haptics]);

  const onUp = useCallback(() => {
    setPlaybackRate(deckId, baseRateRef.current);
  }, [deckId, setPlaybackRate]);

  return (
    <button
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        width: 24,
        height: 24,
        border: '1px solid #444',
        borderRadius: 4,
        background: '#1a1a1a',
        color: color,
        fontSize: 12,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
      aria-label={`Nudge ${direction > 0 ? 'faster' : 'slower'} Deck ${deckId}`}
    >
      {direction > 0 ? '›' : '‹'}
    </button>
  );
};

// ── Time formatter ──────────────────────────────────────────

function fmtTime(s: number): string {
  if (s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── useCurrentTime — 1 Hz elapsed time for a deck ──────────

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

const DeckRow: FC<{ deckId: DeckId }> = ({ deckId }) => {
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

  const haptics = useHaptics();

  const togglePlay = useCallback(
    () => { setPlaying(deckId, !isPlaying); haptics.tick(); },
    [deckId, isPlaying, setPlaying, haptics],
  );

  const toggleSync = useCallback(
    () => { isSynced ? unsyncDeck(deckId) : syncDeck(deckId); haptics.snap(); },
    [deckId, isSynced, syncDeck, unsyncDeck, haptics],
  );

  // ── Volume slider (vertical) ──

  const volRef = useRef<HTMLDivElement>(null);

  const onVolPointer = useCallback(
    (e: React.PointerEvent) => {
      if (e.type === 'pointerdown') {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
      if (e.type === 'pointermove' && e.buttons === 0) return;
      e.preventDefault();
      const rect = volRef.current!.getBoundingClientRect();
      // Vertical: bottom=0, top=1
      const ratio = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      setVolume(deckId, ratio);
    },
    [deckId, setVolume],
  );

  const cueCount = hotCues.filter((c) => c !== null).length;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 6,
        padding: '3px 8px',
        flex: 1,
        borderBottom: '1px solid #222',
        position: 'relative',
      }}
    >
      {/* ── Left: play + nudge row ── */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 2, flexShrink: 0, width: 52 }}>
        <button
          className={isPlaying ? 'm-play-active' : undefined}
          onClick={togglePlay}
          style={{
            width: 40,
            height: 40,
            border: `2px solid ${isPlaying ? color : '#444'}`,
            borderRadius: '50%',
            background: isPlaying ? `${color}22` : 'transparent',
            color: isPlaying ? color : '#888',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            // @ts-expect-error CSS custom property for glow color
            '--m-glow': `${color}`,
          }}
          aria-label={`${isPlaying ? 'Pause' : 'Play'} Deck ${deckId}`}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <div style={{ display: 'flex', gap: 2 }}>
          <NudgeBtn deckId={deckId} direction={-1} color={color} />
          <NudgeBtn deckId={deckId} direction={1} color={color} />
        </div>
      </div>

      {/* ── Center: track info + waveform ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
        {/* Track info row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 14 }}>
          <span style={{ fontSize: 10, color: '#888', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {trackName || `DECK ${deckId}`}
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
          {/* Loop indicator */}
          {activeLoop && (
            <span style={{ fontSize: 9, color: '#22c55e', fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0 }}>
              LOOP
            </span>
          )}
        </div>

        {/* Waveform overview + scrolling waveform */}
        <MobileWaveformOverview deckId={deckId} color={color} />
        <div
          className={isPlaying ? 'm-waveform-glow' : undefined}
          style={{ borderRadius: 4, overflow: 'hidden', border: activeLoop ? '1px solid #22c55e44' : `1px solid ${color}18`, '--m-glow': color } as React.CSSProperties}
        >
          <MobileWaveform deckId={deckId} height={44} color={color} />
        </div>
        <MobileVuMeter deckId={deckId} color={color} />

        {/* Bottom info: BPM + key + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 12 }}>
          <span
            className={isPlaying ? 'm-glow-text' : undefined}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color, '--m-glow': color } as React.CSSProperties}
          >
            {bpm > 0 ? bpm.toFixed(1) : '---'}
          </span>
          {musicalKey && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#888', fontWeight: 600 }}>
              {musicalKey}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#555' }}>
            {fmtTime(currentTime)}/{fmtTime(duration)}
          </span>
        </div>
      </div>

      {/* ── Right: sync + volume + pitch ── */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'stretch', flexShrink: 0 }}>
      {/* Pitch fader */}
      <MobilePitchFader deckId={deckId} color={color} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
        <button
          className={isSynced ? 'm-synced' : undefined}
          onClick={toggleSync}
          style={{
            width: 48,
            height: 32,
            border: `1px solid ${isSynced ? '#a855f7' : '#444'}`,
            borderRadius: 4,
            background: isSynced ? '#a855f722' : 'transparent',
            color: isSynced ? '#a855f7' : '#666',
            fontSize: 10,
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

        {/* Vertical volume slider */}
        <div
          ref={volRef}
          onPointerDown={onVolPointer}
          onPointerMove={onVolPointer}
          style={{
            width: 24,
            flex: 1,
            minHeight: 30,
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
              bottom: 0,
              width: '100%',
              height: `${volume * 100}%`,
              background: `${color}55`,
              borderRadius: 3,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 3,
              bottom: `calc(${volume * 100}% - 3px)`,
              width: 20,
              height: 6,
              background: color,
              borderRadius: 2,
            }}
          />
        </div>
      </div>
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
        padding: '2px 12px 4px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 9, color: COLOR_DECK_A, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>A</span>
      <div
        ref={trackRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        style={{
          flex: 1,
          height: 24,
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
            top: 3,
            width: 1,
            height: 18,
            background: '#333',
          }}
        />
        {/* Cap */}
        <div
          className={Math.abs(crossfader - 0.5) < 0.03 ? 'm-xfader-center' : undefined}
          style={{
            position: 'absolute',
            left: `calc(${crossfader * 100}% - 12px)`,
            top: 2,
            width: 24,
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
      <span style={{ fontSize: 9, color: COLOR_DECK_B, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>B</span>
    </div>
  );
};

// ── Deck area (routes track vs custom) ───────────────────────

const LandscapeDeckArea: FC<{ deckId: DeckId }> = ({ deckId }) => {
  const mode = useMixiStore((s) => s.deckModes[deckId]);
  const color = COLORS[deckId];

  if (mode !== 'track') {
    return (
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #222' }}>
        <MobileDeckSlot deckId={deckId} color={color} />
      </div>
    );
  }

  return <DeckRow deckId={deckId} />;
};

// ── Toolbar button ───────────────────────────────────────────

const ToolBtn: FC<{ label: string; active?: boolean; color?: string; onClick: () => void }> = ({
  label, active, color = '#888', onClick,
}) => (
  <button
    className={active ? 'm-tool-active' : undefined}
    onClick={onClick}
    style={{
      height: 32,
      minWidth: 40,
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
      // @ts-expect-error CSS custom property
      '--m-glow': active ? color : undefined,
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
  const [loaderOpen, setLoaderOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [orientationLocked, setOrientationLocked] = useState(false);

  const openOverlay = useCallback((tab: OverlayTab) => {
    setOverlayTab(tab);
    setOverlayOpen(true);
    setBrowserOpen(false);
    setLoaderOpen(false);
    setSettingsOpen(false);
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
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          gap: 6,
          borderBottom: '1px solid #222',
          flexShrink: 0,
        }}
      >
        <MobileDeckPicker deckId="A" />
        <button
          onClick={() => { setSettingsOpen(!settingsOpen); setBrowserOpen(false); setLoaderOpen(false); setOverlayOpen(false); }}
          style={{
            width: 28,
            height: 28,
            border: `1px solid ${settingsOpen ? '#888' : '#333'}`,
            borderRadius: 4,
            background: settingsOpen ? '#ffffff11' : 'transparent',
            color: settingsOpen ? '#aaa' : '#555',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label="Settings"
        >
          ⚙
        </button>
        <button
          onClick={() => {
            const fn = (window as unknown as Record<string, unknown>).__mixiLockOrientation as ((v: string | null) => void) | undefined;
            if (fn) fn(orientationLocked ? null : 'landscape');
            setOrientationLocked(!orientationLocked);
          }}
          style={{
            width: 28,
            height: 28,
            border: `1px solid ${orientationLocked ? '#f59e0b' : '#333'}`,
            borderRadius: 4,
            background: orientationLocked ? '#f59e0b22' : 'transparent',
            color: orientationLocked ? '#f59e0b' : '#555',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label="Lock orientation"
        >
          {orientationLocked ? '🔒' : '🔓'}
        </button>
        <MobileDeckPicker deckId="B" />
      </div>

      {/* Deck rows — stretch to fill available space */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {DECK_IDS.map((id) => (
          <LandscapeDeckArea key={id} deckId={id} />
        ))}
      </div>

      {/* Crossfader + toolbar */}
      <MobileCrossfader />
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 4,
          padding: '0 8px 3px',
          flexShrink: 0,
        }}
      >
        <ToolBtn label="EQ" active={overlayOpen && overlayTab === 'eq'} onClick={() => openOverlay('eq')} />
        <ToolBtn label="FX" active={overlayOpen && overlayTab === 'fx'} onClick={() => openOverlay('fx')} />
        <ToolBtn label="PADS" active={overlayOpen && overlayTab === 'pads'} onClick={() => openOverlay('pads')} />
        <ToolBtn
          label="+"
          active={loaderOpen}
          onClick={() => { setLoaderOpen(!loaderOpen); setBrowserOpen(false); setOverlayOpen(false); }}
        />
        <ToolBtn
          label="BROWSE"
          active={browserOpen}
          onClick={() => { setBrowserOpen(!browserOpen); setOverlayOpen(false); setLoaderOpen(false); }}
        />
        <ToolBtn
          label="REC"
          active={recOpen}
          color="#ef4444"
          onClick={() => { setRecOpen(!recOpen); setBrowserOpen(false); setLoaderOpen(false); setOverlayOpen(false); setSettingsOpen(false); }}
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
        {overlayTab === 'fx' && <OverlayFX deckId={overlayDeck} />}
        {overlayTab === 'hp' && <OverlayHeadphones />}
      </OverlayPanel>

      {/* REC overlay */}
      {recOpen && (
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
            onClick={() => setRecOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}
          />
          <div
            style={{
              position: 'relative',
              background: 'rgba(10,10,10,0.72)',
              backdropFilter: 'blur(16px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
              borderRadius: 12,
              border: '1px solid #ef444444',
              minWidth: 260,
            }}
          >
            <MobileRecPanel onClose={() => setRecOpen(false)} />
          </div>
        </div>
      )}

      {/* Settings overlay */}
      {settingsOpen && (
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
            onClick={() => setSettingsOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
          />
          <div
            style={{
              position: 'relative',
              height: '55vh',
              background: 'rgba(10,10,10,0.72)',
              backdropFilter: 'blur(16px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
              borderTop: '2px solid #a855f744',
              borderRadius: '12px 12px 0 0',
              overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: '#444' }} />
            </div>
            <div style={{ padding: '8px 16px 16px' }}>
              <div style={{ fontSize: 10, color: '#666', fontFamily: 'var(--font-mono)', marginBottom: 12, letterSpacing: 3 }}>
                SETTINGS
              </div>
              <OverlaySettings />
            </div>
          </div>
        </div>
      )}

      {/* Loader overlay */}
      {loaderOpen && (
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
            onClick={() => setLoaderOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
          />
          <div
            style={{
              position: 'relative',
              height: '60vh',
              background: 'rgba(10,10,10,0.72)',
              backdropFilter: 'blur(16px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
              borderTop: '2px solid #33333366',
              borderRadius: '12px 12px 0 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: '#444' }} />
            </div>
            <MobileTrackLoader />
          </div>
        </div>
      )}

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
              background: 'rgba(10,10,10,0.72)',
              backdropFilter: 'blur(16px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
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
