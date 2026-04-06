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
  useEffect,
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

// ── Module card icons & descriptions ────────────────────────

/** Unique wireframe SVG per module — stroke-only, technical aesthetic */
const MODULE_ICONS: Record<string, React.ReactNode> = {
  groovebox: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {[0,1,2,3].flatMap(r => [0,1,2,3].map(c => (
        <rect key={`${r}${c}`} x={2+c*5.5} y={2+r*5.5} width="4" height="4" rx="0.5"
          opacity={[0,2,5,7,8,10,13,15].includes(r*4+c) ? 1 : 0.25} />
      )))}
    </svg>
  ),
  turbokick: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12 L6 12 L8 3 L10 21 L12 8 L14 14 L16 11 L18 12.5 L22 12" />
      <circle cx="12" cy="12" r="10" strokeWidth="0.5" opacity="0.2" />
    </svg>
  ),
  js303: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 16 L5 6 L5 16 L8 6 L8 16 L11 6 L11 16 L14 6 L14 16 L17 6 L17 16 L20 6 L20 16 L22 16" />
      <line x1="2" y1="16" x2="22" y2="16" strokeWidth="0.5" opacity="0.3" />
    </svg>
  ),
};

/** Short descriptions per module */
const MODULE_SUBS: Record<string, string> = {
  groovebox: 'Drum Machine',
  turbokick: 'Kick Synth',
  js303: 'Acid Synth',
};

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
  const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
  const otherDeckMode = useMixiStore((s) => s.deckModes[otherDeckId]);
  const [state, setState] = useState<LoadingState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteFlash, setPasteFlash] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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
        // SEC-2: Validate URL protocol
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Only http/https URLs are supported');
          }
        } catch (urlErr) {
          if (urlErr instanceof Error && urlErr.message.includes('Only http')) throw urlErr;
          throw new Error('Invalid URL format');
        }

        log.info('Loader', `Deck ${deckId} – fetching stream from proxy: ${url}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        const res = await fetch(
          `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`,
          { signal: controller.signal },
        );
        clearTimeout(timeout);

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

  // ── Paste interception (CMD+V with URL auto-loads) ─────────

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

      const text = e.clipboardData?.getData('text')?.trim();
      if (!text || !text.startsWith('http')) return;

      e.preventDefault();
      setUrlInput(text);
      setPasteFlash(true);
      setTimeout(() => setPasteFlash(false), 600);

      // Auto-submit after state update
      setTimeout(() => formRef.current?.requestSubmit(), 50);
    },
    [],
  );

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

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
          <LoadingCrumble deckId={deckId} color={color} />
        ) : (
          <div className="flex flex-col items-center gap-3">
            {/* Vinyl disc — breathing idle animation */}
            <svg
              width="48" height="48" viewBox="0 0 48 48"
              fill="none" stroke="currentColor" strokeWidth="1"
              className="mixi-breathe-vinyl"
              style={{ color: `${color}66` }}
            >
              <circle cx="24" cy="24" r="22" />
              <circle cx="24" cy="24" r="18" strokeWidth="0.5" opacity="0.4" />
              <circle cx="24" cy="24" r="14" strokeWidth="0.5" opacity="0.3" />
              <circle cx="24" cy="24" r="10" strokeWidth="0.5" opacity="0.2" />
              <circle cx="24" cy="24" r="6" strokeWidth="1" opacity="0.6" />
              <circle cx="24" cy="24" r="1.5" fill="currentColor" stroke="none" opacity="0.5" />
            </svg>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-zinc-500 text-xs">
                Drop your track here or <span className="underline text-zinc-400 cursor-pointer">browse</span>
              </span>
              <span className="text-zinc-600 text-[9px] font-mono tracking-wider">
                WAV · MP3 · FLAC · AIFF
              </span>
            </div>
          </div>
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
      <form ref={formRef} onSubmit={handleUrlLoad} className="flex gap-1.5">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isLoading}
          placeholder="SoundCloud URL…"
          className={`
            flex-1 rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-1.5
            text-xs text-zinc-300 placeholder:text-zinc-500
            focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500
            disabled:opacity-40 transition-shadow duration-300
            ${pasteFlash ? 'ring-2 ring-green-500/50' : ''}
          `}
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

      {/* ── House deck module picker (MPC-style cards) ─────── */}
      {onSwitchModule && (
        <div className="flex flex-col gap-2 pt-2 mt-2 border-t border-zinc-800/20">
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-[0.2em]">
            or load module
          </span>
          <div className="grid grid-cols-3 gap-2">
            {HOUSE_DECKS.map((deck) => {
              const inUseOnOther = otherDeckMode === deck.mode;
              return (
                <button
                  key={deck.mode}
                  type="button"
                  onClick={() => onSwitchModule(deck.mode)}
                  className="
                    group flex flex-col items-center gap-1 rounded-lg
                    px-2 py-3 transition-all duration-150
                    active:scale-95 cursor-pointer
                  "
                  style={{
                    background: '#1a1a1a',
                    borderTop: '1px solid #333',
                    borderLeft: '1px solid #2a2a2a',
                    borderRight: '1px solid #222',
                    borderBottom: '1px solid #111',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 4px rgba(0,0,0,0.4)',
                    opacity: inUseOnOther ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow =
                      `inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 8px ${deck.accentColor}20, 0 0 1px ${deck.accentColor}44`;
                    e.currentTarget.style.borderColor = `${deck.accentColor}33`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow =
                      'inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 4px rgba(0,0,0,0.4)';
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.borderTop = '1px solid #333';
                    e.currentTarget.style.borderLeft = '1px solid #2a2a2a';
                    e.currentTarget.style.borderRight = '1px solid #222';
                    e.currentTarget.style.borderBottom = '1px solid #111';
                  }}
                >
                  {/* Module icon */}
                  <div
                    className="opacity-50 group-hover:opacity-90 transition-opacity"
                    style={{ color: deck.accentColor }}
                  >
                    {MODULE_ICONS[deck.mode] ?? null}
                  </div>
                  {/* Label */}
                  <span
                    className="text-[10px] font-mono font-bold uppercase tracking-widest"
                    style={{ color: deck.accentColor }}
                  >
                    {deck.label}
                  </span>
                  {/* Subtitle */}
                  <span className="text-[8px] text-zinc-500 font-mono">
                    {MODULE_SUBS[deck.mode] ?? ''}
                  </span>
                  {/* "In use" indicator */}
                  {inUseOnOther && (
                    <span className="text-[7px] text-zinc-500 font-mono mt-0.5">
                      Active on {otherDeckId}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Tiny sub-components ──────────────────────────────────────

/** CSS-only spinner. */
// ── Crumble-text loading indicator (Claude Code style) ──────

const LoadingCrumble: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const stage = useMixiStore((s) => s.decks[deckId].loadingStage);
  const [dots, setDots] = useState('');

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(timer);
  }, []);

  const text = stage || 'loading';

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        style={{ color }}
      />
      <span
        className="text-[11px] font-mono tracking-wider"
        style={{ color, minWidth: 140, textAlign: 'center' }}
      >
        {text}{dots}
      </span>
    </div>
  );
};

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
