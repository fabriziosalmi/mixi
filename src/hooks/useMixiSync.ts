/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – React ↔ Audio Bridge Hook
//
// This hook is the ONLY point of contact between React and
// the MixiEngine. It subscribes to Zustand store slices and
// forwards every state change to the audio engine.
// ─────────────────────────────────────────────────────────────

import { useEffect, useCallback, useRef } from 'react';
import { useMixiStore } from '../store/mixiStore';
import { MixiEngine } from '../audio/MixiEngine';
import { log } from '../utils/logger';
import type { DeckId, EqBand } from '../types';

const DECK_IDS: DeckId[] = ['A', 'B'];
const EQ_BANDS: EqBand[] = ['low', 'mid', 'high'];

export function useMixiSync() {
  const isReady = useRef(false);
  const engine = MixiEngine.getInstance();

  // ── Engine initialisation ──────────────────────────────────

  const initEngine = useCallback(async () => {
    if (isReady.current) return;
    log.info('Engine', 'Initialising AudioContext (user gesture)…');
    await engine.init();
    isReady.current = true;
    log.success('Engine', 'AudioContext running – sample rate 44 100 Hz');

    // Push the full current state into the engine.
    const state = useMixiStore.getState();
    engine.setMasterVolume(state.master.volume);
    engine.setCrossfader(state.crossfader);

    // Headphones
    engine.setHeadphoneLevel(state.headphones.level);
    engine.setHeadphoneMix(state.headphones.mix);
    engine.setSplitMode(state.headphones.splitMode);

    for (const deck of DECK_IDS) {
      const d = state.decks[deck];
      engine.setDeckGain(deck, d.gain);
      engine.setDeckVolume(deck, d.volume);
      for (const band of EQ_BANDS) {
        engine.setEq(deck, band, d.eq[band]);
      }
      engine.setColorFx(deck, d.colorFx);
      engine.setPlaybackRate(deck, d.playbackRate);
      engine.setCueActive(deck, d.cueActive);
      engine.setKeyLock(deck, d.keyLock);
    }
  }, [engine]);

  // ── Subscriptions ──────────────────────────────────────────

  // Master volume
  useEffect(() => {
    return useMixiStore.subscribe(
      (s) => s.master.volume,
      (volume) => {
        if (!engine.isInitialized) return;
        engine.setMasterVolume(volume);
      },
    );
  }, [engine]);

  // Crossfader
  useEffect(() => {
    return useMixiStore.subscribe(
      (s) => s.crossfader,
      (value) => {
        if (!engine.isInitialized) return;
        engine.setCrossfader(value);
      },
    );
  }, [engine]);

  // Crossfader curve — re-apply crossfader when curve changes
  useEffect(() => {
    return useMixiStore.subscribe(
      (s) => s.crossfaderCurve,
      () => {
        if (!engine.isInitialized) return;
        engine.setCrossfader(useMixiStore.getState().crossfader);
      },
    );
  }, [engine]);

  // Headphone level
  useEffect(() => {
    return useMixiStore.subscribe(
      (s) => s.headphones.level,
      (level) => {
        if (!engine.isInitialized) return;
        engine.setHeadphoneLevel(level);
      },
    );
  }, [engine]);

  // Headphone mix
  useEffect(() => {
    return useMixiStore.subscribe(
      (s) => s.headphones.mix,
      (mix) => {
        if (!engine.isInitialized) return;
        engine.setHeadphoneMix(mix);
      },
    );
  }, [engine]);

  // Split mode
  useEffect(() => {
    return useMixiStore.subscribe(
      (s) => s.headphones.splitMode,
      (splitMode) => {
        if (!engine.isInitialized) return;
        engine.setSplitMode(splitMode);
      },
    );
  }, [engine]);

  // Per-deck subscriptions
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    for (const deck of DECK_IDS) {
      // Play / Pause
      unsubs.push(
        useMixiStore.subscribe(
          (s) => s.decks[deck].isPlaying,
          (playing) => {
            if (!engine.isInitialized) return;
            if (playing) {
              engine.play(deck);
            } else {
              engine.pause(deck);
            }
          },
        ),
      );

      // Channel gain/trim
      unsubs.push(
        useMixiStore.subscribe(
          (s) => s.decks[deck].gain,
          (db) => {
            if (!engine.isInitialized) return;
            engine.setDeckGain(deck, db);
          },
        ),
      );

      // Channel fader
      unsubs.push(
        useMixiStore.subscribe(
          (s) => s.decks[deck].volume,
          (volume) => {
            if (!engine.isInitialized) return;
            engine.setDeckVolume(deck, volume);
          },
        ),
      );

      // EQ bands
      for (const band of EQ_BANDS) {
        unsubs.push(
          useMixiStore.subscribe(
            (s) => s.decks[deck].eq[band],
            (db) => {
              if (!engine.isInitialized) return;
              engine.setEq(deck, band, db);
            },
          ),
        );
      }

      // Color FX
      unsubs.push(
        useMixiStore.subscribe(
          (s) => s.decks[deck].colorFx,
          (value) => {
            if (!engine.isInitialized) return;
            engine.setColorFx(deck, value);
          },
        ),
      );

      // Playback rate
      unsubs.push(
        useMixiStore.subscribe(
          (s) => s.decks[deck].playbackRate,
          (rate) => {
            if (!engine.isInitialized) return;
            engine.setPlaybackRate(deck, rate);
          },
        ),
      );

      // CUE (PFL)
      unsubs.push(
        useMixiStore.subscribe(
          (s) => s.decks[deck].cueActive,
          (active) => {
            if (!engine.isInitialized) return;
            engine.setCueActive(deck, active);
          },
        ),
      );

      // Key Lock
      unsubs.push(
        useMixiStore.subscribe(
          (s) => s.decks[deck].keyLock,
          (enabled) => {
            if (!engine.isInitialized) return;
            engine.setKeyLock(deck, enabled);
          },
        ),
      );
    }

    return () => unsubs.forEach((unsub) => unsub());
  }, [engine]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      log.warn('Engine', 'Destroying AudioContext (unmount)');
      engine.destroy();
      isReady.current = false;
    };
  }, [engine]);

  return {
    initEngine,
    get isReady() {
      return engine.isInitialized;
    },
  };
}
