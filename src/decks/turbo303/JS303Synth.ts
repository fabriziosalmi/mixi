/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – JS303 Acid Synth (Pure WebAudio)
//
// TB-303 emulation using persistent oscillator + resonant filter
// + envelope + distortion. No external Wasm dependencies.
//
//   Oscillator (saw/square) → Filter (LP, high Q) → VCA envelope
//     → Distortion (WaveShaper) → output
//
// Supports slide (portamento) and accent (velocity emphasis).
// ─────────────────────────────────────────────────────────────

import type { SynthParamId } from './types';

export class JS303Synth {
  private ctx: AudioContext;

  // Persistent nodes (stay alive for entire session)
  private osc: OscillatorNode;
  private filter: BiquadFilterNode;
  private vca: GainNode;
  private distortion: WaveShaperNode;
  private distGain: GainNode;
  private dryGain: GainNode;
  private outGain: GainNode;

  // Delay FX
  private delayNode: DelayNode;
  private delayFeedback: GainNode;
  private delayWet: GainNode;

  // State
  private _params: Record<SynthParamId, number> = {
    cutoff: 0.5, resonance: 0.5, envMod: 0.5,
    decay: 0.5, accent: 0.5, tuning: 0.5, waveform: 0,
  };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // ── Oscillator (persistent) ─────────────────────────────
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 220;

    // ── Resonant LP filter (the 303 heart) ──────────────────
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 800;
    this.filter.Q.value = 8;

    // ── VCA (amplitude envelope) ────────────────────────────
    this.vca = ctx.createGain();
    this.vca.gain.value = 0; // silent until triggered

    // ── Distortion (tanh waveshaper) ────────────────────────
    this.distortion = ctx.createWaveShaper();
    this.distortion.oversample = '4x';
    this.distGain = ctx.createGain();
    this.distGain.gain.value = 0;
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.setDistCurve(0);

    // ── Output ──────────────────────────────────────────────
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 1;

    // ── Delay ───────────────────────────────────────────────
    this.delayNode = ctx.createDelay(1);
    this.delayNode.delayTime.value = 0.375; // dotted 8th at 120bpm
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.4;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0;

    // ── Wiring ──────────────────────────────────────────────
    // osc → filter → vca → [dry + dist] → outGain → [delay send] → output
    this.osc.connect(this.filter);
    this.filter.connect(this.vca);

    // Dry path
    this.vca.connect(this.dryGain);
    this.dryGain.connect(this.outGain);

    // Distortion path
    this.vca.connect(this.distortion);
    this.distortion.connect(this.distGain);
    this.distGain.connect(this.outGain);

    // Delay send (from output, feedback loop)
    this.outGain.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.outGain);

    // Start oscillator (persistent)
    this.osc.start();
  }

  /** Connect synth output to a destination node. */
  connect(destination: AudioNode): void {
    this.outGain.connect(destination);
  }

  destroy(): void {
    this.osc.stop();
    this.osc.disconnect();
    this.filter.disconnect();
    this.vca.disconnect();
    this.distortion.disconnect();
    this.distGain.disconnect();
    this.dryGain.disconnect();
    this.outGain.disconnect();
    this.delayNode.disconnect();
    this.delayFeedback.disconnect();
    this.delayWet.disconnect();
  }

  // ── Note Control ──────────────────────────────────────────

  /**
   * Trigger a note at a specific AudioContext time.
   * @param freq — frequency in Hz
   * @param time — AudioContext time
   * @param accent — accent flag (boosts envelope + filter)
   * @param slide — slide from previous note (portamento)
   */
  noteOn(freq: number, time: number, accent: boolean, slide: boolean): void {
    const accentBoost = accent ? (1 + this._params.accent) : 1;
    const cutoffHz = this.getCutoffHz();
    const envMod = this._params.envMod;
    const decaySec = this.getDecaySec();

    // Pitch
    if (slide) {
      // Portamento: glide to new frequency over ~60ms
      this.osc.frequency.cancelScheduledValues(time);
      this.osc.frequency.setTargetAtTime(freq, time, 0.02);
    } else {
      this.osc.frequency.setValueAtTime(freq, time);
    }

    // Filter envelope: sweep from high to cutoff
    const envPeak = cutoffHz + envMod * 8000 * accentBoost;
    this.filter.frequency.cancelScheduledValues(time);
    this.filter.frequency.setValueAtTime(Math.min(envPeak, 18000), time);
    this.filter.frequency.exponentialRampToValueAtTime(
      Math.max(cutoffHz, 20), time + decaySec,
    );

    // Amplitude envelope
    if (!slide) {
      this.vca.gain.cancelScheduledValues(time);
      this.vca.gain.setValueAtTime(0, time);
      this.vca.gain.linearRampToValueAtTime(0.8 * accentBoost, time + 0.003); // 3ms attack
    }
  }

  noteOff(time: number, slide: boolean): void {
    if (slide) return; // don't release during slide
    const decaySec = this.getDecaySec();
    this.vca.gain.cancelScheduledValues(time);
    this.vca.gain.setTargetAtTime(0, time, decaySec * 0.3);
  }

  // ── Parameter Setters ─────────────────────────────────────

  setParam(id: SynthParamId, value: number): void {
    this._params[id] = value;
    switch (id) {
      case 'cutoff':
        this.filter.frequency.setTargetAtTime(this.getCutoffHz(), this.ctx.currentTime, 0.01);
        break;
      case 'resonance':
        this.filter.Q.setTargetAtTime(1 + value * 25, this.ctx.currentTime, 0.01);
        break;
      case 'waveform':
        this.osc.type = value > 0.5 ? 'square' : 'sawtooth';
        break;
    }
  }

  setDistortion(shape: number, _threshold: number): void {
    this.setDistCurve(shape);
    const wet = shape > 0.01 ? shape : 0;
    this.distGain.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.01);
    this.dryGain.gain.setTargetAtTime(1 - wet * 0.5, this.ctx.currentTime, 0.01);
  }

  setDelay(feedback: number, send: number): void {
    this.delayFeedback.gain.setTargetAtTime(
      Math.min(feedback * 0.85, 0.85), this.ctx.currentTime, 0.01,
    );
    this.delayWet.gain.setTargetAtTime(send, this.ctx.currentTime, 0.01);
  }

  setDelayTime(bpm: number): void {
    // Dotted 8th note
    const time = (60 / bpm) * 0.75;
    this.delayNode.delayTime.setTargetAtTime(time, this.ctx.currentTime, 0.01);
  }

  // ── Internal ──────────────────────────────────────────────

  private getCutoffHz(): number {
    // Exponential mapping: 0→80Hz, 0.5→800Hz, 1→16kHz
    return 80 * Math.pow(200, this._params.cutoff);
  }

  private getDecaySec(): number {
    return 0.05 + this._params.decay * 1.5; // 50ms – 1.55s
  }

  private setDistCurve(amount: number): void {
    const k = 1 + amount * 50;
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    this.distortion.curve = curve;
  }
}
