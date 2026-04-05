/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – JS303 Acid Synth (SOTA Edition)
//
// TB-303 emulation — 5 iterations of analog modeling:
//
//   Iter 1 — Audio SOTA:
//     Sub-oscillator (sine, -1 octave), analog drift LFO,
//     pre-filter drive (tanh saturation), accent click (noise burst),
//     exponential slide (variable glide), extended accent decay.
//
//   Iter 2 — FX Chain:
//     Rat-style asymmetric distortion, BPM-synced delay with HP feedback,
//     filter LFO (BPM-synced subdivisions).
//
// Signal chain:
//   mainOsc (saw/square) ─┐
//   subOsc (sine, -1 oct) ┤→ driveWS → filter (LP, Q 0-26)
//   driftLfo → mainOsc.freq│    ↑ filterLfo (BPM sync)
//                          │    ↑ filterEnv (accent boost)
//                          └→ vca → distortion → delay → output
//   noiseClick → output (accent transient)
// ─────────────────────────────────────────────────────────────

import type { SynthParamId } from './types';

export class JS303Synth {
  private ctx: AudioContext;

  // ── Oscillators ───────────────────────────────────────────
  private mainOsc: OscillatorNode;
  private subOsc: OscillatorNode;
  private subGain: GainNode;
  private oscMerge: GainNode;

  // ── Analog Drift ──────────────────────────────────────────
  private driftOsc: OscillatorNode;
  private driftGain: GainNode;

  // ── Pre-filter Drive ──────────────────────────────────────
  private driveInputGain: GainNode;
  private driveWS: WaveShaperNode;

  // ── Filter + Envelope ─────────────────────────────────────
  private filter: BiquadFilterNode;
  private filterLfo: OscillatorNode;
  private filterLfoGain: GainNode;

  // ── VCA ───────────────────────────────────────────────────
  private vca: GainNode;

  // ── Accent Click (noise burst) ────────────────────────────
  private noiseBuffer: AudioBuffer;

  // ── Distortion (Rat-style asymmetric) ─────────────────────
  private distWS: WaveShaperNode;
  private distGain: GainNode;
  private dryGain: GainNode;

  // ── BPM-synced Delay with HP feedback ─────────────────────
  private delayNode: DelayNode;
  private delayFb: GainNode;
  private delayWet: GainNode;
  private delayHpf: BiquadFilterNode;

  // ── Output ────────────────────────────────────────────────
  private outGain: GainNode;

  // ── State ─────────────────────────────────────────────────
  private _params: Record<SynthParamId, number> = {
    cutoff: 0.5, resonance: 0.5, envMod: 0.5, decay: 0.5,
    accent: 0.5, tuning: 0.5, waveform: 0,
    drive: 0, subLevel: 0.3, drift: 0.3,
  };
  private _bpm = 130;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // ── Main Oscillator (persistent) ────────────────────────
    this.mainOsc = ctx.createOscillator();
    this.mainOsc.type = 'sawtooth';
    this.mainOsc.frequency.value = 220;

    // ── Sub Oscillator (sine, -1 octave) ────────────────────
    this.subOsc = ctx.createOscillator();
    this.subOsc.type = 'sine';
    this.subOsc.frequency.value = 110;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.3;

    // ── Oscillator Merge ────────────────────────────────────
    this.oscMerge = ctx.createGain();
    this.oscMerge.gain.value = 1;

    // ── Analog Drift LFO (~0.1Hz, ±5 cents) ────────────────
    this.driftOsc = ctx.createOscillator();
    this.driftOsc.type = 'sine';
    this.driftOsc.frequency.value = 0.08 + Math.random() * 0.05; // 0.08-0.13 Hz (slightly random)
    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0.8; // ±0.8 Hz at 220Hz ≈ ±6 cents

