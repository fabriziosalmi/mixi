/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileTrackLoader — Load audio from phone storage
//
// Provides:
//   1. File picker button (accept="audio/*", multiple)
//   2. URL paste input (SoundCloud etc.)
//   3. Direct-to-deck loading (tap file → choose deck)
//   4. Batch add to browser store
//
// Renders as:
//   - Inline empty-state replacement in MobileBrowser
//   - Modal triggered by "+" button in landscape toolbar
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, type FC, type ChangeEvent } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { useBrowserStore } from '../../store/browserStore';
import { useHaptics } from '../../hooks/useHaptics';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../theme';
import { API_BASE } from '../../utils/apiBase';
import type { DeckId } from '../../types';

type LoadState = 'idle' | 'loading' | 'pick-deck' | 'error';

interface MobileTrackLoaderProps {
  /** If provided, auto-load to this deck (skip deck picker) */
  targetDeck?: DeckId;
  /** Compact mode for inline use in browser empty state */
  compact?: boolean;
}

export const MobileTrackLoader: FC<MobileTrackLoaderProps> = ({
  targetDeck,
  compact = false,
}) => {
  const [state, setState] = useState<LoadState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [loadingName, setLoadingName] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingBufferRef = useRef<{ buffer: ArrayBuffer; name: string } | null>(null);
  const haptics = useHaptics();

  // ── Core load logic ─────────────────────────────────────────

  const loadToDeck = useCallback(async (buffer: ArrayBuffer, name: string, deck: DeckId) => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) {
      setState('error');
      setErrorMsg('Audio engine not started. Go back and tap to start.');
      return;
    }

    setState('loading');
    setLoadingName(name);

    try {
      await engine.loadTrack(deck, buffer);

      const displayName = name.replace(/\.[^.]+$/, ''); // strip extension
      useMixiStore.getState().setDeckTrackName(deck, displayName);
      useMixiStore.getState().setDeckTrackLoaded(deck, true);

      // Also add to browser store so it appears in the track list
      const blob = new Blob([buffer]);
      const audioUrl = URL.createObjectURL(blob);
      const id = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      useBrowserStore.getState().addTrack({
        id,
        title: displayName,
        artist: '',
        bpm: 0,
        key: '',
        duration: 0,
        audioUrl,
        addedAt: Date.now(),
        rating: 0,
        colorTag: '',
        analyzedAt: 0,
      }, blob);

      haptics.confirm();
      setState('idle');
      setLoadingName('');
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to decode audio');
    }
  }, [haptics]);

  // ── File handling ───────────────────────────────────────────

  const handleFiles = useCallback(async (files: FileList) => {
    const file = files[0];
    if (!file) return;

    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|flac|aiff|aac|ogg|m4a|opus)$/i)) {
      setState('error');
      setErrorMsg('Not an audio file. Supported: MP3, WAV, FLAC, AAC, OGG.');
      return;
    }

    setState('loading');
    setLoadingName(file.name);

    try {
      const buffer = await file.arrayBuffer();

      if (targetDeck) {
        // Direct load to specified deck
        await loadToDeck(buffer, file.name, targetDeck);
      } else {
        // Show deck picker
        pendingBufferRef.current = { buffer, name: file.name };
        setState('pick-deck');
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to read file');
    }
  }, [targetDeck, loadToDeck]);

  const onFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFiles(files);
    e.target.value = ''; // reset so same file can be re-selected
  }, [handleFiles]);

  const pickDeck = useCallback(async (deck: DeckId) => {
    const pending = pendingBufferRef.current;
    if (!pending) return;
    pendingBufferRef.current = null;
    await loadToDeck(pending.buffer, pending.name, deck);
  }, [loadToDeck]);

  // ── URL loading ─────────────────────────────────────────────

  const handleUrlLoad = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only http/https URLs');
      }
    } catch {
      setState('error');
      setErrorMsg('Invalid URL');
      return;
    }

    setState('loading');
    setLoadingName('Streaming…');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      const res = await fetch(
        `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (!res.ok) {
        let detail = `Server error ${res.status}`;
        try { const body = await res.json(); if (body.detail) detail = body.detail; } catch {}
        throw new Error(detail);
      }

      const buffer = await res.arrayBuffer();
      const title = res.headers.get('X-Track-Title') || url.split('/').pop() || 'stream';

      if (targetDeck) {
        await loadToDeck(buffer, title, targetDeck);
      } else {
        pendingBufferRef.current = { buffer, name: title };
        setState('pick-deck');
      }
      setUrlInput('');
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load URL');
    }
  }, [urlInput, targetDeck, loadToDeck]);

  // ── Render ──────────────────────────────────────────────────

  const isLoading = state === 'loading';

  // Deck picker overlay
  if (state === 'pick-deck') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: compact ? 16 : 32,
        }}
      >
        <span style={{ fontSize: 12, color: '#888', fontFamily: 'var(--font-mono)' }}>
          Load "{pendingBufferRef.current?.name.replace(/\.[^.]+$/, '')}" to:
        </span>
        <div style={{ display: 'flex', gap: 16 }}>
          {(['A', 'B'] as DeckId[]).map((d) => (
            <button
              key={d}
              onClick={() => pickDeck(d)}
              style={{
                width: 72,
                height: 72,
                border: `2px solid ${d === 'A' ? COLOR_DECK_A : COLOR_DECK_B}`,
                borderRadius: 12,
                background: `${d === 'A' ? COLOR_DECK_A : COLOR_DECK_B}15`,
                color: d === 'A' ? COLOR_DECK_A : COLOR_DECK_B,
                fontSize: 24,
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {d}
            </button>
          ))}
        </div>
        <button
          onClick={() => { pendingBufferRef.current = null; setState('idle'); }}
          style={{
            fontSize: 11,
            color: '#666',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: compact ? 12 : 20,
        padding: compact ? 16 : 32,
      }}
    >
      {/* File picker button */}
      <button
        onClick={() => !isLoading && fileInputRef.current?.click()}
        disabled={isLoading}
        style={{
          width: compact ? 64 : 80,
          height: compact ? 64 : 80,
          borderRadius: '50%',
          border: `2px dashed ${isLoading ? '#333' : '#555'}`,
          background: isLoading ? '#111' : '#0d0d0d',
          color: isLoading ? '#444' : '#888',
          fontSize: compact ? 28 : 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isLoading ? 'wait' : 'pointer',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          transition: 'border-color 200ms',
        }}
        aria-label="Load audio file"
      >
        {isLoading ? (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '2px solid #555',
              borderTopColor: 'transparent',
              animation: 'mobileLoaderSpin 800ms linear infinite',
            }}
          />
        ) : '+'}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={onFileChange}
        style={{ display: 'none' }}
        aria-label="Select audio files"
      />

      {/* Status text */}
      {isLoading && (
        <span style={{ fontSize: 11, color: '#666', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
          {loadingName}
        </span>
      )}

      {!isLoading && !compact && (
        <span style={{ fontSize: 12, color: '#555', textAlign: 'center' }}>
          Tap to load audio from your device
        </span>
      )}

      {!isLoading && compact && (
        <span style={{ fontSize: 10, color: '#444', fontFamily: 'var(--font-mono)' }}>
          TAP TO ADD TRACKS
        </span>
      )}

      {/* URL input (collapsible) */}
      {!compact && (
        <>
          {!showUrl ? (
            <button
              onClick={() => setShowUrl(true)}
              style={{
                fontSize: 10,
                color: '#555',
                background: 'none',
                border: 'none',
                textDecoration: 'underline',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              or paste a URL
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, width: '100%', maxWidth: 300 }}>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="SoundCloud URL…"
                disabled={isLoading}
                style={{
                  flex: 1,
                  height: 40,
                  background: '#111',
                  border: '1px solid #333',
                  borderRadius: 6,
                  padding: '0 10px',
                  color: '#ccc',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <button
                onClick={handleUrlLoad}
                disabled={isLoading || !urlInput.trim()}
                style={{
                  height: 40,
                  padding: '0 14px',
                  border: '1px solid #555',
                  borderRadius: 6,
                  background: '#1a1a1a',
                  color: '#aaa',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  opacity: isLoading || !urlInput.trim() ? 0.4 : 1,
                }}
              >
                LOAD
              </button>
            </div>
          )}
        </>
      )}

      {/* Error */}
      {state === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#ef4444', textAlign: 'center' }}>{errorMsg}</span>
          <button
            onClick={() => { setState('idle'); setErrorMsg(''); }}
            style={{
              fontSize: 10,
              color: '#666',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <style>{`
        @keyframes mobileLoaderSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
