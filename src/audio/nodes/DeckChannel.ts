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
//   Source → Trim → HiShelf → MidPeak → LoShelf → ColorFX ─┬─→ Fader → XfaderGain
//                                                            └─→ CueGain (PFL tap)
//
// The CueGain is a Pre-Fader Listen tap: it picks up the
// signal AFTER EQ/FX processing but BEFORE the channel fader.
// This lets the DJ hear how the track will sound with EQ
// applied, without the fader position affecting the cue level.
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../../types';
import { smoothParam } from '../utils/paramSmooth';
import { logFrequency } from '../utils/mathUtils';
import { DeckFx, type FxId } from './DeckFx';

const EQ_LOW_FREQ = 250;
const EQ_HIGH_FREQ = 4_000;
const COLOR_OFF_FREQ = 20_000;

export class DeckChannel {
  readonly id: DeckId;

  // ── Audio Nodes ────────────────────────────────────────────
  readonly trimGain: GainNode;

  // 3-band isolator EQ — Linkwitz-Riley 24dB/oct (LR4)
  //
  // Two cascaded Butterworth 12dB/oct filters per crossover = LR4.
  // Flat magnitude sum at crossover (-6dB per band), zero phase error.
  //
  //   Trim → ┬─ LP1(250)→LP2(250)           → lowGain  ──┐
  //          ├─ HP1(250)→HP2(250)→LP3(4k)→LP4(4k) → midGain ──┤→ eqMerge → ColorFX
  //          └─ HP3(4k)→HP4(4k)              → highGain ──┘
  //
  // Kill on any band = gain 0 → complete silence on that band only.
  private readonly eqLP1: BiquadFilterNode;
  private readonly eqLP2: BiquadFilterNode;
  private readonly eqBPLow1: BiquadFilterNode;
  private readonly eqBPLow2: BiquadFilterNode;
  private readonly eqBPHigh1: BiquadFilterNode;
  private readonly eqBPHigh2: BiquadFilterNode;
  private readonly eqHP1: BiquadFilterNode;
  private readonly eqHP2: BiquadFilterNode;
  readonly eqLow: GainNode;
  readonly eqMid: GainNode;
  readonly eqHigh: GainNode;
  private readonly eqMerge: GainNode;

  readonly colorFilter: BiquadFilterNode;
  readonly fx: DeckFx;
  readonly faderGain: GainNode;
  readonly xfaderGain: GainNode;

  /**
   * PFL (Pre-Fader Listen) tap.
   * Signal is tapped after ColorFX, before the channel fader.
   * Gain is 0 when CUE is off, 1 when CUE is on.
   */
  readonly cueGain: GainNode;

  /**
   * AnalyserNode tapped post-fader for real VU metering.
   * fftSize = 256 → 128 frequency bins, enough for a level reading.
   */
  readonly analyser: AnalyserNode;

  /** The node that sources should connect *into*. */
  get input(): GainNode {
    return this.trimGain;
  }

  /** The final output of this channel strip (goes to Master). */
  get output(): GainNode {
    return this.xfaderGain;
  }

  /** The PFL output (goes to Headphone Bus). */
  get cueOutput(): GainNode {
    return this.cueGain;
  }

