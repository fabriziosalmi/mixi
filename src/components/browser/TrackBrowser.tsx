/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Track Browser Panel
//
// Slide-up panel with Excel-style track table + SoundCloud
// URL import via the yt-dlp Python backend.
// Toggled with the top-bar button or Tab key.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, useMemo, type FC, type FormEvent, type DragEvent } from 'react';
import { useBrowserStore, TAG_COLORS, type TrackEntry } from '../../store/browserStore';
import { usePlaylistStore, matchesSmartFilter, type SmartFilter } from '../../store/playlistStore';
import { BatchAnalyzer } from '../../audio/BatchAnalyzer';
import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { detectBpm } from '../../audio/BpmDetector';
import { useSettingsStore, BPM_RANGE_PRESETS } from '../../store/settingsStore';
import { detectKey } from '../../audio/KeyDetector';
import { COLOR_DECK_A, COLOR_DECK_B, CAMELOT_KEY_COLORS } from '../../theme';
import type { DeckId } from '../../types';
import { log } from '../../utils/logger';
import { parseTrackMeta } from '../../audio/metadataParser';
import { API_BASE } from '../../utils/apiBase';

// ── Helpers ──────────────────────────────────────────────────

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

let _idCounter = 0;
function uid(): string {
  return `t-${Date.now()}-${++_idCounter}`;
}

// ── Track Browser ────────────────────────────────────────────

