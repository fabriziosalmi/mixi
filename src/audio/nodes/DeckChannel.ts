/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Deck Channel Strip
//
// Full audio signal chain for one deck:
//
//   Source → Trim → [EQ model] → ColorFX → FX → Fader → XfaderGain
//                                     └─→ CueGain (PFL tap)
//
// EQ models:
//   lr4-isolator  Linkwitz-Riley 24dB/oct parallel isolator (default)
//   dj-peak       Pioneer DJM-style low-shelf + mid-peak + high-shelf
//   xone-kill     Allen & Heath 48dB/oct full-kill isolator
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../../types';
import type { EqModel } from '../../store/settingsStore';
import { smoothParam } from '../utils/paramSmooth';
import { logFrequency } from '../utils/mathUtils';
import { DeckFx, type FxId } from './DeckFx';

const COLOR_OFF_FREQ = 20_000;

export class DeckChannel {
  readonly id: DeckId;

  // ── Audio Nodes ────────────────────────────────────────────
  readonly trimGain: GainNode;

  // EQ — gain nodes are always present regardless of model.
  // The filter nodes behind them change with the model.
  readonly eqLow: GainNode;
  readonly eqMid: GainNode;
  readonly eqHigh: GainNode;
  private readonly eqMerge: GainNode;

  // Internal EQ filter nodes (rebuilt on model change)
  private eqFilters: AudioNode[] = [];
  private _eqModel: EqModel = 'lr4-isolator';

  readonly colorFilter: BiquadFilterNode;
  readonly fx: DeckFx;
  readonly faderGain: GainNode;
  readonly xfaderGain: GainNode;
  readonly cueGain: GainNode;
  readonly analyser: AnalyserNode;

  private ctx: AudioContext;

  get input(): GainNode { return this.trimGain; }
  get output(): GainNode { return this.xfaderGain; }
  get cueOutput(): GainNode { return this.cueGain; }
  get eqModel(): EqModel { return this._eqModel; }

  constructor(ctx: AudioContext, id: DeckId, eqModel: EqModel = 'lr4-isolator') {
    this.id = id;
    this.ctx = ctx;
    this._eqModel = eqModel;

    // ── Create permanent nodes ──────────────────────────────
    this.trimGain = ctx.createGain();
    this.trimGain.gain.value = 1;

    // EQ gain nodes (shared by all models)
    this.eqLow = ctx.createGain();  this.eqLow.gain.value = 1;
    this.eqMid = ctx.createGain();  this.eqMid.gain.value = 1;
    this.eqHigh = ctx.createGain(); this.eqHigh.gain.value = 1;
    this.eqMerge = ctx.createGain(); this.eqMerge.gain.value = 1;

    this.colorFilter = ctx.createBiquadFilter();
    this.colorFilter.type = 'lowpass';
    this.colorFilter.frequency.value = COLOR_OFF_FREQ;
    this.colorFilter.Q.value = 0.707;

    this.fx = new DeckFx(ctx);
    this.faderGain = ctx.createGain(); this.faderGain.gain.value = 1;
    this.xfaderGain = ctx.createGain(); this.xfaderGain.gain.value = 1;
    this.cueGain = ctx.createGain(); this.cueGain.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    // ── Build EQ for chosen model ───────────────────────────
    this.buildEq(eqModel);

    // ── Wire post-EQ chain ──────────────────────────────────
    this.eqMerge.connect(this.colorFilter);
    this.colorFilter.connect(this.fx.input);
    this.fx.output.connect(this.faderGain);
    this.faderGain.connect(this.analyser);
    this.analyser.connect(this.xfaderGain);
    this.fx.output.connect(this.cueGain);
  }

  // ── EQ Model Builders ─────────────────────────────────────

  /**
   * Hot-swap EQ model at runtime.
   * Disconnects old EQ filters, builds new ones, reconnects.
   */
  setEqModel(model: EqModel): void {
    if (model === this._eqModel) return;
    // C3: Build new EQ first, THEN tear down old — atomic swap, no audio gap.
    // Both old and new are briefly connected in parallel (summed), but the
    // swap is so fast (<1ms) that the overlap is inaudible.
    const oldFilters = this.eqFilters;
    this.eqFilters = [];
    // Disconnect gain nodes from merge (will be reconnected by buildEq)
    this.eqLow.disconnect();
    this.eqMid.disconnect();
    this.eqHigh.disconnect();
    // Build new EQ (connects trim → new filters → gain → merge)
    this.buildEq(model);
    // NOW disconnect old filter nodes (trim → old path is severed)
    for (const n of oldFilters) {
      try { n.disconnect(); } catch { /* ok */ }
    }
  }

