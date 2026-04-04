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

  // 3-band isolator EQ (parallel split, not series)
  //
  //   Trim → ┬─ LP (250Hz)     → lowGain  ──┐
  //          ├─ BP (250-4kHz)  → midGain  ──┤→ eqMerge → ColorFX
  //          └─ HP (4kHz)      → highGain ──┘
  //
  // Kill on any band = gain 0 → complete silence on that band only.
  // Other bands are completely unaffected (parallel, not series).
  private readonly eqLP: BiquadFilterNode;     // lowpass @ 250Hz
  private readonly eqBPLow: BiquadFilterNode;  // highpass @ 250Hz (mid band lower edge)
  private readonly eqBPHigh: BiquadFilterNode;  // lowpass @ 4kHz (mid band upper edge)
  private readonly eqHP: BiquadFilterNode;     // highpass @ 4kHz
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

    // ── 3-band isolator (parallel crossover) ─────────────────
    // Low band: LP @ 250Hz → lowGain
    this.eqLP = ctx.createBiquadFilter();
    this.eqLP.type = 'lowpass';
    this.eqLP.frequency.value = EQ_LOW_FREQ;
    this.eqLP.Q.value = 0.707; // Butterworth

    this.eqLow = ctx.createGain();
    this.eqLow.gain.value = 1;

    // Mid band: HP @ 250Hz → LP @ 4kHz → midGain (bandpass)
    this.eqBPLow = ctx.createBiquadFilter();
    this.eqBPLow.type = 'highpass';
    this.eqBPLow.frequency.value = EQ_LOW_FREQ;
    this.eqBPLow.Q.value = 0.707;

    this.eqBPHigh = ctx.createBiquadFilter();
    this.eqBPHigh.type = 'lowpass';
    this.eqBPHigh.frequency.value = EQ_HIGH_FREQ;
    this.eqBPHigh.Q.value = 0.707;

    this.eqMid = ctx.createGain();
    this.eqMid.gain.value = 1;

    // High band: HP @ 4kHz → highGain
    this.eqHP = ctx.createBiquadFilter();
    this.eqHP.type = 'highpass';
    this.eqHP.frequency.value = EQ_HIGH_FREQ;
    this.eqHP.Q.value = 0.707;

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
    // 3-band parallel isolator EQ:
    //   Trim → LP(250) → lowGain  → merge
    //   Trim → HP(250) → LP(4k) → midGain → merge
    //   Trim → HP(4k) → highGain → merge
    //   merge → ColorFX → FX → Fader → Analyser → Xfader

    // Low band
    this.trimGain.connect(this.eqLP);
    this.eqLP.connect(this.eqLow);
    this.eqLow.connect(this.eqMerge);

    // Mid band (HP + LP in series = bandpass)
    this.trimGain.connect(this.eqBPLow);
    this.eqBPLow.connect(this.eqBPHigh);
    this.eqBPHigh.connect(this.eqMid);
    this.eqMid.connect(this.eqMerge);

    // High band
    this.trimGain.connect(this.eqHP);
    this.eqHP.connect(this.eqHigh);
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
