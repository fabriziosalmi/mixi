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
import { useSettingsStore } from '../store/settingsStore';
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
    engine.setMasterFilter(state.master.filter);
    engine.setDistortion(state.master.distortion);
    engine.setPunch(state.master.punch);
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
  // Consolidated: master + crossfader + headphones in a single
  // subscription with snapshot comparison. Reduces 10 useEffects
  // → 1, cutting listener overhead from ~10 callbacks to 1.

  useEffect(() => {
    let prev = useMixiStore.getState();
    return useMixiStore.subscribe((s) => {
      if (!engine.isInitialized) { prev = s; return; }

      // Master bus
      if (s.master.volume !== prev.master.volume) engine.setMasterVolume(s.master.volume);
      if (s.master.filter !== prev.master.filter) engine.setMasterFilter(s.master.filter);
      if (s.master.distortion !== prev.master.distortion) engine.setDistortion(s.master.distortion);
      if (s.master.punch !== prev.master.punch) engine.setPunch(s.master.punch);

      // Crossfader (also re-apply when curve changes)
      if (s.crossfader !== prev.crossfader || s.crossfaderCurve !== prev.crossfaderCurve) {
        engine.setCrossfader(s.crossfader);
      }

      // Headphones
      if (s.headphones.level !== prev.headphones.level) engine.setHeadphoneLevel(s.headphones.level);
      if (s.headphones.mix !== prev.headphones.mix) engine.setHeadphoneMix(s.headphones.mix);
      if (s.headphones.splitMode !== prev.headphones.splitMode) engine.setSplitMode(s.headphones.splitMode);

      prev = s;
    });
  }, [engine]);

  // Per-deck + master EQ: single subscription with snapshot diff.
  // Replaces 16 per-deck + 3 master EQ subscriptions → 1 listener.
  useEffect(() => {
    let prev = useMixiStore.getState();
    const unsub = useMixiStore.subscribe((s) => {
      if (!engine.isInitialized) { prev = s; return; }

      for (const deck of DECK_IDS) {
        const d = s.decks[deck];
        const p = prev.decks[deck];
        if (d.isPlaying !== p.isPlaying) {
          if (d.isPlaying) engine.play(deck); else engine.pause(deck);
        }
        if (d.gain !== p.gain) engine.setDeckGain(deck, d.gain);
        if (d.volume !== p.volume) engine.setDeckVolume(deck, d.volume);
        if (d.eq !== p.eq) {
          for (const band of EQ_BANDS) {
            if (d.eq[band] !== p.eq[band]) engine.setEq(deck, band, d.eq[band]);
          }
        }
        if (d.colorFx !== p.colorFx) engine.setColorFx(deck, d.colorFx);
        if (d.playbackRate !== p.playbackRate) engine.setPlaybackRate(deck, d.playbackRate);
        if (d.cueActive !== p.cueActive) engine.setCueActive(deck, d.cueActive);
        if (d.keyLock !== p.keyLock) engine.setKeyLock(deck, d.keyLock);
      }

      // Master EQ
      for (const band of EQ_BANDS) {
        if (s.master.eq[band] !== prev.master.eq[band]) engine.setMasterEq(band, s.master.eq[band]);
      }

      prev = s;
    });
    return unsub;
  }, [engine]);

  // ── Cleanup on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      log.warn('Engine', 'Destroying AudioContext (unmount)');
      engine.destroy();
      isReady.current = false;
    };
  }, [engine]);

  // ── EQ Model (from settings store) ──────────────────────────
  useEffect(() => {
    let prevModel = useSettingsStore.getState().eqModel;
    return useSettingsStore.subscribe((s) => {
      if (s.eqModel !== prevModel) {
        prevModel = s.eqModel;
        if (engine.isInitialized) engine.setEqModel(s.eqModel);
      }
    });
  }, [engine]);

  return {
    initEngine,
    get isReady() {
      return engine.isInitialized;
    },
  };
}
