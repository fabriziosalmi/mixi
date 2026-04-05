/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI — PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Session Save/Load Store
//
// Named snapshots of the full mixer state.  Users can save
// their current setup (EQ, volumes, FX, crossfader, loaded
// tracks, deck modes) and restore it later.
//
// Persisted to localStorage under 'mixi-sessions'.
// ─────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from './safeStorage';
import { useMixiStore } from './mixiStore';
import type { MasterState, EqState, DeckId, CrossfaderCurve, DeckMode } from '../types';

/** Snapshot of one deck's restorable state. */
export interface DeckSnapshot {
  trackName: string;
  volume: number;
  gain: number;
  eq: EqState;
  colorFx: number;
  playbackRate: number;
  bpm: number;
  keyLock: boolean;
  quantize: boolean;
  deckMode: DeckMode;
}

/** Full session snapshot. */
export interface SessionSnapshot {
  id: string;
  name: string;
  savedAt: number;
  master: MasterState;
  crossfader: number;
  crossfaderCurve: CrossfaderCurve;
  decks: Record<DeckId, DeckSnapshot>;
}

interface SessionState {
  sessions: SessionSnapshot[];
}

interface SessionActions {
  saveSession: (name: string) => void;
  loadSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
}

export type SessionStore = SessionState & SessionActions;

let _sessCounter = 0;

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      sessions: [],

      saveSession: (name) => {
        const s = useMixiStore.getState();
        const makeDeckSnap = (d: DeckId): DeckSnapshot => ({
          trackName: s.decks[d].trackName,
          volume: s.decks[d].volume,
          gain: s.decks[d].gain,
          eq: { ...s.decks[d].eq },
          colorFx: s.decks[d].colorFx,
          playbackRate: s.decks[d].playbackRate,
          bpm: s.decks[d].bpm,
          keyLock: s.decks[d].keyLock,
          quantize: s.decks[d].quantize,
          deckMode: s.deckModes[d],
        });

        const snap: SessionSnapshot = {
          id: `sess-${Date.now()}-${++_sessCounter}`,
          name,
          savedAt: Date.now(),
          master: { ...s.master },
          crossfader: s.crossfader,
          crossfaderCurve: s.crossfaderCurve,
          decks: { A: makeDeckSnap('A'), B: makeDeckSnap('B') },
        };

        set((st) => ({ sessions: [snap, ...st.sessions] }));
      },

      loadSession: (id) => {
        const { sessions } = useSessionStore.getState();
        const snap = sessions.find((s) => s.id === id);
        if (!snap) return;

        const store = useMixiStore.getState();

        // S2: Stop playback on both decks FIRST to avoid audio artifacts
        for (const d of ['A', 'B'] as const) {
          if (store.decks[d].isPlaying) {
            store.setDeckPlaying(d, false);
          }
        }

        // Restore master
        store.setMasterVolume(snap.master.volume ?? 1);
        store.setMasterFilter(snap.master.filter ?? 0);
        store.setMasterDistortion(snap.master.distortion ?? 0);
        store.setMasterPunch(snap.master.punch ?? 0);
        if (snap.master.eq) {
          store.setMasterEq('low', snap.master.eq.low ?? 0);
          store.setMasterEq('mid', snap.master.eq.mid ?? 0);
          store.setMasterEq('high', snap.master.eq.high ?? 0);
        }

        // Restore crossfader + curve
        store.setCrossfader(snap.crossfader ?? 0.5);
        if (snap.crossfaderCurve) store.setCrossfaderCurve(snap.crossfaderCurve);

        // S6: Restore per-deck state with defensive defaults
        for (const d of ['A', 'B'] as const) {
          const ds = snap.decks?.[d];
          if (!ds) continue; // Skip if deck snapshot missing
          store.setDeckGain(d, ds.gain ?? 0);
          store.setDeckVolume(d, ds.volume ?? 1);
          const eq = ds.eq ?? { low: 0, mid: 0, high: 0 };
          store.setDeckEq(d, 'low', eq.low ?? 0);
          store.setDeckEq(d, 'mid', eq.mid ?? 0);
          store.setDeckEq(d, 'high', eq.high ?? 0);
          store.setDeckColorFx(d, ds.colorFx ?? 0);
          store.setDeckPlaybackRate(d, ds.playbackRate ?? 1);
          store.setKeyLock(d, ds.keyLock ?? false);
          store.setQuantize(d, ds.quantize ?? false);
          store.setDeckMode(d, ds.deckMode ?? 'track');
        }
      },

      deleteSession: (id) =>
        set((s) => ({ sessions: s.sessions.filter((ss) => ss.id !== id) })),

      renameSession: (id, name) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => ss.id === id ? { ...ss, name } : ss),
        })),
    }),
    { name: 'mixi-sessions', storage: createJSONStorage(() => safeStorage) },
  ),
);
