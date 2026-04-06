/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Zustand State Manager
//
// Represents the entire mixer control surface as a pure state
// object. No audio logic lives here – the store is a "digital
// twin" of the hardware knobs & faders.
//
// External consumers:
//   - React UI (read & write via hooks)
//   - useMixiSync bridge (subscribes → forwards to MixiEngine)
//   - AI Agent via MCP (future – calls actions like setCrossfader)
// ─────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist, subscribeWithSelector, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from './safeStorage';
import type {
  DeckId,
  DeckMode,
  EqBand,
  EqValue,
  UnitValue,
  GainValue,
  ColorFxValue,
  PlaybackRate,
  WaveformPoint,
  LoopState,
  AiMode,
  CrossfaderCurve,
  MixerState,
} from '../types';
import { HOT_CUE_COUNT } from '../types';
import { clamp } from '../audio/utils/mathUtils';
import { MixiEngine } from '../audio/MixiEngine';
import { saveHotCues, loadHotCues } from './hotCueStorage';
import { useSettingsStore } from './settingsStore';
import type { QuantizeResolution } from './settingsStore';

// ── Edge-case debounce/throttle timestamps ───────────────────
const _syncLastCall: Record<string, number> = {};
const _hotCueLastCall: Record<string, number> = {};

// ── Actions interface ────────────────────────────────────────

export interface MixiActions {
  // Master
  setMasterVolume: (v: UnitValue) => void;
  setMasterEq: (band: EqBand, v: number) => void;
  setMasterFilter: (v: number) => void;
  setMasterDistortion: (v: UnitValue) => void;
  setMasterPunch: (v: UnitValue) => void;

  // Crossfader
  setCrossfader: (v: UnitValue) => void;
  setCrossfaderCurve: (curve: CrossfaderCurve) => void;

  // Per-deck
  ejectDeck: (deck: DeckId) => void;
  setDeckTrackLoaded: (deck: DeckId, loaded: boolean) => void;
  setDeckPlaying: (deck: DeckId, playing: boolean) => void;
  setDeckGain: (deck: DeckId, v: GainValue) => void;
  setDeckVolume: (deck: DeckId, v: UnitValue) => void;
  setDeckEq: (deck: DeckId, band: EqBand, v: EqValue) => void;
  setDeckColorFx: (deck: DeckId, v: ColorFxValue) => void;
  setDeckPlaybackRate: (deck: DeckId, v: PlaybackRate) => void;
  setDeckWaveform: (deck: DeckId, data: WaveformPoint[] | null, duration: number) => void;

  // BPM & Sync
  setDeckBpm: (deck: DeckId, bpm: number, firstBeatOffset: number) => void;
  setDeckAnalysis: (deck: DeckId, dropBeats: number[], musicalKey: string) => void;
  setDeckTrackName: (deck: DeckId, name: string) => void;
  syncDeck: (deck: DeckId) => void;
  unsyncDeck: (deck: DeckId) => void;

  // Hot Cues
  setHotCue: (deck: DeckId, index: number, time: number) => void;
  triggerHotCue: (deck: DeckId, index: number) => void;
  deleteHotCue: (deck: DeckId, index: number) => void;

  // Beat Jump
  beatJump: (deck: DeckId, beats: number) => void;
  // Shift Beatgrid
  shiftGrid: (deck: DeckId, beats: number) => void;
  // Vinyl Brake
  vinylBrake: (deck: DeckId) => void;
  // Slip Mode
  setSlipMode: (deck: DeckId, active: boolean) => void;

  // Auto Loop
  setAutoLoop: (deck: DeckId, beats: number) => void;
  exitLoop: (deck: DeckId) => void;

  // Quantize
  setQuantize: (deck: DeckId, enabled: boolean) => void;

  // Key Lock
  setKeyLock: (deck: DeckId, enabled: boolean) => void;

  // PFL / Cue
  toggleCue: (deck: DeckId) => void;

