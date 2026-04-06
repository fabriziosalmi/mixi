/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Keyboard Shortcuts
//
// Global keyboard handler.  Captures key events on `window`
// and maps them to store actions.
//
// Layout (mirrors a DJ controller):
//
//   DECK A (left hand)           DECK B (right hand)
//   ─────────────────            ─────────────────
//   Shift+A  = play/pause A      Shift+B  = play/pause B
//   1–8      = hot cues A        Shift+1–8 = hot cues B (via numpad not implemented yet)
//   Q        = toggle quantize A
//
//   Global:
//   Space    = play/pause the deck that has focus (A by default)
//   Escape   = eject focused deck
//   ↑/↓      = nudge Deck A ±4% (hold), Ctrl: fine ±1%
//   Shift+↑/↓= nudge Deck B ±4% (hold), Ctrl: fine ±1%
//   [ / ]    = shift beatgrid ±1 beat (Deck A), Shift: Deck B
//   T        = tap tempo (sets Deck A BPM from tap rhythm)
//   D        = align drops (seek Deck B so drops coincide)
// ─────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useMixiStore } from '../store/mixiStore';
import { useSettingsStore } from '../store/settingsStore';
import { MixiEngine } from '../audio/MixiEngine';

export function useKeyboardShortcuts() {
  useEffect(() => {
    // Track active nudge keys to avoid repeat events
    const activeNudge = new Set<string>();

    // Tap tempo state
    const tapTimes: number[] = [];
    const TAP_TIMEOUT = 2000;  // reset if no tap for 2s
    const TAP_COUNT = 8;       // average last 8 taps

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input field.
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const store = useMixiStore.getState();
      const engine = MixiEngine.getInstance();

      // ── Arrow Up/Down: Nudge (temporary pitch bend) ─────
      // No shift: Deck A, Shift: Deck B
      // Ctrl: fine nudge (±1%), otherwise ±4%
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        const key = `${e.code}-${e.shiftKey ? 'B' : 'A'}`;
        if (activeNudge.has(key)) return; // ignore key repeat
        activeNudge.add(key);
        const deck: 'A' | 'B' = e.shiftKey ? 'B' : 'A';
        const dir: 1 | -1 = e.code === 'ArrowUp' ? 1 : -1;
        engine.nudgeStart(deck, dir, e.ctrlKey || e.metaKey);
        return;
      }

      switch (e.code) {
        // ── Space: play/pause Deck A ───────────────────────
        case 'Space':
          e.preventDefault();
          store.setDeckPlaying('A', !store.decks.A.isPlaying);
          break;

        // ── Shift+A / Shift+B: play/pause specific deck ───
        case 'KeyA':
          if (e.shiftKey) {
            e.preventDefault();
            store.setDeckPlaying('A', !store.decks.A.isPlaying);
          }
          break;
        case 'KeyB':
          if (e.shiftKey) {
            e.preventDefault();
            store.setDeckPlaying('B', !store.decks.B.isPlaying);
          }
          break;

        // ── Q: toggle quantize on Deck A ───────────────────
        case 'KeyQ':
          if (!e.shiftKey) {
            store.setQuantize('A', !store.decks.A.quantize);
          } else {
            store.setQuantize('B', !store.decks.B.quantize);
          }
          break;

        // ── S: sync Deck A, Shift+S: sync Deck B ──────────
        case 'KeyS':
          if (!e.shiftKey) {
            if (store.decks.A.isSynced) store.unsyncDeck('A');
            else store.syncDeck('A');
          } else {
            if (store.decks.B.isSynced) store.unsyncDeck('B');
            else store.syncDeck('B');
          }
          break;

        // ── Escape: eject Deck A, Shift+Esc: eject B ──────
        case 'Escape':
          e.preventDefault();
          store.ejectDeck(e.shiftKey ? 'B' : 'A');
          break;

        // ── 1–8: hot cues on Deck A ────────────────────────
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
        case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': {
          const idx = parseInt(e.code.slice(-1)) - 1;
          const deck = e.shiftKey ? 'B' : 'A';
          const cue = store.decks[deck].hotCues[idx];
          if (cue !== null) {
            store.triggerHotCue(deck, idx);
          } else if (engine.isInitialized) {
            const time = engine.getCurrentTime(deck);
            store.setHotCue(deck, idx, time);
          }
          break;
        }

        // ── X: toggle slip mode ─────────────────────────────
        case 'KeyX': {
          e.preventDefault();
          const sd: 'A' | 'B' = e.shiftKey ? 'B' : 'A';
          store.setSlipMode(sd, !store.decks[sd].slipModeActive);
          break;
        }

        // ── V: vinyl brake ────────────────────────────────────
        case 'KeyV':
          e.preventDefault();
          store.vinylBrake(e.shiftKey ? 'B' : 'A');
          break;

        // ── Arrow Left/Right: beat jump Deck A ──────────────
        // Shift: ±4 beats (1 bar), no shift: ±1 beat
        case 'ArrowLeft':
          e.preventDefault();
          store.beatJump('A', e.shiftKey ? -4 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          store.beatJump('A', e.shiftKey ? 4 : 1);
          break;

        // ── [ / ]: Shift beatgrid ±1 beat ──────────────────
        // No shift: Deck A, Shift: Deck B
        case 'BracketLeft':
          e.preventDefault();
          store.shiftGrid(e.shiftKey ? 'B' : 'A', -1);
          break;
        case 'BracketRight':
          e.preventDefault();
          store.shiftGrid(e.shiftKey ? 'B' : 'A', 1);
          break;

        // ── T: Tap Tempo ──────────────────────────────────────
        // Tap T key rhythmically; average of last 8 taps sets BPM
        case 'KeyT': {
          if (e.shiftKey) break;  // reserved
          e.preventDefault();
          const now = performance.now();
          // Reset if too long since last tap
          if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > TAP_TIMEOUT) {
            tapTimes.length = 0;
          }
          tapTimes.push(now);
          if (tapTimes.length > TAP_COUNT) tapTimes.shift();

          if (tapTimes.length >= 2) {
            // Average interval
            let sum = 0;
            for (let i = 1; i < tapTimes.length; i++) {
              sum += tapTimes[i] - tapTimes[i - 1];
            }
            const avgMs = sum / (tapTimes.length - 1);
            const tappedBpm = Math.round(60000 / avgMs * 10) / 10;
            if (tappedBpm > 30 && tappedBpm < 300) {
              const deck: 'A' | 'B' = 'A';  // tap always targets deck A
              const d = store.decks[deck];
              store.setDeckBpm(deck, tappedBpm, d.firstBeatOffset);
            }
          }
          break;
        }

        // ── D: Align Drops ─────────────────────────────────────
        case 'KeyD':
          if (!e.shiftKey) {
            e.preventDefault();
            store.alignDrops();
          }
          break;

        // ── O: Toggle phase overlay (ghost deck anaglifo) ──
        case 'KeyO':
          if (!e.shiftKey) {
            e.preventDefault();
            const settings = useSettingsStore.getState();
            settings.setShowPhaseOverlay(!settings.showPhaseOverlay);
          }
          break;

        default:
          break;
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        // Release nudge for both possible decks (shift state may have changed)
        const keyA = `${e.code}-A`;
        const keyB = `${e.code}-B`;
        const engine = MixiEngine.getInstance();
        if (activeNudge.has(keyA)) {
          activeNudge.delete(keyA);
          engine.nudgeStop('A');
        }
        if (activeNudge.has(keyB)) {
          activeNudge.delete(keyB);
          engine.nudgeStop('B');
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
}
