/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – JS303 Acid Synth (v3)
//
// TB-303 emulation — circuit-level modeling:
//
//   v3 — Diode Ladder Filter:
//     4-pole diode ladder via AudioWorklet (mismatched first pole),
//     per-sample tanh saturation, resonance-controlled accent depth,
//     bipolar filter envelope, pre-filter HP, variable duty-cycle
//     square wave derived from sawtooth.
//
//   Inherited from v2:
//     Sub-oscillator, analog drift LFO, pre-filter drive,
//     accent click, Rat-style distortion, BPM-synced delay,
//     filter LFO (BPM-synced subdivisions).
//
// Signal chain:
//   mainOsc (saw/variable-pulse) ─┐
//   subOsc (sine, -1 oct) ────────┤→ preFilterHP → driveWS → diodeLadder
//   driftLfo → mainOsc.freq       │    ↑ filterLfo (BPM sync)
//                                 │    ↑ filterEnv (bipolar, accent-modulated)
//                                 └→ vca → distortion → delay → output
//   noiseClick → output (accent transient)
// ─────────────────────────────────────────────────────────────

import type { SynthParamId } from './types';
import { log } from '../../utils/logger';

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

  // ── Pre-filter HP (removes DC + tightens low end) ─────────
  private preFilterHP: BiquadFilterNode;

  // ── Pre-filter Drive ──────────────────────────────────────
  private driveInputGain: GainNode;
  private driveWS: WaveShaperNode;

  // ── Diode Ladder Filter (AudioWorklet) ────────────────────
  private filterNode: AudioWorkletNode | null = null;
  private filterFallback: BiquadFilterNode; // fallback if worklet fails
  private _useWorklet = false;
  private filterCutoffParam: AudioParam | null = null;
  private filterResParam: AudioParam | null = null;

  // ── Filter LFO ────────────────────────────────────────────
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

  // ── Variable Pulse Wave ───────────────────────────────────
  private _lastPulseOctave = -1; // track octave for PeriodicWave updates
  private _waveformMode: 'sawtooth' | 'pulse' = 'sawtooth';

  // ── State ─────────────────────────────────────────────────
  private _params: Record<SynthParamId, number> = {
    cutoff: 0.5, resonance: 0.5, envMod: 0.5, decay: 0.5,
    accent: 0.5, tuning: 0.5, waveform: 0,
    drive: 0, subLevel: 0.3, drift: 0.3,
    gateLength: 0.75, slideTime: 0.15, filterTracking: 0,
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
    this.driftOsc.frequency.value = 0.08 + Math.random() * 0.05;
    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0.8;

    // ── Pre-filter Highpass (44Hz, removes DC + tightens) ───
    this.preFilterHP = ctx.createBiquadFilter();
    this.preFilterHP.type = 'highpass';
    this.preFilterHP.frequency.value = 44;
    this.preFilterHP.Q.value = 0.5;

    // ── Pre-filter Drive (tanh saturation) ──────────────────
    this.driveInputGain = ctx.createGain();
    this.driveInputGain.gain.value = 1;
    this.driveWS = ctx.createWaveShaper();
    this.driveWS.oversample = '2x';
    this.setDriveCurve(0);

    // ── Fallback Filter (used until worklet loads) ──────────
    this.filterFallback = ctx.createBiquadFilter();
    this.filterFallback.type = 'lowpass';
    this.filterFallback.frequency.value = 800;
    this.filterFallback.Q.value = 8;

    // ── Filter LFO (BPM-synced) ────────────────────────────
    this.filterLfo = ctx.createOscillator();
    this.filterLfo.type = 'sine';
    this.filterLfo.frequency.value = 2;
    this.filterLfoGain = ctx.createGain();
    this.filterLfoGain.gain.value = 0;

    // ── VCA (amplitude envelope) ────────────────────────────
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;

    // ── Accent Click (noise buffer) ─────────────────────────
    const noiseLen = Math.ceil(ctx.sampleRate * 0.001);
    this.noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
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
    this.delayHpf = ctx.createBiquadFilter();
    this.delayHpf.type = 'highpass';
    this.delayHpf.frequency.value = 200;
    this.delayHpf.Q.value = 0.7;

    // ── Output ──────────────────────────────────────────────
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 1;

    // ══════════════════════════════════════════════════════════
    // WIRING (initial: uses fallback filter until worklet loads)
    // ══════════════════════════════════════════════════════════

    // Oscillators → merge
    this.mainOsc.connect(this.oscMerge);
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.oscMerge);

    // Drift LFO → main osc frequency
    this.driftOsc.connect(this.driftGain);
    this.driftGain.connect(this.mainOsc.frequency);

    // Merge → pre-filter HP → drive → filter → VCA
    this.oscMerge.connect(this.preFilterHP);
    this.preFilterHP.connect(this.driveInputGain);
    this.driveInputGain.connect(this.driveWS);
    this.driveWS.connect(this.filterFallback);
    this.filterFallback.connect(this.vca);

    // Filter LFO → filter frequency (fallback)
    this.filterLfo.connect(this.filterLfoGain);
    this.filterLfoGain.connect(this.filterFallback.frequency);

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

    // Attempt to load diode ladder worklet (async, non-blocking)
    this.loadDiodeLadderWorklet();
  }

  // ── Worklet Loading ───────────────────────────────────────

  private async loadDiodeLadderWorklet(): Promise<void> {
    try {
      const workletUrl = new URL('/worklets/diode-ladder-processor.js', import.meta.url);
      await this.ctx.audioWorklet.addModule(workletUrl.href);

      this.filterNode = new AudioWorkletNode(this.ctx, 'diode-ladder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: {},
      });

      // Grab AudioParam handles
      this.filterCutoffParam = this.filterNode.parameters.get('cutoff')!;
      this.filterResParam = this.filterNode.parameters.get('resonance')!;

      // Set initial values
      this.filterCutoffParam.value = this.getCutoffHz();
      this.filterResParam.value = this._params.resonance;

      // Rewire: disconnect fallback, insert worklet
      this.driveWS.disconnect();
      this.filterFallback.disconnect();
      this.filterLfoGain.disconnect();

      this.driveWS.connect(this.filterNode);
      this.filterNode.connect(this.vca);

      // Filter LFO → worklet cutoff param
      this.filterLfoGain.connect(this.filterCutoffParam);

      this._useWorklet = true;
      log.info('JS303', 'Diode ladder filter worklet loaded');
    } catch (e) {
      log.warn('JS303', 'Diode ladder worklet failed, using BiquadFilter fallback', e);
      this._useWorklet = false;
    }
  }

  connect(destination: AudioNode): void {
    this.outGain.connect(destination);
  }

  destroy(): void {
    this.mainOsc.stop();
    this.subOsc.stop();
    this.driftOsc.stop();
    this.filterLfo.stop();
    const nodes: AudioNode[] = [
      this.mainOsc, this.subOsc, this.subGain, this.oscMerge,
      this.driftOsc, this.driftGain, this.preFilterHP,
      this.driveInputGain, this.driveWS,
      this.filterFallback, this.filterLfo, this.filterLfoGain,
      this.vca, this.distWS, this.distGain, this.dryGain,
      this.delayNode, this.delayHpf, this.delayFb, this.delayWet,
      this.outGain,
    ];
    if (this.filterNode) nodes.push(this.filterNode);
    nodes.forEach(n => n.disconnect());
  }

  // ══════════════════════════════════════════════════════════
  // NOTE CONTROL — All parameters mathematically derived
  // ══════════════════════════════════════════════════════════
  //
  // Parameter Derivations:
  //
  // ── CUTOFF (getCutoffHz) ─────────────────────────────────
  // Exponential mapping: 20Hz → 18kHz over 0→1 knob range.
  // f(x) = 20 · 900^x  (since 18000/20 = 900)
  // This gives equal perceived spacing: each 0.1 knob increment
  // is ~1 octave. Matches human pitch perception (Weber-Fechner).
  //
  // ── DECAY (getDecaySec) ──────────────────────────────────
  // Exponential mapping: 20ms → 2s over 0→1 knob range.
  // f(x) = 0.02 · 100^x  (since 2.0/0.02 = 100)
  // Short decays (acid) get fine control (0-0.3 = 20-170ms),
  // long decays (pads) use the upper range (0.7-1 = 500ms-2s).
  //
  // ── ENV MOD (envelope depth) ─────────────────────────────
  // Multiplicative sweep in octaves (not additive Hz).
  // envPeak = cutoff · 2^(envMod · 7)
  // At envMod=0: peak = cutoff (no sweep)
  // At envMod=1: peak = cutoff · 128 (7 octaves up)
  // Octave-based sweep matches filter perception: going from
  // 200→400Hz sounds the same as 2000→4000Hz.
  //
  // ── ACCENT ───────────────────────────────────────────────
  // Three independent interactions:
  //   1. Filter: envPeak boosted by √(1 + res·3) — resonance
  //      controls accent depth (from Barkhausen: more feedback
  //      = more energy at resonant peak = louder accent sweep)
  //   2. Decay: forced to 20ms + 10% of base decay — RC discharge
  //      with reduced capacitance (accent switches in a parallel
  //      capacitor that halves the effective C)
  //   3. VCA: independent boost of 1 + accent·0.8 — models the
  //      separate accent VCA in the 303 circuit
  //
  // ── SLIDE TIME ───────────────────────────────────────────
  // RC time constant: τ = 0.005 · 60^slideTime
  //   slideTime=0: τ=5ms (instant snap)
  //   slideTime=0.5: τ=39ms (standard glide)
  //   slideTime=1: τ=300ms (slow liquid)
  // Exponential gives more control in the fast range.
  // A 63.2% complete glide takes 1τ; 95% takes 3τ.
  // Accent halves τ (faster attack = punchier slide).
  //
  // ── FILTER TRACKING ──────────────────────────────────────
  // Logarithmic (octave-based), not linear Hz:
  //   trackedCutoff = cutoff · 2^((midi-60)·tracking/12)
  // At tracking=1: cutoff doubles per octave (1:1 tracking)
  // At tracking=0.5: cutoff increases ~41% per octave
  // Reference: MIDI 60 (C4) = no shift
  // This matches equal temperament: semitone ratio = 2^(1/12)
  //
  // ── BIPOLAR ENVELOPE ─────────────────────────────────────
  // Phase 1: Spike to envPeak (instant)
  // Phase 2: Exponential decay to undershoot (cutoff · 0.85)
  //   The 15% undershoot creates a "dip" below the steady-state
  //   cutoff, producing the characteristic pump/breathing effect.
  //   Duration = decaySec (from decay knob or accent override)
  // Phase 3: Slow recovery to true cutoff
  //   Time constant = decaySec · 0.6 (60% of decay time)
  //   This creates an asymmetric envelope: fast down, slow up.
  //
  // ── RESONANCE BOOST (ACCENT) ─────────────────────────────
  // Peak resonance = base + 0.2 (absolute, not relative)
  // Decay back to base with τ = decaySec · 0.4
  // The 0.2 absolute boost means accent squelch is consistent
  // regardless of base resonance setting.
  //
  // ══════════════════════════════════════════════════════════

  noteOn(freq: number, time: number, accent: boolean, slide: boolean): void {
    const resonance = this._params.resonance;
    const baseCutoffHz = this.getCutoffHz();
    const envMod = this._params.envMod;
    const baseDec = this.getDecaySec();

    // ── Filter Tracking (logarithmic, octave-based) ─────────
    const midiNote = 12 * Math.log2(freq / 440) + 69;
    const tracking = this._params.filterTracking;
    // cutoff · 2^((midi-60)·tracking/12) — 1:1 at tracking=1
    const cutoffHz = tracking > 0.001
      ? Math.max(20, Math.min(18000, baseCutoffHz * Math.pow(2, (midiNote - 60) * tracking / 12)))
      : baseCutoffHz;

    // ── Accent calculations ─────────────────────────────────
    // Filter depth boost: √(1 + res·3) — derived from resonance energy
    const accentEnvBoost = accent ? Math.sqrt(1 + resonance * 3) : 1;
    // VCA boost: independent amplitude (1 + accent_amount · 0.8)
    const accentVcaBoost = accent ? (1 + this._params.accent * 0.8) : 1;
    // Decay override: 20ms + 10% of base (halved RC)
    const decaySec = accent ? 0.02 + baseDec * 0.1 : baseDec;

    // ── Pitch ───────────────────────────────────────────────
    const subFreq = freq * 0.5;

    if (slide) {
      // Slide: exponential RC time constant 5ms–300ms
      const tau = 0.005 * Math.pow(60, this._params.slideTime);
      const glideTime = accent ? tau * 0.5 : tau;
      this.mainOsc.frequency.cancelScheduledValues(time);
      this.mainOsc.frequency.setTargetAtTime(freq, time, glideTime);
      this.subOsc.frequency.cancelScheduledValues(time);
      this.subOsc.frequency.setTargetAtTime(subFreq, time, glideTime);
    } else {
      this.mainOsc.frequency.setValueAtTime(freq, time);
      this.subOsc.frequency.setValueAtTime(subFreq, time);
    }

    if (this._waveformMode === 'pulse') {
      this.updatePulseWave(freq);
    }

    // ── Filter Envelope (Bipolar) ───────────────────────────
    // Octave-based sweep: envPeak = cutoff · 2^(envMod·7·accentBoost)
    const sweepOctaves = envMod * 7 * accentEnvBoost;
    const envPeak = Math.min(cutoffHz * Math.pow(2, sweepOctaves), 18000);
    // Undershoot: 15% below cutoff (bipolar dip)
    const undershoot = Math.max(cutoffHz * 0.85, 20);
    const phase2End = time + decaySec;

    if (this._useWorklet && this.filterCutoffParam) {
      this.filterCutoffParam.cancelScheduledValues(time);
      this.filterCutoffParam.setValueAtTime(envPeak, time);
      this.filterCutoffParam.exponentialRampToValueAtTime(
        Math.max(undershoot, 20), phase2End,
      );
      // Phase 3: asymmetric recovery (τ = 60% of decay)
      this.filterCutoffParam.setTargetAtTime(cutoffHz, phase2End, decaySec * 0.6);

      // Accent resonance boost (+0.2 absolute, consistent squelch)
      if (accent) {
        const peakRes = Math.min(resonance + 0.2, 1);
        this.filterResParam!.cancelScheduledValues(time);
        this.filterResParam!.setValueAtTime(peakRes, time);
        this.filterResParam!.setTargetAtTime(resonance, time + 0.03, decaySec * 0.4);
      }
    } else {
      this.filterFallback.frequency.cancelScheduledValues(time);
      this.filterFallback.frequency.setValueAtTime(envPeak, time);
      this.filterFallback.frequency.exponentialRampToValueAtTime(
        Math.max(undershoot, 20), phase2End,
      );
      this.filterFallback.frequency.setTargetAtTime(cutoffHz, phase2End, decaySec * 0.6);

      if (accent) {
        const baseQ = 1 + resonance * 25;
        const accentQ = Math.min(baseQ * 1.3, 28);
        this.filterFallback.Q.cancelScheduledValues(time);
        this.filterFallback.Q.setValueAtTime(accentQ, time);
        this.filterFallback.Q.setTargetAtTime(baseQ, time + 0.03, decaySec * 0.4);
      }
    }

    // ── Amplitude Envelope ──────────────────────────────────
    if (!slide) {
      this.vca.gain.cancelScheduledValues(time);
      this.vca.gain.setValueAtTime(0, time);
      this.vca.gain.linearRampToValueAtTime(0.8 * accentVcaBoost, time + 0.002);
    }

    // ── Accent Click ────────────────────────────────────────
    if (accent && !slide) {
      const click = this.ctx.createBufferSource();
      click.buffer = this.noiseBuffer;
      const clickGain = this.ctx.createGain();
      clickGain.gain.value = 0.08 * this._params.accent;
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

  /** Returns current VCA state: true if note is sounding */
  get isNoteSounding(): boolean {
    return this.vca.gain.value > 0.01;
  }

  // ── Parameter Setters ─────────────────────────────────────

  setParam(id: SynthParamId, value: number): void {
    this._params[id] = value;
    const t = this.ctx.currentTime;
    switch (id) {
      case 'cutoff':
        if (this._useWorklet && this.filterCutoffParam) {
          this.filterCutoffParam.setTargetAtTime(this.getCutoffHz(), t, 0.01);
        } else {
          this.filterFallback.frequency.setTargetAtTime(this.getCutoffHz(), t, 0.01);
        }
        break;
      case 'resonance':
        if (this._useWorklet && this.filterResParam) {
          this.filterResParam.setTargetAtTime(value, t, 0.01);
        } else {
          this.filterFallback.Q.setTargetAtTime(1 + value * 25, t, 0.01);
        }
        break;
      case 'waveform':
        if (value > 0.5) {
          this._waveformMode = 'pulse';
          this.updatePulseWave(this.mainOsc.frequency.value);
        } else {
          this._waveformMode = 'sawtooth';
          this.mainOsc.type = 'sawtooth';
          this._lastPulseOctave = -1;
        }
        break;
      case 'drive':
        this.setDriveCurve(value);
        this.driveInputGain.gain.setTargetAtTime(1 + value * 3, t, 0.01);
        break;
      case 'subLevel':
        this.subGain.gain.setTargetAtTime(value, t, 0.01);
        break;
      case 'drift':
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
    const time = (60 / bpm) * 0.75;
    this.delayNode.delayTime.setTargetAtTime(time, this.ctx.currentTime, 0.01);
  }

  // ── Filter LFO ────────────────────────────────────────────

  setFilterLfo(depth: number, rate: number): void {
    const t = this.ctx.currentTime;
    const subdivisions = [0.25, 0.5, 1, 2, 4];
    const idx = Math.min(Math.floor(rate * subdivisions.length), subdivisions.length - 1);
    const lfoHz = (this._bpm / 60) * subdivisions[idx];
    this.filterLfo.frequency.setTargetAtTime(lfoHz, t, 0.02);

    const cutoff = this.getCutoffHz();
    this.filterLfoGain.gain.setTargetAtTime(depth * cutoff * 0.8, t, 0.02);
  }

  setBpm(bpm: number): void {
    this._bpm = bpm;
  }

  // ── Variable Duty-Cycle Pulse Wave ────────────────────────
  // The real 303 derives its square from the sawtooth via a
  // single-transistor circuit. This creates a pitch-dependent
  // duty cycle: ~45% at high pitches, ~71% at low.

  private updatePulseWave(freq: number): void {
    // Only recompute when octave changes significantly (saves CPU)
    const octave = Math.floor(Math.log2(freq / 55));
    if (octave === this._lastPulseOctave) return;
    this._lastPulseOctave = octave;

    // Duty cycle varies with pitch: low notes are fatter, high notes thinner
    // Map frequency range (55Hz–880Hz = C1–A5) to duty (0.71–0.45)
    const normalizedPitch = Math.max(0, Math.min(1, (freq - 55) / (880 - 55)));
    const duty = 0.71 - normalizedPitch * 0.26;

    // Build PeriodicWave from Fourier series of a pulse wave
    // Pulse wave: duty cycle d, harmonics: sin(n*pi*d) / (n*pi)
    const numHarmonics = Math.min(64, Math.floor(this.ctx.sampleRate / (2 * freq)));
    const real = new Float32Array(numHarmonics + 1);
    const imag = new Float32Array(numHarmonics + 1);
    real[0] = 0;
    imag[0] = 0;

    for (let n = 1; n <= numHarmonics; n++) {
      real[n] = 0;
      // Pulse wave Fourier coefficient: (2 / (n*pi)) * sin(n*pi*duty)
      imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    }

    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.mainOsc.setPeriodicWave(wave);
  }

  // ── Internal ──────────────────────────────────────────────

  /** Cutoff: exponential 20Hz→18kHz. f(x) = 20·900^x.
   *  Each 0.1 increment ≈ 1 octave (Weber-Fechner law). */
  private getCutoffHz(): number {
    return 20 * Math.pow(900, this._params.cutoff);
  }

  /** Decay: exponential 20ms→2s. f(x) = 0.02·100^x.
   *  Fine control in short range (acid), coarse in long (pads). */
  private getDecaySec(): number {
    return 0.02 * Math.pow(100, this._params.decay);
  }

  private setDriveCurve(amount: number): void {
    const k = 1 + amount * 8;
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    this.driveWS.curve = curve;
  }

  private setDistCurve(amount: number): void {
    const k = 1 + amount * 50;
    const samples = 512;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      if (x >= 0) {
        curve[i] = Math.tanh(k * x * 1.2) / Math.tanh(k * 1.2);
      } else {
        curve[i] = Math.tanh(k * x * 0.8) / Math.tanh(k * 0.8);
      }
    }
    this.distWS.curve = curve;
  }
}
