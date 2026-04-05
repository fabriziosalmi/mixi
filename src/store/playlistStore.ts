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
import { persist } from 'zustand/middleware';

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface PlaylistState {
  playlists: Playlist[];
  /** null = "All Tracks" view. */
  selectedId: string | null;
}

interface PlaylistActions {
  createPlaylist: (name: string) => void;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addTrack: (playlistId: string, trackId: string) => void;
  removeTrack: (playlistId: string, trackId: string) => void;
  reorderTracks: (playlistId: string, trackIds: string[]) => void;
  selectPlaylist: (id: string | null) => void;
}

export type PlaylistStore = PlaylistState & PlaylistActions;

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

      selectPlaylist: (id) => set({ selectedId: id }),
    }),
    {
      name: 'mixi-playlists',
      partialize: (s) => ({ playlists: s.playlists }),
    },
  ),
);