  private buildEq(model: EqModel): void {
    this._eqModel = model;
    switch (model) {
      case 'lr4-isolator': this.buildLR4(); break;
      case 'dj-peak':      this.buildDJPeak(); break;
      case 'xone-kill':    this.buildXoneKill(); break;
    }
  }

  // ── Model 1: LR4 Isolator (24dB/oct) ─────────────────────
  //   Trim → LP×2(250Hz) → lowGain  → merge
  //   Trim → HP×2(250Hz) → LP×2(4kHz) → midGain → merge
  //   Trim → HP×2(4kHz)  → highGain → merge

  private buildLR4(): void {
    const ctx = this.ctx;
    const LO = 250, HI = 4000;

    const makeLR = (type: BiquadFilterType, freq: number) => {
      const f1 = ctx.createBiquadFilter();
      f1.type = type; f1.frequency.value = freq; f1.Q.value = 0.707;
      const f2 = ctx.createBiquadFilter();
      f2.type = type; f2.frequency.value = freq; f2.Q.value = 0.707;
      f1.connect(f2);
      this.eqFilters.push(f1, f2);
      return [f1, f2] as const;
    };

    // Low
    const [lp1, lp2] = makeLR('lowpass', LO);
    this.trimGain.connect(lp1);
    lp2.connect(this.eqLow);
    this.eqLow.connect(this.eqMerge);

    // Mid
    const [bpLo1, bpLo2] = makeLR('highpass', LO);
    const [bpHi1, bpHi2] = makeLR('lowpass', HI);
    bpLo2.connect(bpHi1);
    this.trimGain.connect(bpLo1);
    bpHi2.connect(this.eqMid);
    this.eqMid.connect(this.eqMerge);

    // High
    const [hp1, hp2] = makeLR('highpass', HI);
    this.trimGain.connect(hp1);
    hp2.connect(this.eqHigh);
    this.eqHigh.connect(this.eqMerge);
  }

  // ── Model 2: DJ Peak EQ (Pioneer DJM-style) ──────────────
  //   Trim → lowShelf(80Hz) → midPeak(1kHz) → highShelf(12kHz) → merge
  //   No kill — gain nodes still used but filters are serial peaking/shelving.
  //   Gain nodes set to 1.0 (bypass) — EQ is applied via filter.gain.

  private buildDJPeak(): void {
    const ctx = this.ctx;

    const lo = ctx.createBiquadFilter();
    lo.type = 'lowshelf'; lo.frequency.value = 80; lo.gain.value = 0;
    this.eqFilters.push(lo);

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.7; mid.gain.value = 0;
    this.eqFilters.push(mid);

    const hi = ctx.createBiquadFilter();
    hi.type = 'highshelf'; hi.frequency.value = 12000; hi.gain.value = 0;
    this.eqFilters.push(hi);

    // Serial chain: Trim → lo → mid → hi → merge
    this.trimGain.connect(lo);
    lo.connect(mid);
    mid.connect(hi);
    hi.connect(this.eqMerge);

    // M5: DJ Peak uses filter.gain directly — gain nodes are NOT in signal path.
    // Don't connect/disconnect them uselessly.
  }

  // ── Model 3: Xone Kill (48dB/oct full-kill isolator) ──────
  //   Same topology as LR4 but 4th-order (4× cascaded) with
  //   slightly resonant crossovers (Q=1.0) and tighter bands.
  //   Crossovers: 200Hz / 2500Hz (classic Xone voicing)