  // Headphones
  setHeadphoneLevel: (v: UnitValue) => void;
  setHeadphoneMix: (v: UnitValue) => void;
  toggleSplitMode: () => void;

  // AI control
  setAiMode: (mode: AiMode) => void;
  setAiPaused: (paused: boolean) => void;
  /** Called on every human interaction (pointer down, click). */
  registerUserInteraction: () => void;

  // Deck mode (track / groovebox)
  setDeckMode: (deck: DeckId, mode: DeckMode) => void;
}

// ── Combined store type ──────────────────────────────────────

export type MixiStore = MixerState & MixiActions;

// ── Default deck state ───────────────────────────────────────

function defaultDeck() {
  return {
    isPlaying: false,
    isTrackLoaded: false,
    gain: 0,
    volume: 1.0,
    eq: { low: 0, mid: 0, high: 0 },
    colorFx: 0,
    playbackRate: 1.0,
    waveformData: null,
    duration: 0,
    bpm: 0,
    originalBpm: 0,
    firstBeatOffset: 0,
    isSynced: false,
    hotCues: new Array(HOT_CUE_COUNT).fill(null) as (number | null)[],
    activeLoop: null as LoopState | null,
    quantize: true,
    keyLock: false,
    slipModeActive: false,
    cueActive: false,
    trackName: '',
    dropBeats: [] as number[],
    musicalKey: '',
  };
}

// ── Helpers ──────────────────────────────────────────────────

function otherDeck(deck: DeckId): DeckId {
  return deck === 'A' ? 'B' : 'A';
}

/**
 * Snap a time value to the nearest beat on the grid.
 *
 *   beatPeriod = 60 / bpm
 *   gridPeriod = beatPeriod * resolution  (e.g. 0.25 = snap to 1/4 beat)
 *   gridIndex  = round((time - offset) / gridPeriod)
 *   snapped    = offset + gridIndex * gridPeriod
 */
function quantizeTime(time: number, bpm: number, offset: number, resolution: QuantizeResolution = 1): number {
  if (bpm <= 0) return time;
  const period = (60 / bpm) * resolution;
  const gridIndex = Math.round((time - offset) / period);
  return offset + gridIndex * period;
}

// ── Store creation ───────────────────────────────────────────