export const TrackBrowser: FC = () => {
  const open = useBrowserStore((s) => s.open);
  const tracks = useBrowserStore((s) => s.tracks);
  const search = useBrowserStore((s) => s.search);
  const sortCol = useBrowserStore((s) => s.sortCol);
  const sortAsc = useBrowserStore((s) => s.sortAsc);
  const setSearch = useBrowserStore((s) => s.setSearch);
  const setSort = useBrowserStore((s) => s.setSort);
  const addTrack = useBrowserStore((s) => s.addTrack);
  const removeTrack = useBrowserStore((s) => s.removeTrack);
  const hydrateAudioUrls = useBrowserStore((s) => s.hydrateAudioUrls);
  const setTrackRating = useBrowserStore((s) => s.setTrackRating);
  const setTrackColorTag = useBrowserStore((s) => s.setTrackColorTag);

  // Playlists
  const playlists = usePlaylistStore((s) => s.playlists);
  const selectedPlaylistId = usePlaylistStore((s) => s.selectedId);
  const selectPlaylist = usePlaylistStore((s) => s.selectPlaylist);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const addTrackToPlaylist = usePlaylistStore((s) => s.addTrack);
  const removeTrackFromPlaylist = usePlaylistStore((s) => s.removeTrack);
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) ?? null;

  // Hydrate audio blob URLs from IndexedDB on first mount.
  useEffect(() => { hydrateAudioUrls(); }, [hydrateAudioUrls]);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  // Batch analysis
  const analyzerRef = useRef<BatchAnalyzer | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; title: string } | null>(null);

  const startBatchAnalysis = useCallback(() => {
    if (analyzerRef.current?.isRunning) {
      analyzerRef.current.cancel();
      return;
    }
    const analyzer = new BatchAnalyzer();
    analyzerRef.current = analyzer;
    analyzer.onProgress = (current, total, title) => setBatchProgress({ current, total, title });
    analyzer.onComplete = () => { setBatchProgress(null); analyzerRef.current = null; };
    analyzer.analyzeAll();
  }, []);

  // ── Import from URL (yt-dlp) ────────────────────────────

  const handleImport = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const url = urlRef.current?.value.trim();
      if (!url) return;

      setImporting(true);
      setImportError('');

      try {
        const res = await fetch(
          `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`,
        );
        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const title =
          res.headers.get('X-Track-Title') || url.split('/').pop() || 'Unknown';
        const buf = await res.arrayBuffer();

        // Decode for analysis
        const engine = MixiEngine.getInstance();
        if (!engine.isInitialized) throw new Error('Engine not initialized');

        const actx = engine.getAudioContext();
        const decoded = await actx.decodeAudioData(buf.slice(0));

        // Detect BPM + key
        const bpmPreset = BPM_RANGE_PRESETS[useSettingsStore.getState().bpmRange];
        const bpmResult = detectBpm(decoded, { bpmMin: bpmPreset.min, bpmMax: bpmPreset.max });
        const keyResult = detectKey(decoded);

        // Store audio as blob URL
        const ct = res.headers.get('Content-Type') || 'audio/mpeg';
        const blob = new Blob([buf], { type: ct });
        const audioUrl = URL.createObjectURL(blob);

        // Try ID3 / metadata tags first.
        const meta = await parseTrackMeta(blob);

        // Parse title / artist — prefer ID3 tags, fall back to header/URL.
        let trackTitle = meta.title || title;
        let artist = meta.artist || '';
        if (!meta.title && !meta.artist && title.includes(' - ')) {
          const parts = title.split(' - ');
          artist = parts[0].trim();
          trackTitle = parts.slice(1).join(' - ').trim();
        }

        const entry: TrackEntry = {
          id: uid(),
          title: trackTitle,
          artist,
          bpm: Math.round(bpmResult.bpm),
          key: keyResult.camelot,
          duration: decoded.duration,
          audioUrl,
          addedAt: Date.now(),
          rating: 0,
          colorTag: '',
          analyzedAt: Date.now(),
        };

        addTrack(entry, blob);
        if (urlRef.current) urlRef.current.value = '';
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Import failed');
      } finally {
        setImporting(false);
      }
    },
    [addTrack],
  );

  // ── Load to deck ──────────────────────────────────────────

  // ── Drag & drop audio files into browser ──────────────────

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('audio/'));
    if (!files.length) return;

    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;
    const actx = engine.getAudioContext();

    // M2: Process files one at a time with yield between each to keep UI responsive.
    // detectBpm/detectKey are CPU-bound — without yielding, dropping 50 files
    // freezes the main thread for the entire batch.
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const decoded = await actx.decodeAudioData(buf.slice(0));
        const bpmPresetDrop = BPM_RANGE_PRESETS[useSettingsStore.getState().bpmRange];

        // Yield before CPU-bound analysis
        await new Promise((r) => setTimeout(r, 0));
        const bpmResult = detectBpm(decoded, { bpmMin: bpmPresetDrop.min, bpmMax: bpmPresetDrop.max });
        await new Promise((r) => setTimeout(r, 0));
        const keyResult = detectKey(decoded);

        const blob = new Blob([buf], { type: file.type });
        const audioUrl = URL.createObjectURL(blob);

        const meta = await parseTrackMeta(blob);

        let trackTitle = meta.title || file.name.replace(/\.[^.]+$/, '');
        let artist = meta.artist || '';
        if (!meta.title && !meta.artist && trackTitle.includes(' - ')) {
          const parts = trackTitle.split(' - ');
          artist = parts[0].trim();
          trackTitle = parts.slice(1).join(' - ').trim();
        }

        addTrack({
          id: uid(),
          title: trackTitle,
          artist,
          bpm: Math.round(bpmResult.bpm),
          key: keyResult.camelot,
          duration: decoded.duration,
          audioUrl,
          addedAt: Date.now(),
          rating: 0,
          colorTag: '',
          analyzedAt: Date.now(),
        }, blob);
      } catch (err) {
        log.error('TrackBrowser', `Failed to import ${file.name}`, err);
      }
    }
  }, [addTrack]);

  const loadToDeck = useCallback(async (track: TrackEntry, deck: DeckId) => {
    try {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;

      const res = await fetch(track.audioUrl);
      const buf = await res.arrayBuffer();
      await engine.loadTrack(deck, buf);
      useMixiStore.getState().setDeckTrackName(deck, `${track.artist ? track.artist + ' - ' : ''}${track.title}`);
      useMixiStore.getState().setDeckTrackLoaded(deck, true);
    } catch (err) {
      log.error('TrackBrowser', `Failed to load to deck ${deck}`, err);
    }
  }, []);

  // ── Filter + sort (H2: memoized to avoid O(n) recomputation on unrelated renders) ──

  const filtered = useMemo(() => {
    // Playlist filter first — smart playlists compute matches dynamically
    const base = selectedPlaylist
      ? selectedPlaylist.smart
        ? tracks.filter((t) => matchesSmartFilter(t, selectedPlaylist.smart!))
        : tracks.filter((t) => selectedPlaylist.trackIds.includes(t.id))
      : tracks;

    const q = search.toLowerCase();
    const searched = q
      ? base.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.key.toLowerCase().includes(q),
        )
      : base;

    return [...searched].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (typeof va === 'number' && typeof vb === 'number')
        return sortAsc ? va - vb : vb - va;
      return sortAsc
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [tracks, search, sortCol, sortAsc, selectedPlaylist]);

  // H3: Memoize smart playlist counts to avoid O(playlists × tracks) per render
  const playlistCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pl of playlists) {
      counts.set(pl.id, pl.smart
        ? tracks.filter((t) => matchesSmartFilter(t, pl.smart!)).length
        : pl.trackIds.length);
    }
    return counts;
  }, [playlists, tracks]);

  // ColHead extracted outside component (see bottom of file)

  // ── Render ─────────────────────────────────────────────────

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-[100] transition-transform duration-300 ease-in-out"
      style={{
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        height: 280,
        background: 'linear-gradient(to bottom, var(--srf-inset), var(--srf-base))',
        borderTop: dragOver ? '2px solid rgba(168,85,247,0.6)' : '1px solid rgba(255,255,255,0.06)',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-zinc-800/40">
        {/* Title */}
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
          BROWSER
        </span>

        {/* Search */}
        <input
          type="text"
          placeholder="Search tracks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs bg-zinc-900/60 border border-zinc-800/50 rounded px-2 py-0.5 text-[11px] text-zinc-300 font-mono placeholder:text-zinc-600 outline-none focus:border-zinc-600/60"
        />

        {/* URL import */}
        <form onSubmit={handleImport} className="flex items-center gap-1.5">
          <input
            ref={urlRef}
            type="text"
            placeholder="Paste SoundCloud / YouTube URL…"
            className="w-64 bg-zinc-900/60 border border-zinc-800/50 rounded px-2 py-0.5 text-[11px] text-zinc-300 font-mono placeholder:text-zinc-600 outline-none focus:border-zinc-600/60"
          />
          <button
            type="submit"
            disabled={importing}
            className="rounded px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-50"
            style={{
              background: importing ? 'var(--brd-default)' : 'rgba(168,85,247,0.15)',
              color: importing ? 'var(--txt-secondary)' : 'var(--clr-master)',
              border: '1px solid rgba(168,85,247,0.2)',
            }}
          >
            {importing ? 'IMPORTING…' : 'IMPORT'}
          </button>
        </form>

        {importError && (
          <span className="text-[9px] text-red-400 font-mono">{importError}</span>
        )}

        {/* Batch analysis */}
        <button
          type="button"
          onClick={startBatchAnalysis}
          disabled={tracks.length === 0}
          className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-30 ml-auto"
          style={{
            background: batchProgress ? 'rgba(239,68,68,0.15)' : 'rgba(34,211,238,0.12)',
            color: batchProgress ? '#ef4444' : '#22d3ee',
            border: `1px solid ${batchProgress ? '#ef444433' : '#22d3ee33'}`,
          }}
        >
          {batchProgress ? `STOP (${batchProgress.current}/${batchProgress.total})` : 'ANALYZE ALL'}
        </button>

        {/* Track count */}
        <span className="text-[9px] font-mono text-zinc-600">
          {tracks.length} tracks
        </span>
      </div>

      {/* Body: Sidebar + Table */}
      <div className="flex" style={{ height: 'calc(100% - 36px)' }}>

      {/* ── Playlist Sidebar ────────────────────────────────── */}
      <div
        className="shrink-0 flex flex-col overflow-y-auto border-r border-zinc-800/30"
        style={{ width: 130, background: 'var(--srf-deep)' }}
      >
        {/* All Tracks */}
        <button
          type="button"
          onClick={() => selectPlaylist(null)}
          className="text-left px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
          style={{
            background: selectedPlaylistId === null ? 'rgba(168,85,247,0.12)' : 'transparent',
            color: selectedPlaylistId === null ? 'var(--clr-master)' : 'var(--txt-secondary)',
            borderLeft: selectedPlaylistId === null ? '2px solid var(--clr-master)' : '2px solid transparent',
          }}
        >
          ALL <span className="text-zinc-600 font-normal">({tracks.length})</span>
        </button>

        {/* User playlists */}
        {playlists.map((pl) => {
          const isSelected = selectedPlaylistId === pl.id;
          return (
            <div
              key={pl.id}
              className="flex items-center group"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = 'rgba(168,85,247,0.15)'; }}
              onDragLeave={(e) => { e.currentTarget.style.background = ''; }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.background = '';
                const trackId = e.dataTransfer.getData('text/track-id');
                if (trackId) addTrackToPlaylist(pl.id, trackId);
              }}
            >
              <button
                type="button"
                onClick={() => selectPlaylist(pl.id)}
                className="flex-1 text-left px-2 py-1.5 text-[10px] font-mono truncate transition-colors"
                style={{
                  background: isSelected ? 'rgba(168,85,247,0.12)' : 'transparent',
                  color: isSelected ? 'var(--clr-master)' : 'var(--txt-muted)',
                  borderLeft: isSelected ? '2px solid var(--clr-master)' : '2px solid transparent',
                }}
              >
                {pl.smart ? '⚡' : ''}{pl.name} <span className="text-zinc-600">({playlistCounts.get(pl.id) ?? 0})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${pl.name}"?`)) deletePlaylist(pl.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-[9px] text-zinc-600 hover:text-red-400 px-1 transition-opacity"
                title="Delete playlist"
              >
                x
              </button>
            </div>
          );
        })}

        {/* Create new */}
        <button
          type="button"
          onClick={() => {
            const name = prompt('Playlist name:');
            if (name?.trim()) createPlaylist(name.trim());
          }}
          className="px-2 py-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-600 hover:text-zinc-300 transition-colors border-t border-zinc-800/30"
        >
          + NEW
        </button>
        <button
          type="button"
          onClick={() => {
            const name = prompt('Smart playlist name:');
            if (!name?.trim()) return;
            const bpmMinStr = prompt('Min BPM (leave empty to skip):');
            const bpmMaxStr = prompt('Max BPM (leave empty to skip):');
            const ratingStr = prompt('Min rating 1-5 (leave empty to skip):');
            const filter: SmartFilter = {};
            if (bpmMinStr) filter.bpmMin = parseInt(bpmMinStr);
            if (bpmMaxStr) filter.bpmMax = parseInt(bpmMaxStr);
            if (ratingStr) filter.ratingMin = parseInt(ratingStr);
            usePlaylistStore.getState().createSmartPlaylist(name.trim(), filter);
          }}
          className="mt-auto px-2 py-1 text-[8px] font-mono font-bold uppercase tracking-wider text-zinc-700 hover:text-cyan-400 transition-colors"
        >
          + SMART
        </button>
      </div>

      {/* ── Track Table ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-zinc-400 text-[11px] font-mono">
          <thead className="sticky top-0 bg-zinc-900/90 backdrop-blur-sm border-b border-zinc-800/30">
            <tr>
              <th className="w-6" />
              <th className="w-5" title="Color tag" />
              <ColHead col="title" label="Title" sortCol={sortCol} sortAsc={sortAsc} onSort={setSort} />
              <ColHead col="artist" label="Artist" w="160px" sortCol={sortCol} sortAsc={sortAsc} onSort={setSort} />
              <ColHead col="bpm" label="BPM" w="55px" sortCol={sortCol} sortAsc={sortAsc} onSort={setSort} />
              <ColHead col="key" label="Key" w="50px" sortCol={sortCol} sortAsc={sortAsc} onSort={setSort} />
              <ColHead col="duration" label="Dur" w="55px" sortCol={sortCol} sortAsc={sortAsc} onSort={setSort} />
              <ColHead col="rating" label="Rating" w="70px" sortCol={sortCol} sortAsc={sortAsc} onSort={setSort} />
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => (
              <tr
                key={t.id}
                className="border-b border-zinc-800/20 hover:bg-zinc-800/20 transition-colors group cursor-grab"
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/track-id', t.id); e.dataTransfer.effectAllowed = 'copy'; }}
              >
                <td className="px-1 py-1 text-zinc-600 text-center text-[9px]">{i + 1}</td>
                {/* Color tag dot */}
                <td className="px-1 py-1 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      const idx = TAG_COLORS.indexOf(t.colorTag as typeof TAG_COLORS[number]);
                      setTrackColorTag(t.id, idx < TAG_COLORS.length - 1 ? TAG_COLORS[idx + 1] : '');
                    }}
                    className="w-3 h-3 rounded-full inline-block transition-all hover:scale-125"
                    style={{
                      background: t.colorTag || 'var(--srf-light)',
                      boxShadow: t.colorTag ? `0 0 4px ${t.colorTag}66` : 'none',
                    }}
                    title="Click to cycle color tag"
                  />
                </td>
                <td className="px-2 py-1 text-zinc-200 font-medium truncate max-w-[180px]">
                  {t.title}
                </td>
                <td className="px-2 py-1 truncate">{t.artist}</td>
                <td className="px-2 py-1 text-center">{t.bpm || '—'}</td>
                <td className="px-2 py-1 text-center font-bold text-[11px]" style={{ color: CAMELOT_KEY_COLORS[t.key] || 'var(--txt-muted)', textShadow: CAMELOT_KEY_COLORS[t.key] ? `0 0 6px ${CAMELOT_KEY_COLORS[t.key]}44` : 'none' }}>{t.key || '—'}</td>
                <td className="px-2 py-1 text-center">{fmtDuration(t.duration)}</td>
                {/* Star rating */}
                <td className="px-1 py-1 text-center">
                  <div className="flex gap-0 justify-center">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setTrackRating(t.id, t.rating === star ? 0 : star)}
                        className="text-[10px] leading-none transition-colors hover:scale-110"
                        style={{ color: star <= (t.rating || 0) ? '#f59e0b' : '#333' }}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => loadToDeck(t, 'A')}
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase transition-all active:scale-95"
                      style={{
                        background: `${COLOR_DECK_A}15`,
                        color: COLOR_DECK_A,
                        border: `1px solid ${COLOR_DECK_A}33`,
                      }}
                    >
                      DECK A
                    </button>
                    <button
                      type="button"
                      onClick={() => loadToDeck(t, 'B')}
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase transition-all active:scale-95"
                      style={{
                        background: `${COLOR_DECK_B}15`,
                        color: COLOR_DECK_B,
                        border: `1px solid ${COLOR_DECK_B}33`,
                      }}
                    >
                      DECK B
                    </button>
                    {selectedPlaylist && (
                      <button
                        type="button"
                        onClick={() => removeTrackFromPlaylist(selectedPlaylist.id, t.id)}
                        className="rounded px-1 py-0.5 text-[9px] text-zinc-600 hover:text-amber-400 transition-colors"
                        title="Remove from playlist"
                      >
                        −
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeTrack(t.id)}
                      className="rounded px-1 py-0.5 text-[9px] text-zinc-600 hover:text-red-400 transition-colors"
                      title="Remove from library"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-zinc-600 text-[11px]">
                  {tracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-4 py-8">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="12" y1="8" x2="12" y2="16"/>
                        <line x1="8" y1="12" x2="16" y2="12"/>
                      </svg>
                      <div className="text-zinc-400 font-mono text-base tracking-wider uppercase font-medium not-italic">
                        Drag Audio Files Here
                      </div>
                      <div className="text-zinc-600 font-mono text-[10px]">
                        or paste a SoundCloud / YouTube URL above
                      </div>
                    </div>
                  ) : (
                    <span className="text-zinc-600 text-[11px]">No matches.</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      </div>{/* end flex body */}
    </div>
  );
};

// M1: Extracted outside TrackBrowser to prevent remount on every render.
// React compares function identity — a FC defined inside render changes
// identity each frame, causing full DOM teardown + rebuild.
const ColHead: FC<{
  col: string;
  label: string;
  w?: string;
  sortCol: string;
  sortAsc: boolean;
  onSort: (col: any) => void;
}> = ({ col, label, w, sortCol, sortAsc, onSort }) => (
  <th
    className="px-2 py-1.5 text-left cursor-pointer select-none hover:text-zinc-200 transition-colors"
    style={{ width: w }}
    onClick={() => onSort(col)}
  >
    <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
      {label}
      {sortCol === col && (
        <span className="ml-1 text-zinc-500">{sortAsc ? '▲' : '▼'}</span>
      )}
    </span>
  </th>
);
