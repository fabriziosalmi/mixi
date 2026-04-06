/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Track Loader
//
// Dual-mode track loading for a single deck:
//
//   1. Local file  → Drag & Drop or file picker
//                    FileReader → ArrayBuffer → MixiEngine.loadTrack
//
//   2. SoundCloud  → Paste URL → fetch via our proxy backend
//                    /api/stream?url=… → ArrayBuffer → MixiEngine.loadTrack
//
// The component is self-contained: it manages its own loading
// state, error display, and drag-over visual feedback.
// ─────────────────────────────────────────────────────────────

import {
  useState,
  useCallback,
  useRef,
  type FC,
  type DragEvent,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { HOUSE_DECKS } from '../../decks';
import { useMixiStore } from '../../store/mixiStore';
import { log } from '../../utils/logger';
import type { DeckId, DeckMode } from '../../types';

// ── Config ───────────────────────────────────────────────────

import { API_BASE } from '../../utils/apiBase';

// ── Types ────────────────────────────────────────────────────

interface TrackLoaderProps {
  deckId: DeckId;
  color: string;
  /** Called after a track is successfully loaded. */
  onTrackLoaded?: (name: string) => void;
  /** Called when user switches to groovebox mode. */
  onSwitchToGroovebox?: () => void;
  /** Called when user picks any house deck module. */
  onSwitchModule?: (mode: DeckMode) => void;
}

type LoadingState = 'idle' | 'loading' | 'error';

// ── Component ────────────────────────────────────────────────

export const TrackLoader: FC<TrackLoaderProps> = ({
  deckId,
  color,
  onTrackLoaded,
  onSwitchToGroovebox: _legacyGroovebox,
  onSwitchModule,
}) => {
  const setTrackLoaded = useMixiStore((s) => s.setDeckTrackLoaded);
  const setStoreTrackName = useMixiStore((s) => s.setDeckTrackName);
  const [state, setState] = useState<LoadingState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLoading = state === 'loading';

  // ── Shared load logic ──────────────────────────────────────

  const loadBuffer = useCallback(
    async (buffer: ArrayBuffer, name: string) => {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) {
        throw new Error('Audio engine not initialised. Click "Inizia" first.');
      }
      const t0 = performance.now();
      await engine.loadTrack(deckId, buffer);
      const ms = (performance.now() - t0).toFixed(0);
      log.success('Loader', `Deck ${deckId} – "${name}" decoded in ${ms} ms (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      setStoreTrackName(deckId, name);
      setTrackLoaded(deckId, true);
      onTrackLoaded?.(name);
    },
    [deckId, onTrackLoaded, setStoreTrackName, setTrackLoaded],
  );

  // ── Local file handling ────────────────────────────────────

  const handleFile = useCallback(
    async (file: File) => {
      setState('loading');
      setErrorMsg('');
      try {
        log.info('Loader', `Deck ${deckId} – reading local file "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
        const buffer = await file.arrayBuffer();
        await loadBuffer(buffer, file.name);
        setState('idle');
      } catch (err) {
        log.error('Loader', `Deck ${deckId} – local file failed`, err);
        setState('error');
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load file.');
      }
    },
    [loadBuffer, deckId],
  );

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be re-selected.
      e.target.value = '';
    },
    [handleFile],
  );

  // ── Drag & Drop ────────────────────────────────────────────

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('audio/')) {
        handleFile(file);
      } else {
        setState('error');
        setErrorMsg('Drop an audio file (MP3, WAV, FLAC, etc.).');
      }
    },
    [handleFile],
  );

  // ── SoundCloud URL loading ─────────────────────────────────

  const handleUrlLoad = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const url = urlInput.trim();
      if (!url) return;

      setState('loading');
      setErrorMsg('');

      try {
        log.info('Loader', `Deck ${deckId} – fetching stream from proxy: ${url}`);
        const res = await fetch(
          `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`,
        );

        if (!res.ok) {
          // Try to extract a detail message from the JSON error body.
          let detail = `Server error ${res.status}`;
          try {
            const body = await res.json();
            if (body.detail) detail = body.detail;
          } catch {
            // body wasn't JSON – use the status text.
          }
          throw new Error(detail);
        }

        const buffer = await res.arrayBuffer();

        // Use the X-Track-Title header if the proxy sent one.
        const title = res.headers.get('X-Track-Title') || urlToName(url);

        await loadBuffer(buffer, title);
        setState('idle');
        setUrlInput('');
      } catch (err) {
        log.error('Loader', `Deck ${deckId} – stream fetch failed`, err);
        setState('error');
        setErrorMsg(
          err instanceof Error ? err.message : 'Failed to load from URL.',
        );
      }
    },
    [urlInput, loadBuffer, deckId],
  );

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm px-6">
      {/* ── Deck Identity Bar ─────────────────────────────── */}
      <div
        className="flex items-center gap-2 -mx-6 -mt-2 px-4 py-2 mb-1"
        style={{
          background: `linear-gradient(90deg, ${color}08, transparent)`,
          borderBottom: `1px solid ${color}18`,
          boxShadow: `0 10px 30px ${color}08`,
        }}
      >
        <span
          className="text-2xl font-black tracking-widest"
          style={{ color, textShadow: `0 0 12px ${color}44` }}
        >
          {deckId}
        </span>
        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.2em]">
          Load Track
        </span>
      </div>

      {/* ── Drop Zone ───────────────────────────────────────── */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isLoading && fileInputRef.current?.click()}
        className={`
          flex items-center justify-center rounded-lg border border-dashed
          px-4 py-14 text-center text-xs cursor-pointer
          transition-all duration-200
          ${isLoading ? 'pointer-events-none opacity-50' : ''}
        `}
        style={{
          borderColor: isDragOver ? `${color}88` : '#333',
          background: isDragOver
            ? `radial-gradient(ellipse at center, ${color}12 0%, transparent 70%)`
            : '#0a0a0a',
          boxShadow: isDragOver
            ? `inset 0 4px 20px rgba(0,0,0,0.6), 0 0 30px ${color}15`
            : 'inset 0 4px 15px rgba(0,0,0,0.8)',
        }}
      >
        {isLoading ? (
          <Spinner color={color} />
        ) : (
          <span className="text-zinc-500">
            Drop audio file or <span className="underline text-zinc-400">browse</span>
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onFileChange}
        aria-label={`Load audio file for Deck ${deckId}`}
      />

      {/* ── URL Input ───────────────────────────────────────── */}
      <form onSubmit={handleUrlLoad} className="flex gap-1.5">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isLoading}
          placeholder="SoundCloud URL…"
          className="
            flex-1 rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-1.5
            text-xs text-zinc-300 placeholder:text-zinc-500
            focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500
            disabled:opacity-40
          "
        />
        <button
          type="submit"
          disabled={isLoading || !urlInput.trim()}
          className="
            rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider
            transition-all active:scale-95
            disabled:opacity-30 disabled:cursor-not-allowed
          "
          style={{
            borderColor: `${color}66`,
            color,
            background: `${color}11`,
          }}
        >
          {isLoading ? '…' : 'Load'}
        </button>
      </form>

      {/* ── Error message ───────────────────────────────────── */}
      {state === 'error' && errorMsg && (
        <p className="text-[11px] text-red-400 leading-tight">{errorMsg}</p>
      )}

      {/* ── House deck module picker ─────────────────────────── */}
      {onSwitchModule && (
        <div className="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-zinc-800/30 flex-wrap">
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">or load module</span>
          {HOUSE_DECKS.map((deck) => (
            <button
              key={deck.mode}
              type="button"
              onClick={() => onSwitchModule(deck.mode)}
              className="
                flex items-center gap-1.5 rounded-md border px-3 py-1.5
                text-[10px] font-mono font-bold uppercase tracking-widest
                transition-all active:scale-95 hover:brightness-125
              "
              style={{
                borderColor: `${deck.accentColor}44`,
                color: deck.accentColor,
                background: `${deck.accentColor}0a`,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="3" height="3" rx="0.5" />
                <rect x="5" y="1" width="3" height="3" rx="0.5" />
                <rect x="9" y="1" width="3" height="3" rx="0.5" />
                <rect x="13" y="1" width="2" height="3" rx="0.5" />
                <rect x="1" y="5" width="3" height="3" rx="0.5" />
                <rect x="5" y="5" width="3" height="3" rx="0.5" />
                <rect x="9" y="5" width="3" height="3" rx="0.5" />
                <rect x="13" y="5" width="2" height="3" rx="0.5" />
              </svg>
              {deck.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Tiny sub-components ──────────────────────────────────────

/** CSS-only spinner. */
const Spinner: FC<{ color: string }> = ({ color }) => (
  <div
    className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    style={{ color }}
  />
);

/** Extract a readable name from a URL (last path segment). */
function urlToName(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop() || 'stream';
    return decodeURIComponent(last);
  } catch {
    return 'stream';
  }
}
