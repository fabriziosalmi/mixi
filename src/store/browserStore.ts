/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Track Browser Store
//
// Manages the track library, browser panel visibility,
// search/sort state, and yt-dlp URL import queue.
//
// Audio blobs are persisted in IndexedDB (trackDb) so tracks
// survive page reloads.  Object URLs are re-created on hydration.
// ─────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { saveTrackBlob, deleteTrackBlob, getTrackBlob } from './trackDb';

/** Fixed color palette for track tags (Rekordbox-style). */
export const TAG_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'] as const;

export interface TrackEntry {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  duration: number; // seconds
  /** Runtime-only object URL — regenerated from IndexedDB on reload. */
  audioUrl: string;
  addedAt: number;
  /** Star rating 0–5 (0 = unrated). */
  rating: number;
  /** Hex color tag, or empty string if none. */
  colorTag: string;
  /** Timestamp of last BPM/key analysis (0 = never analyzed via batch). */
  analyzedAt: number;
}

interface BrowserState {
  open: boolean;
  tracks: TrackEntry[];
  search: string;
  sortCol: keyof Pick<TrackEntry, 'title' | 'artist' | 'bpm' | 'key' | 'duration' | 'rating'>;
  sortAsc: boolean;
  /** True while hydrating blobs from IndexedDB after page reload. */
  hydrating: boolean;
}

interface BrowserActions {
  toggle: () => void;
  setOpen: (v: boolean) => void;
  setSearch: (q: string) => void;
  setSort: (col: BrowserState['sortCol']) => void;
  /** Add a track. If blob is provided, it's stored in IndexedDB. */
  addTrack: (t: TrackEntry, blob?: Blob) => void;
  removeTrack: (id: string) => void;
  /** Re-create object URLs from IndexedDB after page reload. */
  hydrateAudioUrls: () => Promise<void>;
  /** Set star rating (0–5) for a track. */
  setTrackRating: (id: string, rating: number) => void;
  /** Set color tag (hex string or '' to clear). */
  setTrackColorTag: (id: string, color: string) => void;
  /** Update BPM/key from batch analysis. */
  updateTrackAnalysis: (id: string, bpm: number, key: string) => void;
}

export type BrowserStore = BrowserState & BrowserActions;

export const useBrowserStore = create<BrowserStore>()(
  persist(
    (set, get) => ({
      open: false,
      tracks: [],
      search: '',
      sortCol: 'title',
      sortAsc: true,
      hydrating: false,

      toggle: () => set({ open: !get().open }),
      setOpen: (v) => set({ open: v }),
      setSearch: (q) => set({ search: q }),
      setSort: (col) => {
        const s = get();
        set({
          sortCol: col,
          sortAsc: s.sortCol === col ? !s.sortAsc : true,
        });
      },
      addTrack: (t, blob) => {
        // Persist blob to IndexedDB (fire & forget).
        if (blob) saveTrackBlob(t.id, blob).catch(() => {});
        set((s) => ({ tracks: [t, ...s.tracks] }));
      },
      removeTrack: (id) =>
        set((s) => {
          const track = s.tracks.find((t) => t.id === id);
          if (track?.audioUrl) {
            try { URL.revokeObjectURL(track.audioUrl); } catch { /* noop */ }
          }
          deleteTrackBlob(id).catch(() => {});
          return { tracks: s.tracks.filter((t) => t.id !== id) };
        }),
      setTrackRating: (id, rating) =>
        set((s) => ({
          tracks: s.tracks.map((t) => t.id === id ? { ...t, rating: Math.max(0, Math.min(5, rating)) } : t),
        })),
      setTrackColorTag: (id, color) =>
        set((s) => ({
          tracks: s.tracks.map((t) => t.id === id ? { ...t, colorTag: color } : t),
        })),
      updateTrackAnalysis: (id, bpm, key) =>
        set((s) => ({
          tracks: s.tracks.map((t) => t.id === id ? { ...t, bpm, key, analyzedAt: Date.now() } : t),
        })),
      hydrateAudioUrls: async () => {
        const { tracks } = get();
        if (!tracks.length) return;
        set({ hydrating: true });
        const updated = await Promise.all(
          tracks.map(async (t) => {
            // Skip tracks that already have a working URL (just added this session).
            if (t.audioUrl && t.audioUrl.startsWith('blob:')) {
              return t;
            }
            try {
              const blob = await getTrackBlob(t.id);
              if (blob) {
                return { ...t, audioUrl: URL.createObjectURL(blob) };
              }
            } catch { /* noop */ }
            // Blob not found — mark as stale (empty URL).
            return { ...t, audioUrl: '' };
          }),
        );
        // Remove tracks whose blobs are gone.
        set({ tracks: updated.filter((t) => t.audioUrl !== ''), hydrating: false });
      },
    }),
    {
      name: 'mixi-browser',
      partialize: (s) => ({
        tracks: s.tracks.map(({ audioUrl: _url, ...rest }) => ({
          ...rest,
          audioUrl: '', // Don't persist object URLs — they die on reload.
        })),
      }),
    },
  ),
);
