/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Deck Section (responsive layout)
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { PremiumJogWheel } from './PremiumJogWheel';
import { NeonCueButton, NeonPlayButton } from './NeonTransport';
import { DeckModeSelector } from './DeckModeSelector';
import { TrackLoader } from './TrackLoader';
import { WaveformDisplay } from './WaveformDisplay';
import { WaveformOverview } from './WaveformOverview';
import { TrackInfo } from './TrackInfo';
import { PerformancePads } from './PerformancePads';
import { PitchStrip } from './PitchStrip';
import { FxUnitPanel } from './FxUnitPanel';
import { BeatgridEditor } from './BeatgridEditor';
import type { DeckId } from '../../types';
import { CAMELOT_KEY_COLORS } from '../../theme';
import { deckRegistry } from '../../decks/registry';
import { doubleBpm as doubleBpmHelper, halveBpm as halveBpmHelper } from '../../audio/utils/mathUtils';

interface DeckSectionProps {
  deckId: DeckId;
  color: string;
}

export const DeckSection: FC<DeckSectionProps> = ({ deckId, color }) => {
  // Granular selectors — only re-render when the field we actually use changes
  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  const isTrackLoaded = useMixiStore((s) => s.decks[deckId].isTrackLoaded);
  const isSynced = useMixiStore((s) => s.decks[deckId].isSynced);
  const bpm = useMixiStore((s) => s.decks[deckId].bpm);
  const bpmConfidence = useMixiStore((s) => s.decks[deckId].bpmConfidence);
  const originalBpm = useMixiStore((s) => s.decks[deckId].originalBpm);
  const trackName = useMixiStore((s) => s.decks[deckId].trackName);
  const musicalKey = useMixiStore((s) => s.decks[deckId].musicalKey);
  const cueActive = useMixiStore((s) => s.decks[deckId].cueActive);
  const playbackRate = useMixiStore((s) => s.decks[deckId].playbackRate);
  const setPlaying = useMixiStore((s) => s.setDeckPlaying);
  const setPlaybackRate = useMixiStore((s) => s.setDeckPlaybackRate);
  const setTrackLoaded = useMixiStore((s) => s.setDeckTrackLoaded);
  const setStoreTrackName = useMixiStore((s) => s.setDeckTrackName);
  const syncDeck = useMixiStore((s) => s.syncDeck);
  const unsyncDeck = useMixiStore((s) => s.unsyncDeck);
  const ejectDeck = useMixiStore((s) => s.ejectDeck);
  const setDeckMode = useMixiStore((s) => s.setDeckMode);
  const volume = useMixiStore((s) => s.decks[deckId].volume);
  const deckMode = useMixiStore((s) => s.deckModes[deckId]);
  const [ejectPending, setEjectPending] = useState(false);
  const ejectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Deck-wide audio file picker & drag-and-drop overlay state */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  /** Shared zoom ref: WaveformDisplay writes, WaveformOverview reads */
  const waveZoomRef = useRef(1);
  /** BPM inline editing state */
  const [editingBpm, setEditingBpm] = useState(false);
  const [gridEditMode, setGridEditMode] = useState(false);
  const [bpmInput, setBpmInput] = useState('');
  const bpmInputRef = useRef<HTMLInputElement>(null);
  /** CDJ main cue point (buffer seconds) + hold-to-preview state */
  const cuePointRef = useRef<number | null>(null);
  const [hasCuePoint, setHasCuePoint] = useState(false);
  const [cuePreviewing, setCuePreviewing] = useState(false);

  // Reset stored cue point when track changes / unloads
  useEffect(() => {
    cuePointRef.current = null;
    setHasCuePoint(false);
    setCuePreviewing(false);
  }, [trackName, isTrackLoaded]);

  const handleCueDown = useCallback(() => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized || !isTrackLoaded) return;
    const state = useMixiStore.getState().decks[deckId];
    const current = engine.getCurrentTime(deckId);
    const cueTarget = cuePointRef.current ?? state.firstBeatOffset ?? 0;

    if (state.isPlaying) {
      // Playing -> jump back to cue point & pause (standard CDJ CUE behavior)
      setPlaying(deckId, false);
      engine.seek(deckId, cueTarget);
      return;
    }

    // Paused: if already at cue point, hold to preview; otherwise set new cue here
    if (Math.abs(current - cueTarget) < 0.08) {
      cuePointRef.current = cueTarget;
      setHasCuePoint(true);
      setCuePreviewing(true);
      setPlaying(deckId, true);
    } else {
      cuePointRef.current = current;
      setHasCuePoint(true);
    }
  }, [deckId, isTrackLoaded, setPlaying]);

  const handleCueUp = useCallback(() => {
    if (!cuePreviewing) return;
    const engine = MixiEngine.getInstance();
    const state = useMixiStore.getState().decks[deckId];
    const cueTarget = cuePointRef.current ?? state.firstBeatOffset ?? 0;
    setCuePreviewing(false);
    setPlaying(deckId, false);
    if (engine.isInitialized) {
      engine.seek(deckId, cueTarget);
    }
  }, [cuePreviewing, deckId, setPlaying]);

  const togglePlay = useCallback(
    () => setPlaying(deckId, !isPlaying),
    [deckId, isPlaying, setPlaying],
  );
  const onPitchChange = useCallback(
    (val: number) => setPlaybackRate(deckId, val),
    [deckId, setPlaybackRate],
  );
  const toggleSync = useCallback(() => {
    if (isSynced) unsyncDeck(deckId);
    else syncDeck(deckId);
  }, [deckId, isSynced, syncDeck, unsyncDeck]);

  // ── Eject safety guard (double-click when live) ────────
  const handleEject = useCallback(() => {
    const isLive = isPlaying && volume > 0.05;
    if (!isLive) {
      ejectDeck(deckId);
      return;
    }
    if (ejectPending) {
      clearTimeout(ejectTimerRef.current);
      setEjectPending(false);
      ejectDeck(deckId);
    } else {
      setEjectPending(true);
      ejectTimerRef.current = setTimeout(() => setEjectPending(false), 2000);
    }
  }, [deckId, isPlaying, volume, ejectPending, ejectDeck]);

  useEffect(() => () => clearTimeout(ejectTimerRef.current), []);

  // ── BPM x2/÷2 + inline edit ───────────────────────────
  // UX-5: Use originalBpm (native track tempo), not pitched bpm, so x2/÷2 on a
  // pitched deck never corrupts the track's base BPM.
  const doubleBpm = useCallback(() => {
    const store = useMixiStore.getState();
    const d = store.decks[deckId];
    const baseBpm = d.originalBpm > 0 ? d.originalBpm : d.bpm;
    const newBpm = doubleBpmHelper(baseBpm);
    if (newBpm !== null) store.setDeckBpm(deckId, newBpm, d.firstBeatOffset);
  }, [deckId]);

  const halveBpm = useCallback(() => {
    const store = useMixiStore.getState();
    const d = store.decks[deckId];
    const baseBpm = d.originalBpm > 0 ? d.originalBpm : d.bpm;
    const newBpm = halveBpmHelper(baseBpm);
    if (newBpm !== null) store.setDeckBpm(deckId, newBpm, d.firstBeatOffset);
  }, [deckId]);

  const startBpmEdit = useCallback(() => {
    setEditingBpm(true);
    setBpmInput(bpm.toFixed(1));
    setTimeout(() => bpmInputRef.current?.select(), 0);
  }, [bpm]);

  const commitBpmEdit = useCallback(() => {
    setEditingBpm(false);
    const val = parseFloat(bpmInput);
    if (!isNaN(val) && val >= 30 && val <= 300) {
      const store = useMixiStore.getState();
      store.setDeckBpm(deckId, val, store.decks[deckId].firstBeatOffset);
    }
  }, [deckId, bpmInput]);

  // ── Direct deck file loading & Drag-and-Drop overlay ────
  const handleLoadAudioFile = useCallback(
    async (file: File) => {
      const isMedia =
        file.type.startsWith('audio/') ||
        file.type.startsWith('video/') ||
        /\.(mp3|wav|flac|aiff|aac|ogg|m4a|opus|wma|webm|mp4)$/i.test(file.name);
      if (!isMedia) return;
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;
      setIsLoadingFile(true);
      try {
        if (useMixiStore.getState().deckModes[deckId] !== 'track') {
          setDeckMode(deckId, 'track');
        }
        const buffer = await file.arrayBuffer();
        await engine.loadTrack(deckId, buffer);
        setStoreTrackName(deckId, file.name);
        setTrackLoaded(deckId, true);
      } catch {
        // TrackLoader / engine logs errors internally
      } finally {
        setIsLoadingFile(false);
      }
    },
    [deckId, setDeckMode, setStoreTrackName, setTrackLoaded],
  );

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleLoadAudioFile(file);
      e.target.value = '';
    },
    [handleLoadAudioFile],
  );

  const onDeckDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const onDeckDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDeckDragLeave = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const onDeckDrop = useCallback(
    (e: DragEvent) => {
      if (!e.dataTransfer.files?.length) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleLoadAudioFile(file);
    },
    [handleLoadAudioFile],
  );

  // ── Module-aware gradient header ────────────────────────
  const activeModule = deckRegistry.findByMode(deckMode);
  const moduleColor = activeModule?.accentColor;

  const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
  const otherBpm = useMixiStore((s) => s.decks[otherDeckId].bpm);
  const canSync = originalBpm > 0 && otherBpm > 0;

  return (
    <div
      className="relative flex flex-col gap-1.5 h-full overflow-hidden transition-opacity duration-500"
      style={{ opacity: !isTrackLoaded && !isPlaying ? 0.6 : 1 }}
      onDragEnter={onDeckDragEnter}
      onDragOver={onDeckDragOver}
      onDragLeave={onDeckDragLeave}
      onDrop={onDeckDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.flac,.aac,.ogg,.m4a,.opus,.aiff,.wma,.webm,.mp4"
        className="hidden"
        onChange={onFileInputChange}
        aria-label={`Load audio file onto Deck ${deckId}`}
      />
      {/* ── Unified Header — flush with top border ────────────── */}
      <div
        className="mixi-deck-header flex items-center gap-1.5 px-2.5 pt-2.5 pb-1 border-b border-zinc-800/30"
        style={moduleColor ? {
          background: `linear-gradient(90deg, ${color}15, ${moduleColor}10)`,
          borderBottom: `1px solid ${moduleColor}22`,
        } : undefined}
      >
        {/* Status dot */}
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${isPlaying ? 'mixi-dot-pulse' : ''}`}
          style={{
            backgroundColor: isPlaying ? color : 'var(--txt-muted)',
            boxShadow: isPlaying ? `0 0 8px ${color}` : 'none',
          }}
        />
        {/* Deck label */}
        <span className="text-xs font-bold tracking-[0.15em] shrink-0" style={{ color }}>
          {deckId}
        </span>
        {/* Explicit 19-mode Deck Instrument Selector (TRACK / 303 / KICK / GBOX / ...) */}
        <DeckModeSelector
          deckId={deckId}
          currentMode={deckMode}
          color={color}
          onSelectMode={(mode) => setDeckMode(deckId, mode)}
        />
        {/* Headphone icon — visible when CUE is active */}
        {cueActive && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--clr-b)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ filter: 'drop-shadow(0 0 3px rgba(255,106,0,0.6))' }}>
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z" />
            <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z" />
          </svg>
        )}
        {/* Discrete LOAD audio button (compact icon when track loaded, labeled pill when empty) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoadingFile}
          aria-label={`Load audio track onto Deck ${deckId}`}
          className={`shrink-0 inline-flex items-center gap-1 rounded py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider text-zinc-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] transition-colors cursor-pointer disabled:opacity-40 ${
            isTrackLoaded ? 'px-1' : 'px-1.5'
          }`}
          title={`Load audio file onto Deck ${deckId} (or drag & drop anywhere on deck)`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {!isTrackLoaded && <span>LOAD</span>}
        </button>
        {/* Eject */}
        {isTrackLoaded && (
          <button
            type="button"
            onClick={handleEject}
            aria-label={ejectPending ? `Confirm eject Deck ${deckId}` : `Eject Deck ${deckId}`}
            className={`shrink-0 rounded p-0.5 transition-colors ${
              ejectPending
                ? 'text-red-400 animate-pulse'
                : 'text-zinc-600 hover:text-zinc-300'
            }`}
            title={ejectPending ? 'Click again to eject (live!)' : 'Eject track'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5,18 12,6 19,18" />
              <line x1="5" y1="22" x2="19" y2="22" />
            </svg>
          </button>
        )}
        {/* Track name — clickable to load a new track */}
        {isTrackLoaded && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 truncate text-left text-[13.5px] text-zinc-200 hover:text-white font-bold min-w-0 transition-colors cursor-pointer"
            title={`${trackName || 'Track'} — Click to load another audio file`}
          >
            {trackName || ''}
          </button>
        )}
        {/* Spacer when no track */}
        {!isTrackLoaded && <span className="flex-1" />}
        {/* Key badge — refined dark pill with Camelot dot + border (never steals Master/Sync colors) */}
        {musicalKey && (() => {
          const keyColor = CAMELOT_KEY_COLORS[musicalKey] || color;
          return (
            <span
              key={`key-${musicalKey}`}
              className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-wider mixi-pop tabular-nums"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${keyColor}66`,
                color: 'var(--txt-bright)',
              }}
              title={`Musical key (Camelot): ${musicalKey}`}
            >
              <span
                aria-hidden="true"
                className="rounded-full shrink-0"
                style={{ width: 5, height: 5, background: keyColor, boxShadow: `0 0 4px ${keyColor}` }}
              />
              {musicalKey}
            </span>
          );
        })()}
        {/* BPM + Beat counter */}
        {bpm > 0 && (
          <div key={`bpm-${bpm.toFixed(0)}`} className="group/bpm flex items-center gap-1.5 shrink-0 mixi-pop">
            {/* /2 button — quiet at rest (40%), crisp on hover */}
            <button
              type="button"
              onClick={halveBpm}
              className="text-[8px] font-mono font-bold text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] rounded px-1 py-0.5 opacity-40 group-hover/bpm:opacity-100 transition-opacity"
              title="Halve BPM"
            >
              /2
            </button>

            <div className="flex items-center gap-0.5">
              {/* BPM value — double-click to edit */}
              {editingBpm ? (
                <input
                  ref={bpmInputRef}
                  value={bpmInput}
                  onChange={(e) => setBpmInput(e.target.value)}
                  onBlur={commitBpmEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitBpmEdit(); if (e.key === 'Escape') setEditingBpm(false); }}
                  className="w-12 text-sm font-mono font-black tabular-nums text-white bg-transparent border-b border-zinc-500 outline-none text-center"
                />
              ) : (
                <span
                  className="text-sm font-mono font-black tabular-nums cursor-pointer"
                  style={{
                    color: 'var(--txt-white)',
                  }}
                  title={`BPM confidence: ${(bpmConfidence * 100).toFixed(0)}% — Double-click to edit`}
                  onDoubleClick={startBpmEdit}
                >
                  {bpm.toFixed(1)}
                </span>
              )}

              {/* 3-bar BPM confidence meter (replaces error-looking orange '?') */}
              {bpmConfidence > 0 && (() => {
                const bars = bpmConfidence >= 0.7 ? 3 : bpmConfidence >= 0.35 ? 2 : 1;
                return (
                  <span
                    className="inline-flex items-end gap-[1.5px] mx-0.5"
                    style={{ height: 10 }}
                    title={`BPM confidence: ${(bpmConfidence * 100).toFixed(0)}%`}
                    aria-label={`BPM confidence ${Math.round(bpmConfidence * 100)}%`}
                  >
                    {[4, 7, 10].map((h, idx) => (
                      <span
                        key={h}
                        className="rounded-[1px]"
                        style={{
                          width: 2,
                          height: h,
                          background: idx < bars ? color : 'var(--vu-off-segment, rgba(255,255,255,0.14))',
                          opacity: idx < bars ? 0.9 : 1,
                        }}
                      />
                    ))}
                  </span>
                );
              })()}
            </div>

            {/* x2 button — quiet at rest (40%), crisp on hover */}
            <button
              type="button"
              onClick={doubleBpm}
              className="text-[8px] font-mono font-bold text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] rounded px-1 py-0.5 opacity-40 group-hover/bpm:opacity-100 transition-opacity"
              title="Double BPM"
            >
              x2
            </button>

            <BeatCounter deckId={deckId} color={color} />
            {/* Compact SYNC pill next to BPM (keeps CUE + PLAY sacred below the jog) */}
            <button
              type="button"
              onClick={toggleSync}
              disabled={!canSync}
              aria-pressed={isSynced}
              title={isSynced ? 'Unsync BPM & phase' : 'Sync BPM & phase to other deck'}
              className="ml-1 rounded px-1.5 py-0.5 text-[8px] font-mono font-black tracking-wider uppercase transition-all active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
              style={{
                color: isSynced ? '#050507' : 'var(--txt-bright)',
                background: isSynced ? color : 'rgba(255,255,255,0.06)',
                border: `1px solid ${isSynced ? color : `${color}45`}`,
                boxShadow: isSynced ? `0 0 10px ${color}66` : 'none',
              }}
            >
              SYNC
            </button>
          </div>
        )}
        {/* Time counter */}
        {isTrackLoaded && (
          <TrackInfo deckId={deckId} color={color} compact />
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="mixi-deck-content flex flex-1 flex-col px-3 pb-3 min-h-0 relative">
        {!isTrackLoaded && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-xl m-3 pointer-events-auto p-6">
            <TrackLoader deckId={deckId} color={color} onSwitchToGroovebox={() => setDeckMode(deckId, 'groovebox')} onSwitchModule={(mode) => setDeckMode(deckId, mode)} />
          </div>
        )}
        <div className={`flex flex-1 flex-col min-h-0 transition-all duration-500 ease-out ${!isTrackLoaded ? 'pointer-events-none opacity-60 blur-[2px]' : 'opacity-100 blur-0'}`}>
          {/* Waveform + Beatgrid Editor (+20% height for booth windshield legibility) */}
          <div className="mixi-waveform-area shrink-0 flex flex-col">
            <div className="relative">
              <WaveformDisplay deckId={deckId} height={84} externalZoomRef={waveZoomRef} />
              {/* Overlay + panel mount when GRID edit is active */}
              <BeatgridEditor deckId={deckId} color={color} editMode={gridEditMode} waveformWidth={0} zoomRef={waveZoomRef} />
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {/* GRID toggle button (elevated contrast) */}
              <button
                type="button"
                onClick={() => setGridEditMode(g => !g)}
                className="text-[8.5px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded active:scale-95 transition-all"
                style={{
                  color: gridEditMode ? color : 'var(--txt-primary)',
                  background: gridEditMode ? `${color}1c` : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${gridEditMode ? `${color}88` : 'rgba(255,255,255,0.18)'}`,
                }}
              >
                GRID
              </button>
              <WaveformOverview deckId={deckId} height={24} zoomRef={waveZoomRef} />
            </div>
          </div>

          {/* Mirror Layout: Deck A has Pitch on far-left outer edge & FX inner; Deck B is mirrored */}
          <div className={`flex items-center flex-1 min-h-0 py-1.5 ${deckId === 'A' ? 'flex-row-reverse' : ''}`}>
            <FxUnitPanel deckId={deckId} color={color} />
            <div className="flex flex-col items-center justify-center flex-1">
              <PremiumJogWheel deckId={deckId} color={color} size={344} />
              {/* Sacred CDJ transport pair: CUE (left) + PLAY/PAUSE (right) */}
              <div className="mixi-transport flex items-center justify-center gap-14 mt-3">
                <NeonCueButton
                  hasCue={hasCuePoint || isTrackLoaded}
                  isPreviewing={cuePreviewing}
                  disabled={!isTrackLoaded}
                  onPointerDown={handleCueDown}
                  onPointerUp={handleCueUp}
                  size={72}
                  midiAction={{ type: 'DECK_CUE', deck: deckId }}
                />
                <div className="relative">
                  <NeonPlayButton
                    isPlaying={isPlaying}
                    onToggle={togglePlay}
                    color={color}
                    size={72}
                    midiAction={{ type: 'DECK_PLAY', deck: deckId }}
                  />
                  <span className="mixi-key-hint absolute -bottom-3 left-1/2 -translate-x-1/2">
                    {deckId === 'A' ? 'SPACE' : '⇧B'}
                  </span>
                </div>
              </div>
            </div>
            <PitchStrip
              value={playbackRate}
              onChange={onPitchChange}
              color={color}
              deckId={deckId}
              midiAction={{ type: 'DECK_PITCH', deck: deckId }}
            />
          </div>

          {/* Performance Pads */}
          <div className="mixi-pads-section shrink-0">
            <PerformancePads deckId={deckId} color={color} />
          </div>
        </div>
      </div>

      {/* Per-deck luminous Drag & Drop overlay */}
      {isDragOver && (
        <div
          className="absolute inset-1.5 z-40 rounded-xl flex flex-col items-center justify-center gap-2.5 pointer-events-none"
          style={{
            background: 'rgba(8, 10, 14, 0.86)',
            backdropFilter: 'blur(4px)',
            border: `2px dashed ${color}`,
            boxShadow: `inset 0 0 40px ${color}24, 0 0 24px ${color}33`,
          }}
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 10px ${color}88)` }}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span
            className="text-sm font-mono font-black uppercase tracking-[0.22em]"
            style={{ color, textShadow: `0 0 14px ${color}88` }}
          >
            DROP AUDIO ON DECK {deckId}
          </span>
          <span className="text-[10px] font-mono tracking-widest text-zinc-400">
            WAV · MP3 · FLAC · AIFF · OGG · M4A
          </span>
        </div>
      )}
    </div>
  );
};

// ── Beat Counter (header, after BPM) ───────────────────────

const BeatCounter: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const engine = MixiEngine.getInstance();
    let rafId = 0;
    let lastBeat = -1;

    function tick() {
      const deck = useMixiStore.getState().decks[deckId];
      const el = spanRef.current;
      if (el && engine.isInitialized && deck.isPlaying && deck.bpm > 0) {
        const t = engine.getCurrentTime(deckId);
        const beatPeriod = 60 / deck.bpm;
        const beat = (((Math.floor((t - deck.firstBeatOffset) / beatPeriod) % 4) + 4) % 4) + 1;
        if (beat !== lastBeat) {
          lastBeat = beat;
          el.textContent = `.${beat}`;
        }
      } else if (el && lastBeat !== -1) {
        lastBeat = -1;
        el.textContent = '';
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [deckId]);

  return (
    <span
      ref={spanRef}
      className="text-[10px] font-mono font-black"
      style={{ color, fontFeatureSettings: '"tnum"', minWidth: 12, marginLeft: 1 }}
    />
  );
};

// FxStrip replaced by FxUnitPanel (imported from ./FxUnitPanel.tsx)