    // ── Pre-filter Drive (tanh saturation) ──────────────────
    this.driveInputGain = ctx.createGain();
    this.driveInputGain.gain.value = 1;
    this.driveWS = ctx.createWaveShaper();
    this.driveWS.oversample = '2x';
    this.setDriveCurve(0);

    // ── Resonant LP Filter (the 303 heart) ──────────────────
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 800;
    this.filter.Q.value = 8;

    // ── Filter LFO (BPM-synced) ────────────────────────────
    this.filterLfo = ctx.createOscillator();
    this.filterLfo.type = 'sine';
    this.filterLfo.frequency.value = 2; // default 2Hz, overridden by BPM sync
    this.filterLfoGain = ctx.createGain();
    this.filterLfoGain.gain.value = 0; // off by default

    // ── VCA (amplitude envelope) ────────────────────────────
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;

    // ── Accent Click (noise buffer) ─────────────────────────
    const noiseLen = Math.ceil(ctx.sampleRate * 0.001); // 1ms
    this.noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      // Shaped noise: sharp attack, fast decay
      const env = Math.exp(-i / (noiseLen * 0.3));
      noiseData[i] = (Math.random() * 2 - 1) * env;
    }

    // ── Distortion (Rat-style asymmetric hard clip + LP) ────
    this.distWS = ctx.createWaveShaper();
    this.distWS.oversample = '4x';
    this.distGain = ctx.createGain();
    this.distGain.gain.value = 0;
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.setDistCurve(0);

    // ── BPM-synced Delay ────────────────────────────────────
    this.delayNode = ctx.createDelay(2);
    this.delayNode.delayTime.value = 0.375;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.4;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0;
    // HP filter in feedback loop (cut mud below 200Hz)
    this.delayHpf = ctx.createBiquadFilter();
    this.delayHpf.type = 'highpass';
    this.delayHpf.frequency.value = 200;
    this.delayHpf.Q.value = 0.7;

    // ── Output ──────────────────────────────────────────────
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 1;

    // ══════════════════════════════════════════════════════════
    // WIRING
    // ══════════════════════════════════════════════════════════

    // Oscillators → merge
    this.mainOsc.connect(this.oscMerge);
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.oscMerge);

    // Drift LFO → main osc frequency
    this.driftOsc.connect(this.driftGain);
    this.driftGain.connect(this.mainOsc.frequency);

    // Merge → drive → filter → VCA
    this.oscMerge.connect(this.driveInputGain);
    this.driveInputGain.connect(this.driveWS);
    this.driveWS.connect(this.filter);
    this.filter.connect(this.vca);

    // Filter LFO → filter frequency
    this.filterLfo.connect(this.filterLfoGain);
    this.filterLfoGain.connect(this.filter.frequency);

    // VCA → dry path
    this.vca.connect(this.dryGain);
    this.dryGain.connect(this.outGain);

    // VCA → distortion path
    this.vca.connect(this.distWS);
    this.distWS.connect(this.distGain);
    this.distGain.connect(this.outGain);

    // Delay send (from output) with HP in feedback
    this.outGain.connect(this.delayNode);
    this.delayNode.connect(this.delayHpf);
    this.delayHpf.connect(this.delayFb);
    this.delayFb.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.outGain);

    // Start all persistent oscillators
    this.mainOsc.start();
    this.subOsc.start();
    this.driftOsc.start();
    this.filterLfo.start();
  }

  connect(destination: AudioNode): void {
    this.outGain.connect(destination);
  }

  destroy(): void {
    this.mainOsc.stop();
    this.subOsc.stop();
    this.driftOsc.stop();
    this.filterLfo.stop();
    // Disconnect all
    [
      this.mainOsc, this.subOsc, this.subGain, this.oscMerge,
      this.driftOsc, this.driftGain, this.driveInputGain, this.driveWS,
      this.filter, this.filterLfo, this.filterLfoGain,
      this.vca, this.distWS, this.distGain, this.dryGain,
      this.delayNode, this.delayHpf, this.delayFb, this.delayWet,
      this.outGain,
    ].forEach(n => n.disconnect());
  }

  // ── Note Control ──────────────────────────────────────────

  noteOn(freq: number, time: number, accent: boolean, slide: boolean): void {
    const accentBoost = accent ? (1 + this._params.accent * 0.8) : 1;
    const cutoffHz = this.getCutoffHz();
    const envMod = this._params.envMod;
    const baseDec = this.getDecaySec();
    // Accent extends decay by up to 50%
    const decaySec = accent ? baseDec * (1 + this._params.accent * 0.5) : baseDec;

    // ── Pitch ───────────────────────────────────────────────
    const subFreq = freq * 0.5; // Sub is always -1 octave

    if (slide) {
      // Exponential glide — fast start, slow tail (the "liquid" squelch)
      // Variable time constant: accented slides are faster
      const glideTime = accent ? 0.015 : 0.035;
      this.mainOsc.frequency.cancelScheduledValues(time);
      this.mainOsc.frequency.setTargetAtTime(freq, time, glideTime);
      this.subOsc.frequency.cancelScheduledValues(time);
      this.subOsc.frequency.setTargetAtTime(subFreq, time, glideTime);
    } else {
      this.mainOsc.frequency.setValueAtTime(freq, time);
      this.subOsc.frequency.setValueAtTime(subFreq, time);
    }

    // ── Filter Envelope ─────────────────────────────────────
    // Sweep from high (envPeak) down to cutoff
    const envPeak = Math.min(cutoffHz + envMod * 8000 * accentBoost, 18000);
    this.filter.frequency.cancelScheduledValues(time);
    this.filter.frequency.setValueAtTime(envPeak, time);
    this.filter.frequency.exponentialRampToValueAtTime(
      Math.max(cutoffHz, 20), time + decaySec,
    );

    // On accent: also boost resonance momentarily for extra squelch
    if (accent) {
      const baseQ = 1 + this._params.resonance * 25;
      const accentQ = Math.min(baseQ * 1.4, 30);
      this.filter.Q.cancelScheduledValues(time);
      this.filter.Q.setValueAtTime(accentQ, time);
      this.filter.Q.setTargetAtTime(baseQ, time + 0.05, decaySec * 0.5);
    }

    // ── Amplitude Envelope ──────────────────────────────────
    if (!slide) {
      this.vca.gain.cancelScheduledValues(time);
      this.vca.gain.setValueAtTime(0, time);
      // 2ms attack (snappy, the 303 way)
      this.vca.gain.linearRampToValueAtTime(0.8 * accentBoost, time + 0.002);
    }

    // ── Accent Click ────────────────────────────────────────
    // Short noise burst on accented notes for percussive impact
    if (accent && !slide) {
      const click = this.ctx.createBufferSource();
      click.buffer = this.noiseBuffer;
      const clickGain = this.ctx.createGain();
      clickGain.gain.value = 0.08 * this._params.accent; // ~-22dB, scaled by accent amount
      click.connect(clickGain);
      clickGain.connect(this.outGain);
      click.start(time);
    }
  }

  noteOff(time: number, slide: boolean): void {
    if (slide) return;
    const decaySec = this.getDecaySec();
    this.vca.gain.cancelScheduledValues(time);
    this.vca.gain.setTargetAtTime(0, time, decaySec * 0.25);
  }

  // ── Ducking helper (called by bus for reverb ducking) ─────
  /** Returns current VCA state: true if note is sounding */
  get isNoteSounding(): boolean {
    // Approximate: if VCA was recently triggered
    return this.vca.gain.value > 0.01;
  }

  // ── Parameter Setters ─────────────────────────────────────

  setParam(id: SynthParamId, value: number): void {
    this._params[id] = value;
    const t = this.ctx.currentTime;
    switch (id) {
      case 'cutoff':
        this.filter.frequency.setTargetAtTime(this.getCutoffHz(), t, 0.01);
        break;
      case 'resonance':
        this.filter.Q.setTargetAtTime(1 + value * 25, t, 0.01);
        break;
      case 'waveform':
        this.mainOsc.type = value > 0.5 ? 'square' : 'sawtooth';
        break;
      case 'drive':
        this.setDriveCurve(value);
        // Drive also boosts input gain for more saturation
        this.driveInputGain.gain.setTargetAtTime(1 + value * 3, t, 0.01);
        break;
      case 'subLevel':
        this.subGain.gain.setTargetAtTime(value, t, 0.01);
        break;
      case 'drift':
        // Scale drift: 0→0Hz, 0.5→0.8Hz, 1→2Hz deviation
        this.driftGain.gain.setTargetAtTime(value * 2.5, t, 0.05);
        break;
    }
  }

  setDistortion(shape: number, _threshold: number): void {
    this.setDistCurve(shape);
    const wet = shape > 0.01 ? shape : 0;
    const t = this.ctx.currentTime;
    this.distGain.gain.setTargetAtTime(wet, t, 0.01);
    this.dryGain.gain.setTargetAtTime(1 - wet * 0.5, t, 0.01);
  }

  setDelay(feedback: number, send: number): void {
    const t = this.ctx.currentTime;
    this.delayFb.gain.setTargetAtTime(Math.min(feedback * 0.85, 0.85), t, 0.01);
    this.delayWet.gain.setTargetAtTime(send, t, 0.01);
  }

  setDelayTime(bpm: number): void {
    this._bpm = bpm;
    // Dotted 8th note for classic acid delay
    const time = (60 / bpm) * 0.75;
    this.delayNode.delayTime.setTargetAtTime(time, this.ctx.currentTime, 0.01);
  }

  // ── Filter LFO ────────────────────────────────────────────

  setFilterLfo(depth: number, rate: number): void {
    const t = this.ctx.currentTime;
    // Rate maps to BPM subdivision: 0→1/4, 0.33→1/8, 0.66→1/16, 1→1/32
    const subdivisions = [0.25, 0.5, 1, 2, 4];
    const idx = Math.min(Math.floor(rate * subdivisions.length), subdivisions.length - 1);
    const lfoHz = (this._bpm / 60) * subdivisions[idx];
    this.filterLfo.frequency.setTargetAtTime(lfoHz, t, 0.02);

    // Depth modulates filter frequency: 0→0Hz, 1→3000Hz swing
    const cutoff = this.getCutoffHz();
    this.filterLfoGain.gain.setTargetAtTime(depth * cutoff * 0.8, t, 0.02);
  }

  setBpm(bpm: number): void {
    this._bpm = bpm;
  }

  // ── Internal ──────────────────────────────────────────────

  private getCutoffHz(): number {
    // Exponential: 0→80Hz, 0.5→800Hz, 1→16kHz
    return 80 * Math.pow(200, this._params.cutoff);
  }

  private getDecaySec(): number {
    return 0.05 + this._params.decay * 1.5;
  }

  /** Pre-filter drive: tanh soft clip with adjustable intensity */
  private setDriveCurve(amount: number): void {
    const k = 1 + amount * 8; // gentler than distortion, just warming
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    this.driveWS.curve = curve;
  }

  /** Rat-style asymmetric hard clip + LP taper */
  private setDistCurve(amount: number): void {
    const k = 1 + amount * 50;
    const samples = 512;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      // Asymmetric: positive side clips harder (diode clipping)
      if (x >= 0) {
        curve[i] = Math.tanh(k * x * 1.2) / Math.tanh(k * 1.2);
      } else {
        // Negative side: softer clip (the Rat's germanium diode asymmetry)
        curve[i] = Math.tanh(k * x * 0.8) / Math.tanh(k * 0.8);
      }
    }
    this.distWS.curve = curve;
  }
}