  constructor(ctx: AudioContext, id: DeckId) {
    this.id = id;

    // ── Create nodes ─────────────────────────────────────────

    this.trimGain = ctx.createGain();
    this.trimGain.gain.value = 1;

    // ── 3-band isolator — Linkwitz-Riley 24dB/oct (LR4) ─────
    // Two cascaded Butterworth 12dB/oct per crossover point.

    const makeLR = (type: BiquadFilterType, freq: number) => {
      const f1 = ctx.createBiquadFilter();
      f1.type = type; f1.frequency.value = freq; f1.Q.value = 0.707;
      const f2 = ctx.createBiquadFilter();
      f2.type = type; f2.frequency.value = freq; f2.Q.value = 0.707;
      f1.connect(f2);
      return [f1, f2] as const;
    };

    // Low band: LP1 → LP2 @ 250Hz
    [this.eqLP1, this.eqLP2] = makeLR('lowpass', EQ_LOW_FREQ);
    this.eqLow = ctx.createGain();
    this.eqLow.gain.value = 1;

    // Mid band: HP1→HP2 @ 250Hz → LP3→LP4 @ 4kHz
    [this.eqBPLow1, this.eqBPLow2] = makeLR('highpass', EQ_LOW_FREQ);
    [this.eqBPHigh1, this.eqBPHigh2] = makeLR('lowpass', EQ_HIGH_FREQ);
    this.eqBPLow2.connect(this.eqBPHigh1); // chain bandpass
    this.eqMid = ctx.createGain();
    this.eqMid.gain.value = 1;

    // High band: HP1 → HP2 @ 4kHz
    [this.eqHP1, this.eqHP2] = makeLR('highpass', EQ_HIGH_FREQ);
    this.eqHigh = ctx.createGain();
    this.eqHigh.gain.value = 1;

    // Merge point
    this.eqMerge = ctx.createGain();
    this.eqMerge.gain.value = 1;

    this.colorFilter = ctx.createBiquadFilter();
    this.colorFilter.type = 'lowpass';
    this.colorFilter.frequency.value = COLOR_OFF_FREQ;
    this.colorFilter.Q.value = 0.707;

    this.fx = new DeckFx(ctx);

    this.faderGain = ctx.createGain();
    this.faderGain.gain.value = 1;

    this.xfaderGain = ctx.createGain();
    this.xfaderGain.gain.value = 1;

    // PFL tap – starts silent (CUE off).
    this.cueGain = ctx.createGain();
    this.cueGain.gain.value = 0;

    // Post-fader analyser for VU metering.
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    // ── Wire the chain ───────────────────────────────────────
    //
    // Linkwitz-Riley 24dB/oct parallel isolator EQ:
    //   Trim → LP1→LP2(250) → lowGain  → merge
    //   Trim → HP1→HP2(250) → LP3→LP4(4k) → midGain → merge
    //   Trim → HP3→HP4(4k) → highGain → merge
    //   merge → ColorFX → FX → Fader → Analyser → Xfader

    // Low band (LP1→LP2 already chained in makeLR)
    this.trimGain.connect(this.eqLP1);
    this.eqLP2.connect(this.eqLow);
    this.eqLow.connect(this.eqMerge);

    // Mid band (HP1→HP2→LP3→LP4 already chained)
    this.trimGain.connect(this.eqBPLow1);
    this.eqBPHigh2.connect(this.eqMid);
    this.eqMid.connect(this.eqMerge);

    // High band (HP1→HP2 already chained)
    this.trimGain.connect(this.eqHP1);
    this.eqHP2.connect(this.eqHigh);
    this.eqHigh.connect(this.eqMerge);

    // Post-EQ chain
    this.eqMerge.connect(this.colorFilter);

    // Master path: ColorFX → FX Chain → Fader → Analyser → Xfader
    this.colorFilter.connect(this.fx.input);
    this.fx.output.connect(this.faderGain);
    this.faderGain.connect(this.analyser);
    this.analyser.connect(this.xfaderGain);

    // PFL path: FX output → CueGain (so DJ hears FX in headphones)
    this.fx.output.connect(this.cueGain);
  }

  // ── Parameter Setters (all smoothed) ─────────────────────

  setEq(band: 'low' | 'mid' | 'high', db: number, ctx: AudioContext, rangeMin?: number): void {
    const node =
      band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh;
    const isKill = rangeMin !== undefined && db <= rangeMin;

    // Parallel isolator EQ: gain nodes are linear (0..N), not dB.
    // Convert dB → linear. Kill = 0 (complete silence on this band only).
    const linear = isKill ? 0 : Math.pow(10, db / 20);
    smoothParam(node.gain, linear, ctx);
  }

  setVolume(value: number, ctx: AudioContext): void {
    smoothParam(this.faderGain.gain, value, ctx);
  }

  setXfaderGain(value: number, ctx: AudioContext): void {
    smoothParam(this.xfaderGain.gain, value, ctx);
  }

  /** Activate/deactivate the PFL (CUE) send. */
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
      // #39: Taper Q near extremes to prevent self-oscillation
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

  /** Call periodically (~50ms) to schedule beat-locked gate events. */
  updateGate(bpm: number, currentTime: number, gridOffset: number): void {
    this.fx.updateGate(bpm, currentTime, gridOffset);
  }

  destroy(): void {
    this.trimGain.disconnect();
    this.eqHigh.disconnect();
    this.eqMid.disconnect();
    this.eqLow.disconnect();
    this.colorFilter.disconnect();
    this.fx.destroy();
    this.faderGain.disconnect();
    this.xfaderGain.disconnect();
    this.analyser.disconnect();
    this.cueGain.disconnect();
  }
}
