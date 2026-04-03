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

import { useState, useCallback, useRef, useEffect, type FC, type FormEvent, type DragEvent } from 'react';
import { useBrowserStore, type TrackEntry } from '../../store/browserStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { detectBpm } from '../../audio/BpmDetector';
import { useSettingsStore, BPM_RANGE_PRESETS } from '../../store/settingsStore';
import { detectKey } from '../../audio/KeyDetector';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../theme';
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

  // Hydrate audio blob URLs from IndexedDB on first mount.
  useEffect(() => { hydrateAudioUrls(); }, [hydrateAudioUrls]);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

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

    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const decoded = await actx.decodeAudioData(buf.slice(0));
        const bpmPresetDrop = BPM_RANGE_PRESETS[useSettingsStore.getState().bpmRange];
        const bpmResult = detectBpm(decoded, { bpmMin: bpmPresetDrop.min, bpmMax: bpmPresetDrop.max });
        const keyResult = detectKey(decoded);

        const blob = new Blob([buf], { type: file.type });
        const audioUrl = URL.createObjectURL(blob);

        // Try ID3 / metadata tags first.
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

  // ── Filter + sort ─────────────────────────────────────────

  const q = search.toLowerCase();
  let filtered = q
    ? tracks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.key.toLowerCase().includes(q),
      )
    : tracks;

  filtered = [...filtered].sort((a, b) => {
    const va = a[sortCol];
    const vb = b[sortCol];
    if (typeof va === 'number' && typeof vb === 'number')
      return sortAsc ? va - vb : vb - va;
    return sortAsc
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });

  // ── Column header ─────────────────────────────────────────

  const ColHead: FC<{
    col: typeof sortCol;
    label: string;
    w?: string;
  }> = ({ col, label, w }) => (
    <th
      className="px-2 py-1.5 text-left cursor-pointer select-none hover:text-zinc-200 transition-colors"
      style={{ width: w }}
      onClick={() => setSort(col)}
    >
      <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
        {label}
        {sortCol === col && (
          <span className="ml-1 text-zinc-500">{sortAsc ? '▲' : '▼'}</span>
        )}
      </span>
    </th>
  );

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

        {/* Track count */}
        <span className="text-[9px] font-mono text-zinc-600 ml-auto">
          {tracks.length} tracks
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto" style={{ height: 'calc(100% - 36px)' }}>
        <table className="w-full text-zinc-400 text-[11px] font-mono">
          <thead className="sticky top-0 bg-zinc-900/90 backdrop-blur-sm border-b border-zinc-800/30">
            <tr>
              <th className="w-8" />
              <ColHead col="title" label="Title" />
              <ColHead col="artist" label="Artist" w="180px" />
              <ColHead col="bpm" label="BPM" w="60px" />
              <ColHead col="key" label="Key" w="55px" />
              <ColHead col="duration" label="Duration" w="70px" />
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => (
              <tr
                key={t.id}
                className="border-b border-zinc-800/20 hover:bg-zinc-800/20 transition-colors group"
              >
                <td className="px-2 py-1 text-zinc-600 text-center">{i + 1}</td>
                <td className="px-2 py-1 text-zinc-200 font-medium truncate max-w-[200px]">
                  {t.title}
                </td>
                <td className="px-2 py-1 truncate">{t.artist}</td>
                <td className="px-2 py-1 text-center">{t.bpm || '—'}</td>
                <td className="px-2 py-1 text-center">{t.key || '—'}</td>
                <td className="px-2 py-1 text-center">{fmtDuration(t.duration)}</td>
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
                    <button
                      type="button"
                      onClick={() => removeTrack(t.id)}
                      className="rounded px-1 py-0.5 text-[9px] text-zinc-600 hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-600 text-[11px]">
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
    </div>
  );
};
