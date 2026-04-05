/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI — PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Playlist / Crates Store
//
// Manages user-created playlists. Each playlist holds an
// ordered list of track IDs referencing TrackEntry in
// browserStore.  Persisted to localStorage.
// ─────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from './safeStorage';

/** Smart playlist filter criteria. If set, trackIds is auto-populated. */
export interface SmartFilter {
  bpmMin?: number;
  bpmMax?: number;
  keys?: string[];       // e.g. ['8A', '9A', '8B'] — Camelot codes
  ratingMin?: number;    // 1–5
  colorTags?: string[];  // hex colors to include
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  /** If set, this is a smart playlist — trackIds are computed from filter. */
  smart?: SmartFilter;
}

interface PlaylistState {
  playlists: Playlist[];
  /** null = "All Tracks" view. */
  selectedId: string | null;
}

interface PlaylistActions {
  createPlaylist: (name: string) => void;
  createSmartPlaylist: (name: string, filter: SmartFilter) => void;
  updateSmartFilter: (id: string, filter: SmartFilter) => void;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addTrack: (playlistId: string, trackId: string) => void;
  removeTrack: (playlistId: string, trackId: string) => void;
  reorderTracks: (playlistId: string, trackIds: string[]) => void;
  selectPlaylist: (id: string | null) => void;
}

export type PlaylistStore = PlaylistState & PlaylistActions;

/** Check if a track matches a smart filter. */
export function matchesSmartFilter(
  track: { bpm: number; key: string; rating: number; colorTag: string },
  filter: SmartFilter,
): boolean {
  if (filter.bpmMin != null && track.bpm < filter.bpmMin) return false;
  if (filter.bpmMax != null && track.bpm > filter.bpmMax) return false;
  if (filter.keys?.length && !filter.keys.includes(track.key)) return false;
  if (filter.ratingMin != null && track.rating < filter.ratingMin) return false;
  if (filter.colorTags?.length && !filter.colorTags.includes(track.colorTag)) return false;
  return true;
}

let _plCounter = 0;

export const usePlaylistStore = create<PlaylistStore>()(
  persist(
    (set) => ({
      playlists: [],
      selectedId: null,

      createPlaylist: (name) => {
        const id = `pl-${Date.now()}-${++_plCounter}`;
        const now = Date.now();
        set((s) => ({
          playlists: [...s.playlists, { id, name, trackIds: [], createdAt: now, updatedAt: now }],
          selectedId: id,
        }));
      },

      createSmartPlaylist: (name, filter) => {
        const id = `spl-${Date.now()}-${++_plCounter}`;
        const now = Date.now();
        set((s) => ({
          playlists: [...s.playlists, { id, name, trackIds: [], createdAt: now, updatedAt: now, smart: filter }],
          selectedId: id,
        }));
      },

      updateSmartFilter: (id, filter) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, smart: filter, updatedAt: Date.now() } : p,
          ),
        })),

      deletePlaylist: (id) =>
        set((s) => ({
          playlists: s.playlists.filter((p) => p.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),

      renamePlaylist: (id, name) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, name, updatedAt: Date.now() } : p,
          ),
        })),

      addTrack: (playlistId, trackId) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId && !p.trackIds.includes(trackId)
              ? { ...p, trackIds: [...p.trackIds, trackId], updatedAt: Date.now() }
              : p,
          ),
        })),

      removeTrack: (playlistId, trackId) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId), updatedAt: Date.now() }
              : p,
          ),
        })),

      reorderTracks: (playlistId, trackIds) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, trackIds, updatedAt: Date.now() } : p,
          ),
        })),

      selectPlaylist: (id) =>
        set((s) => {
          // S7: Verify playlist exists before selecting
          if (id !== null && !s.playlists.find((p) => p.id === id)) return { selectedId: null };
          return { selectedId: id };
        }),
    }),
    {
      name: 'mixi-playlists',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ playlists: s.playlists }),
    },
  ),
);