  private buildXoneKill(): void {
    const ctx = this.ctx;
    const LO = 200, HI = 2500;
    const Q = 1.0; // slight resonance at crossover

    const make4th = (type: BiquadFilterType, freq: number) => {
      const filters: BiquadFilterNode[] = [];
      for (let i = 0; i < 4; i++) {
        const f = ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = Q;
        this.eqFilters.push(f);
        filters.push(f);
        if (i > 0) filters[i - 1].connect(f);
      }
      return filters;
    };

    // Low: 4× cascaded LP @ 200Hz
    const lowChain = make4th('lowpass', LO);
    this.trimGain.connect(lowChain[0]);
    lowChain[3].connect(this.eqLow);
    this.eqLow.connect(this.eqMerge);

    // Mid: 4× HP @ 200Hz → 4× LP @ 2500Hz
    const midHP = make4th('highpass', LO);
    const midLP = make4th('lowpass', HI);
    midHP[3].connect(midLP[0]);
    this.trimGain.connect(midHP[0]);
    midLP[3].connect(this.eqMid);
    this.eqMid.connect(this.eqMerge);

    // High: 4× cascaded HP @ 2500Hz
    const highChain = make4th('highpass', HI);
    this.trimGain.connect(highChain[0]);
    highChain[3].connect(this.eqHigh);
    this.eqHigh.connect(this.eqMerge);
  }

  // ── Parameter Setters (all smoothed) ─────────────────────

  setEq(band: 'low' | 'mid' | 'high', db: number, ctx: AudioContext, rangeMin?: number): void {
    if (this._eqModel === 'dj-peak') {
      // DJ Peak: apply dB directly to filter.gain (shelving/peaking)
      const filter = this.eqFilters[band === 'low' ? 0 : band === 'mid' ? 1 : 2] as BiquadFilterNode;
      if (filter) smoothParam(filter.gain, db, ctx);
      return;
    }

    // Isolator models (LR4, Xone): convert dB → linear gain
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh;
    const isKill = rangeMin !== undefined && db <= rangeMin;
    const linear = isKill ? 0 : Math.pow(10, db / 20);
    smoothParam(node.gain, linear, ctx);
  }

  setVolume(value: number, ctx: AudioContext): void {
    smoothParam(this.faderGain.gain, value, ctx);
  }

  setXfaderGain(value: number, ctx: AudioContext): void {
    smoothParam(this.xfaderGain.gain, value, ctx);
  }

  setCueActive(active: boolean, ctx: AudioContext): void {
    smoothParam(this.cueGain.gain, active ? 1 : 0, ctx);
  }

  setColorFx(value: number, ctx: AudioContext): void {
    if (value === 0) {
      this.colorFilter.type = 'lowpass';
      smoothParam(this.colorFilter.frequency, COLOR_OFF_FREQ, ctx);
      smoothParam(this.colorFilter.Q, 0.707, ctx);
      return;
    }

    if (value < 0) {
      this.colorFilter.type = 'lowpass';
      const t = 1 + value;
      const freq = logFrequency(t);
      const norm = Math.log(Math.max(20, freq) / 20) / Math.log(1000);
      const taper = 1 - 0.6 * Math.pow(2 * Math.abs(norm - 0.5), 2);
      smoothParam(this.colorFilter.frequency, freq, ctx);
      smoothParam(this.colorFilter.Q, 1.5 * Math.max(0.3, taper), ctx);
    } else {
      this.colorFilter.type = 'highpass';
      const freq = logFrequency(value);
      const norm = Math.log(Math.max(20, freq) / 20) / Math.log(1000);
      const taper = 1 - 0.6 * Math.pow(2 * Math.abs(norm - 0.5), 2);
      smoothParam(this.colorFilter.frequency, freq, ctx);
      smoothParam(this.colorFilter.Q, 1.5 * Math.max(0.3, taper), ctx);
    }
  }

  setFx(id: FxId, amount: number, active: boolean, ctx: AudioContext): void {
    this.fx.setFx(id, amount, active, ctx);
  }

  updateGate(bpm: number, currentTime: number, gridOffset: number): void {
    this.fx.updateGate(bpm, currentTime, gridOffset);
  }

  destroy(): void {
    this.trimGain.disconnect();
    for (const n of this.eqFilters) {
      try { n.disconnect(); } catch { /* ok */ }
    }
    this.eqLow.disconnect();
    this.eqMid.disconnect();
    this.eqHigh.disconnect();
    this.eqMerge.disconnect();
    this.colorFilter.disconnect();
    this.fx.destroy();
    this.faderGain.disconnect();
    this.xfaderGain.disconnect();
    this.analyser.disconnect();
    this.cueGain.disconnect();
  }
}