export const useMixiStore = create<MixiStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
    // ── Initial state ────────────────────────────────────────
    master: { volume: 1.0, eq: { low: 0, mid: 0, high: 0 }, filter: 0, distortion: 0, punch: 0 },
    crossfader: 0.5,
    crossfaderCurve: 'smooth' as CrossfaderCurve,
    headphones: { level: 1.0, mix: 0, splitMode: false },
    ai: { mode: 'OFF', isPaused: false, lastInteractionTime: 0, assistResumeDelay: 10 },
    deckModes: { A: 'track', B: 'track' } as Record<DeckId, DeckMode>,
    decks: {
      A: defaultDeck(),
      B: defaultDeck(),
    },

    // ── Actions ──────────────────────────────────────────────

    setMasterVolume: (v) =>
      set((s) => ({ master: { ...s.master, volume: clamp(v, 0, 1) } })),

    setMasterEq: (band, v) =>
      set((s) => ({ master: { ...s.master, eq: { ...s.master.eq, [band]: clamp(v, -12, 12) } } })),

    setMasterFilter: (v) =>
      set((s) => ({ master: { ...s.master, filter: clamp(v, -1, 1) } })),

    setMasterDistortion: (v) =>
      set((s) => ({ master: { ...s.master, distortion: clamp(v, 0, 1) } })),

    setMasterPunch: (v) =>
      set((s) => ({ master: { ...s.master, punch: clamp(v, 0, 1) } })),

    setCrossfader: (v) =>
      set({ crossfader: clamp(v, 0, 1) }),

    setCrossfaderCurve: (curve) =>
      set({ crossfaderCurve: curve }),

    ejectDeck: (deck) => {
      // Stop playback first.
      const engine = MixiEngine.getInstance();
      if (engine.isInitialized) {
        const s = get();
        if (s.decks[deck].isPlaying) engine.pause(deck);
        // BUG-13/20/19: Reset all FX to prevent ghost tails & stuck gate.
        engine.resetDeckFx(deck);
      }
      // BUG-21: Bump load generation so any in-flight decode is discarded.
      engine.bumpLoadGen(deck);
      // Reset deck to defaults.
      set((s) => ({
        decks: { ...s.decks, [deck]: defaultDeck() },
      }));
    },

    setDeckTrackLoaded: (deck, loaded) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], isTrackLoaded: loaded },
        },
      })),

    setDeckPlaying: (deck, playing) =>
      set((s) => {
        // #43: Guard — no transport actions on empty decks.
        if (!s.decks[deck].isTrackLoaded && playing) return s;

        const updated = {
          decks: {
            ...s.decks,
            [deck]: { ...s.decks[deck], isPlaying: playing },
          },
        };

        // Edge-case #3: Master Clock Handoff.
        // If a playing deck (tempo source) stops, and the other deck
        // is synced, the other deck becomes the new tempo reference
        // (it keeps its current BPM unchanged — no re-sync needed).
        if (!playing) {
          const otherId = otherDeck(deck);
          const other = s.decks[otherId];
          if (other.isSynced && other.isPlaying) {
            // Other deck is already playing at matched tempo — promote it.
            // Unsync it so it becomes the new freerunning master.
            updated.decks = {
              ...updated.decks,
              [otherId]: { ...other, isSynced: false },
            };
          }
        }

        return updated;
      }),

    setDeckGain: (deck, v) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], gain: clamp(v, -12, 12) },
        },
      })),

    setDeckVolume: (deck, v) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], volume: clamp(v, 0, 1) },
        },
      })),

    setDeckEq: (deck, band, v) => {
      // Clamp to the widest possible EQ range (techno: -32/+12).
      // Individual presets further constrain via UI min/max.
      const clamped = clamp(v, -32, 12);
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: {
            ...s.decks[deck],
            eq: { ...s.decks[deck].eq, [band]: clamped },
          },
        },
      }));
    },

    setDeckColorFx: (deck, v) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], colorFx: clamp(v, -1, 1) },
        },
      })),

    setDeckPlaybackRate: (deck, v) =>
      set((s) => {
        const clamped = clamp(v, 0.92, 1.08);
        const d = s.decks[deck];
        const effectiveBpm = d.originalBpm > 0
          ? Math.round(d.originalBpm * clamped * 10) / 10
          : 0;
        return {
          decks: {
            ...s.decks,
            [deck]: { ...d, playbackRate: clamped, bpm: effectiveBpm },
          },
        };
      }),

    setDeckWaveform: (deck, data, duration) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], waveformData: data, duration },
        },
      })),

    // ── BPM ──────────────────────────────────────────────────

    setDeckBpm: (deck, bpm, firstBeatOffset) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: {
            ...s.decks[deck],
            bpm,
            originalBpm: bpm,
            firstBeatOffset,
            // #46: Loading a new track clears sync so it never
            // hijacks the other deck's tempo as an accidental master.
            isSynced: false,
            playbackRate: 1.0,
          },
        },
      })),

    setDeckTrackName: (deck, name) => {
      // Restore persisted hot cues for this track (if any).
      const savedCues = loadHotCues(name);
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: {
            ...s.decks[deck],
            trackName: name,
            ...(savedCues ? { hotCues: savedCues } : {}),
          },
        },
      }));
    },

    setDeckAnalysis: (deck, dropBeats, musicalKey) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], dropBeats, musicalKey },
        },
      })),

    // ── SYNC ─────────────────────────────────────────────────
    //
    // Phase-aware sync: matches tempo AND aligns beatgrids.
    //
    // 1. Tempo: set playbackRate so BPMs match.
    // 2. Phase: seek the synced deck so its fractional beat
    //    position aligns with the master deck's grid.
    //
    // This eliminates the "galloping kick" effect caused by
    // two beatgrids being offset even when BPMs match.

    syncDeck: (deck) =>
      set((s) => {
        // Edge-case #1: Debounce — ignore rapid SYNC presses within 50ms.
        const now = performance.now();
        if (now - (_syncLastCall[deck] || 0) < 50) return s;
        _syncLastCall[deck] = now;

        const thisDeck = s.decks[deck];
        const otherDeckId = otherDeck(deck);
        const other = s.decks[otherDeckId];
        if (thisDeck.originalBpm <= 0 || other.bpm <= 0) return s;

        // ── 1. Tempo match ───────────────────────────────────
        const newRate = other.bpm / thisDeck.originalBpm;
        const clamped = clamp(newRate, 0.92, 1.08);
        const effectiveBpm = Math.round(thisDeck.originalBpm * clamped * 10) / 10;

        // ── 2. Phase align ───────────────────────────────────
        // Calculate where the master beat grid is right now,
        // then seek the synced deck to match that phase.
        const engine = MixiEngine.getInstance();
        if (engine.isInitialized && other.isPlaying) {
          const masterTime = engine.getCurrentTime(otherDeckId);
          const masterBeatPeriod = 60 / other.bpm;
          // Master's fractional position within current beat (0–1)
          const masterFrac = (((masterTime - other.firstBeatOffset) / masterBeatPeriod) % 1 + 1) % 1;

          // This deck's current time and beat period at new rate
          const thisTime = engine.getCurrentTime(deck);
          const thisBeatPeriod = 60 / effectiveBpm;
          const thisFrac = (((thisTime - thisDeck.firstBeatOffset) / thisBeatPeriod) % 1 + 1) % 1;

          // Phase delta: how far this deck is from matching master
          let phaseDelta = masterFrac - thisFrac;
          if (phaseDelta > 0.5) phaseDelta -= 1;
          if (phaseDelta < -0.5) phaseDelta += 1;

          // Convert to seconds and seek
          const seekOffset = phaseDelta * thisBeatPeriod;
          if (Math.abs(seekOffset) > 0.005) { // Only if > 5ms off
            const targetTime = thisTime + seekOffset;
            // Seek immediately — Zustand set() is sync, no deferral needed
            engine.seek(deck, Math.max(0, targetTime));
          }
        }

        return {
          decks: {
            ...s.decks,
            [deck]: {
              ...thisDeck,
              playbackRate: clamped,
              bpm: effectiveBpm,
              isSynced: true,
            },
            // BUG-03: Clear sync on the other deck to prevent mutual sync.
            [deck === 'A' ? 'B' : 'A']: {
              ...s.decks[deck === 'A' ? 'B' : 'A'],
              isSynced: false,
            },
          },
        };
      }),

    unsyncDeck: (deck) =>
      set((s) => {
        const d = s.decks[deck];
        return {
          decks: {
            ...s.decks,
            [deck]: {
              ...d,
              playbackRate: 1.0,
              bpm: d.originalBpm,
              isSynced: false,
            },
          },
        };
      }),

    // ── HOT CUES ─────────────────────────────────────────────

    /**
     * Save a hot cue at the given time.
     * If quantize is on, snaps to the nearest beat.
     */
    setHotCue: (deck, index, time) =>
      set((s) => {
        const d = s.decks[deck];
        // #43: Guard — no cue setting on empty deck.
        if (!d.isTrackLoaded) return s;
        const res = useSettingsStore.getState().quantizeResolution;
        const snapped = d.quantize
          ? quantizeTime(time, d.bpm, d.firstBeatOffset, res)
          : time;
        const newCues = [...d.hotCues];
        newCues[index] = snapped;
        // Persist to localStorage.
        if (d.trackName) saveHotCues(d.trackName, newCues);
        return {
          decks: { ...s.decks, [deck]: { ...d, hotCues: newCues } },
        };
      }),

    /**
     * Jump to a hot cue position.
     * Calls engine.seek() directly for zero-latency response.
     */
    triggerHotCue: (deck, index) => {
      // Edge-case #8: Throttle hot cue spam — ignore triggers within 30ms.
      const key = `${deck}:${index}`;
      const now = performance.now();
      if (now - (_hotCueLastCall[key] || 0) < 30) return;
      _hotCueLastCall[key] = now;

      const d = get().decks[deck];
      // #43: Guard — no transport on empty deck.
      if (!d.isTrackLoaded) return;
      const time = d.hotCues[index];
      if (time === null) return;

      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;
      engine.seek(deck, time);
    },

    /** Remove a hot cue from the given slot. */
    deleteHotCue: (deck, index) =>
      set((s) => {
        const d = s.decks[deck];
        const newCues = [...d.hotCues];
        newCues[index] = null;
        if (d.trackName) saveHotCues(d.trackName, newCues);
        return {
          decks: { ...s.decks, [deck]: { ...d, hotCues: newCues } },
        };
      }),

    // ── AUTO LOOP ────────────────────────────────────────────

    /**
     * Activate an auto loop of the given length in beats.
     *
     * Calculation:
     *   beatPeriod = 60 / bpm
     *   loopLength = beatPeriod * beats  (in seconds)
     *   start      = quantize(currentTime)  (snap to nearest beat)
     *   end        = start + loopLength
     *
     * Calls engine.setLoop() directly for immediate engagement.
     */
    beatJump: (deck, beats) => {
      const s = get();
      const d = s.decks[deck];
      if (!d.isTrackLoaded) return;
      if (d.bpm <= 0) return;

      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;

      const currentTime = engine.getCurrentTime(deck);
      const beatPeriod = 60 / d.bpm;
      const jumpSeconds = beats * beatPeriod;
      const newTime = Math.max(0, Math.min(d.duration, currentTime + jumpSeconds));
      engine.seek(deck, newTime);
    },

    shiftGrid: (deck, beats) => {
      const s = get();
      const d = s.decks[deck];
      if (!d.isTrackLoaded || d.bpm <= 0) return;

      const beatPeriod = 60 / d.bpm;
      const newOffset = d.firstBeatOffset + beats * beatPeriod;
      set((st) => ({
        decks: {
          ...st.decks,
          [deck]: { ...st.decks[deck], firstBeatOffset: newOffset },
        },
      }));
    },

    vinylBrake: (deck) => {
      const s = get();
      const d = s.decks[deck];
      if (!d.isTrackLoaded || !d.isPlaying) return;
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;
      engine.vinylBrake(deck);
    },

    setSlipMode: (deck, active) => {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;
      if (active) {
        engine.enterSlipMode(deck);
      } else {
        engine.exitSlipMode(deck);
      }
      set((s) => ({
        decks: { ...s.decks, [deck]: { ...s.decks[deck], slipModeActive: active } },
      }));
    },

    setAutoLoop: (deck, beats) => {
      const s = get();
      const d = s.decks[deck];
      // #43: Guard — no transport on empty deck.
      if (!d.isTrackLoaded) return;
      if (d.bpm <= 0) return;

      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) return;

      const beatPeriod = 60 / d.bpm;
      const loopLength = beatPeriod * beats;
      const currentTime = engine.getCurrentTime(deck);

      // Snap loop start to the nearest beat on the grid.
      const res = useSettingsStore.getState().quantizeResolution;
      const start = d.quantize
        ? quantizeTime(currentTime, d.bpm, d.firstBeatOffset, res)
        : currentTime;
      const end = start + loopLength;

      // Update store.
      const loop: LoopState = { start, end, lengthInBeats: beats };
      set((st) => ({
        decks: {
          ...st.decks,
          [deck]: { ...st.decks[deck], activeLoop: loop },
        },
      }));

      // Engage the loop on the audio engine.
      engine.setLoop(deck, start, end);
    },

    /** Exit the active loop. */
    exitLoop: (deck) => {
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], activeLoop: null },
        },
      }));

      const engine = MixiEngine.getInstance();
      if (engine.isInitialized) {
        engine.exitLoop(deck);
      }
    },

    // ── QUANTIZE ─────────────────────────────────────────────

    setQuantize: (deck, enabled) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], quantize: enabled },
        },
      })),

    // ── KEY LOCK ─────────────────────────────────────────────

    setKeyLock: (deck, enabled) =>
      set((s) => ({
        decks: {
          ...s.decks,
          [deck]: { ...s.decks[deck], keyLock: enabled },
        },
      })),

    // ── PFL / CUE ───────────────────────────────────────────

    toggleCue: (deck) =>
      set((s) => {
        const willBeActive = !s.decks[deck].cueActive;
        return {
          decks: {
            ...s.decks,
            [deck]: { ...s.decks[deck], cueActive: willBeActive },
          },
          // Auto-enable split mode when CUE is activated,
          // otherwise CUE audio is inaudible in stereo mode.
          headphones: willBeActive && !s.headphones.splitMode
            ? { ...s.headphones, splitMode: true }
            : s.headphones,
        };
      }),

    // ── HEADPHONES ───────────────────────────────────────────

    setHeadphoneLevel: (v) =>
      set((s) => ({
        headphones: { ...s.headphones, level: clamp(v, 0, 1) },
      })),

    setHeadphoneMix: (v) =>
      set((s) => ({
        headphones: { ...s.headphones, mix: clamp(v, 0, 1) },
      })),

    toggleSplitMode: () =>
      set((s) => ({
        headphones: { ...s.headphones, splitMode: !s.headphones.splitMode },
      })),

    // ── AI CONTROL ──────────────────────────────────────────

    setAiMode: (mode) =>
      set((s) => ({
        ai: { ...s.ai, mode, isPaused: false },
      })),

    setAiPaused: (paused) =>
      set((s) => ({
        ai: { ...s.ai, isPaused: paused },
      })),

    /**
     * Called on every human interaction with a mixer control.
     *
     * CRUISE mode: any touch kills the AI permanently (→ OFF).
     * ASSIST mode: any touch pauses the AI temporarily.
     *              It resumes after `assistResumeDelay` seconds of inactivity.
     */
    registerUserInteraction: () =>
      set((s) => {
        const now = Date.now();
        if (s.ai.mode === 'OFF') {
          return { ai: { ...s.ai, lastInteractionTime: now } };
        }
        if (s.ai.mode === 'CRUISE') {
          return { ai: { ...s.ai, mode: 'OFF', lastInteractionTime: now } };
        }
        // ASSIST: pause the AI.
        return { ai: { ...s.ai, isPaused: true, lastInteractionTime: now } };
      }),

    // ── Deck mode ──────────────────────────────────────────
    setDeckMode: (deck, mode) =>
      set((s) => ({ deckModes: { ...s.deckModes, [deck]: mode } })),
  }),
  {
    name: 'mixi-prefs',
    storage: createJSONStorage(() => safeStorage),
    partialize: (s) => ({
      crossfaderCurve: s.crossfaderCurve,
      headphones: s.headphones,
      ai: {
        mode: s.ai.mode,
        assistResumeDelay: s.ai.assistResumeDelay,
      },
    }),
    merge: (persisted, current) => {
      const p = persisted as Partial<MixerState> | undefined;
      if (!p) return current;
      return {
        ...current,
        crossfaderCurve: p.crossfaderCurve ?? current.crossfaderCurve,
        headphones: p.headphones
          ? { ...current.headphones, ...p.headphones }
          : current.headphones,
        ai: p.ai
          ? { ...current.ai, mode: p.ai.mode ?? current.ai.mode, assistResumeDelay: p.ai.assistResumeDelay ?? current.ai.assistResumeDelay }
          : current.ai,
      };
    },
  },
  ),
  ),
);
