/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – DSP Parameter Writer
//
// Writes UI state into the DspParamBus in parallel with the
// existing MixiEngine setters. When the AudioWorklet is active,
// it reads params directly from the SharedArrayBuffer.
//
// This writer is called from useMixiSync subscriptions and
// populates the parameter bus WITHOUT affecting the native
// WebAudio path (which continues to work independently).
// ─────────────────────────────────────────────────────────────

import type { DspParamBus } from './DspProcessor';
import { DECK, MASTER, GLOBAL, PARAM_LAYOUT_VERSION, deckParam } from './ParamLayout';
import type { DeckId, EqBand } from '../../types';
import type { FxId } from '../nodes/DeckFx';

/**
 * Writes DSP parameters into the param bus.
 *
 * In native mode: the bus is populated but not read.
 * In Wasm mode: the AudioWorklet reads these atomically.
 */
export class DspParamWriter {
  constructor(private readonly bus: DspParamBus) {}

  // ── Deck parameters ──────────────────────────────────────

  setDeckTrim(deck: DeckId, gain: number): void {
    this.bus.setFloat(deckParam(deck, DECK.TRIM), gain);
  }

  setDeckEq(deck: DeckId, band: EqBand, db: number): void {
    const offset = band === 'low' ? DECK.EQ_LOW : band === 'mid' ? DECK.EQ_MID : DECK.EQ_HIGH;
    this.bus.setFloat(deckParam(deck, offset), db);
  }

  setDeckFader(deck: DeckId, value: number): void {
    this.bus.setFloat(deckParam(deck, DECK.FADER), value);
  }

  setDeckXfaderGain(deck: DeckId, value: number): void {
    this.bus.setFloat(deckParam(deck, DECK.XFADER_GAIN), value);
  }

  setDeckColorFreq(deck: DeckId, freq: number): void {
    this.bus.setFloat(deckParam(deck, DECK.COLOR_FREQ), freq);
  }

  setDeckColorRes(deck: DeckId, res: number): void {
    this.bus.setFloat(deckParam(deck, DECK.COLOR_RES), res);
  }

  setDeckCue(deck: DeckId, active: boolean): void {
    this.bus.setBool(deckParam(deck, DECK.CUE_ACTIVE), active);
  }

  setDeckPlaybackRate(deck: DeckId, rate: number): void {
    this.bus.setFloat(deckParam(deck, DECK.PLAYBACK_RATE), rate);
  }

  setDeckAutoGain(deck: DeckId, gain: number): void {
    this.bus.setFloat(deckParam(deck, DECK.AUTO_GAIN), gain);
  }

  // ── Per-deck FX ──────────────────────────────────────────

  setDeckFx(deck: DeckId, fx: FxId, amount: number, active: boolean): void {
    // FX with Wasm DSP counterparts — write to SharedArrayBuffer
    const offsets: Partial<Record<FxId, { amount: number; active: number }>> = {
      flt:  { amount: DECK.FX_FLT_AMOUNT,  active: DECK.FX_FLT_ACTIVE },
      dly:  { amount: DECK.FX_DLY_AMOUNT,  active: DECK.FX_DLY_ACTIVE },
      rev:  { amount: DECK.FX_REV_AMOUNT,  active: DECK.FX_REV_ACTIVE },
      pha:  { amount: DECK.FX_PHA_AMOUNT,  active: DECK.FX_PHA_ACTIVE },
      flg:  { amount: DECK.FX_FLG_AMOUNT,  active: DECK.FX_FLG_ACTIVE },
      gate: { amount: DECK.FX_GATE_AMOUNT, active: DECK.FX_GATE_ACTIVE },
      // crush, echo, tape, noise: WebAudio-only, no Wasm counterpart.
      // Do NOT alias to GATE offsets — that corrupts gate parameters.
    };
    const o = offsets[fx];
    if (o) {
      this.bus.setFloat(deckParam(deck, o.amount), amount);
      this.bus.setBool(deckParam(deck, o.active), active);
    }
    // WebAudio-only FX (crush/echo/tape/noise) are handled directly
    // by DeckFx.setFx() and don't need param bus writes.
  }

  // ── Master parameters ────────────────────────────────────

  setMasterGain(gain: number): void {
    this.bus.setFloat(MASTER.GAIN, gain);
  }

  setMasterFilter(value: number): void {
    this.bus.setFloat(MASTER.FILTER, value);
  }

  setMasterDistortion(amount: number, active: boolean): void {
    this.bus.setFloat(MASTER.DISTORTION, amount);
    this.bus.setBool(MASTER.DIST_ACTIVE, active);
  }

  setMasterPunch(amount: number, active: boolean): void {
    this.bus.setFloat(MASTER.PUNCH, amount);
    this.bus.setBool(MASTER.PUNCH_ACTIVE, active);
  }

  setMasterLimiter(active: boolean, thresholdDb?: number): void {
    this.bus.setBool(MASTER.LIMITER_ACTIVE, active);
    if (thresholdDb !== undefined) {
      this.bus.setFloat(MASTER.LIMITER_THRESH, thresholdDb);
    }
  }

  // ── Global parameters ────────────────────────────────────

  setCrossfader(value: number): void {
    this.bus.setFloat(GLOBAL.CROSSFADER, value);
  }

  setCrossfaderCurve(curve: number): void {
    this.bus.setFloat(GLOBAL.XFADER_CURVE, curve);
  }

  setHeadphoneMix(mix: number): void {
    this.bus.setFloat(GLOBAL.HP_MIX, mix);
  }

  setHeadphoneLevel(level: number): void {
    this.bus.setFloat(GLOBAL.HP_LEVEL, level);
  }

  setSampleRate(sr: number): void {
    this.bus.setFloat(GLOBAL.SAMPLE_RATE, sr);
    // H2: Write layout version so Rust can verify offset parity
    this.bus.setFloat(GLOBAL.LAYOUT_VERSION, PARAM_LAYOUT_VERSION);
  }

  setDspBackend(isWasm: boolean): void {
    this.bus.setFloat(GLOBAL.DSP_BACKEND, isWasm ? 1.0 : 0.0);
  }
}
