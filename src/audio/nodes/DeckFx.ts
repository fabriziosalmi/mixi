/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Per-Deck FX Chain
//
// 6 send effects inserted post-EQ, pre-fader:
//   FLT  — Bipolar filter (LPF/HPF sweep)
//   DLY  — Tempo delay with feedback
//   REV  — Synthetic reverb (convolver)
//   PHA  — 4-stage allpass phaser with LFO
//   FLG  — Flanger (short modulated delay)
//   GATE — Beat-locked gate
//
// Each FX has:
//   - amount (0–1): dry/wet crossfade
//   - active (boolean): bypass when false
//   - Inserted as parallel dry/wet into the chain
// ─────────────────────────────────────────────────────────────

import { smoothParam } from '../utils/paramSmooth';

export type FxId = 'flt' | 'dly' | 'rev' | 'pha' | 'flg' | 'gate' | 'crush' | 'echo' | 'tape' | 'noise';

// M3+M4: Shared buffers — created once, reused by all DeckFx instances.
let _sharedNoiseBuf: AudioBuffer | null = null;
let _sharedReverbIR: AudioBuffer | null = null;

/**
 * Generate a synthetic reverb impulse response.
 * Short decay (~1s), diffuse, suitable for DJ use.
 */
function createReverbIR(ctx: AudioContext, duration = 1.2, decay = 3): AudioBuffer {
  const length = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

export class DeckFx {
  // ── Input / Output ────────────────────────────────────────
  readonly input: GainNode;
  readonly output: GainNode;

  // ── Per-FX dry/wet gains ──────────────────────────────────
  private readonly dryGain: GainNode;

  // FLT
  private readonly fltLP: BiquadFilterNode;
  private readonly fltHP: BiquadFilterNode;
  private readonly fltBypass: GainNode;
  private readonly fltLPGain: GainNode;
  private readonly fltHPGain: GainNode;
  private readonly fltMerge: GainNode;

  // DLY
  private readonly dlyNode: DelayNode;
  private readonly dlyFeedback: GainNode;
  private readonly dlyWet: GainNode;

  // REV
  private readonly revConvolver: ConvolverNode;
  private readonly revWet: GainNode;

  // PHA (4-stage allpass)
  private readonly phaFilters: BiquadFilterNode[];
  private readonly phaLfo: OscillatorNode;
  private readonly phaLfoGain: GainNode;
  private readonly phaWet: GainNode;

  // FLG
  private readonly flgDelay: DelayNode;
  private readonly flgLfo: OscillatorNode;
  private readonly flgLfoGain: GainNode;
  private readonly flgFeedback: GainNode;
  private readonly flgWet: GainNode;

  // CRUSH (bitcrusher — waveshaper staircase)
  private readonly crushShaper: WaveShaperNode;
  private readonly crushWet: GainNode;

  // ECHO (dub delay — long feedback, dark)
  private readonly echoDelay: DelayNode;
  private readonly echoFilter: BiquadFilterNode;
  private readonly echoFeedback: GainNode;
  private readonly echoWet: GainNode;

  // TAPE (tape stop — LP darkening + volume pump simulates slowdown)
  private readonly tapeFilter: BiquadFilterNode;
  private readonly tapeWet: GainNode;

  // NOISE (white noise sweep for buildups)
  private readonly noiseSource: AudioBufferSourceNode;
  private readonly noiseFilter: BiquadFilterNode;
  private readonly noiseWet: GainNode;

  // GATE (beat-locked via AudioParam scheduling)
  private readonly gateGain: GainNode;
  private gateActive = false;

  get isGateActive(): boolean { return this.gateActive; }
  private gateDivision = 2; // index into GATE_DIVISIONS

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;

    // ── FLT ──────────────────────────────────────────────────
    this.fltLP = ctx.createBiquadFilter();
    this.fltLP.type = 'lowpass';
    this.fltLP.frequency.value = 20000;
    this.fltLP.Q.value = 1;
    this.fltHP = ctx.createBiquadFilter();
    this.fltHP.type = 'highpass';
    this.fltHP.frequency.value = 20;
    this.fltHP.Q.value = 1;
    this.fltBypass = ctx.createGain();
    this.fltBypass.gain.value = 1;
    this.fltLPGain = ctx.createGain();
    this.fltLPGain.gain.value = 0;
    this.fltHPGain = ctx.createGain();
    this.fltHPGain.gain.value = 0;
    this.fltMerge = ctx.createGain();

    // ── DLY ──────────────────────────────────────────────────
    this.dlyNode = ctx.createDelay(2);
    this.dlyNode.delayTime.value = 0.375; // 3/8 beat at 120bpm
    this.dlyFeedback = ctx.createGain();
    this.dlyFeedback.gain.value = 0.4;
    this.dlyWet = ctx.createGain();
    this.dlyWet.gain.value = 0;

    // ── REV ──────────────────────────────────────────────────
    this.revConvolver = ctx.createConvolver();
    // M4: Share reverb IR between decks (211KB saved)
    if (!_sharedReverbIR) _sharedReverbIR = createReverbIR(ctx);
    this.revConvolver.buffer = _sharedReverbIR;
    this.revWet = ctx.createGain();
    this.revWet.gain.value = 0;

    // ── PHA ──────────────────────────────────────────────────
    this.phaFilters = Array.from({ length: 4 }, () => {
      const f = ctx.createBiquadFilter();
      f.type = 'allpass';
      f.frequency.value = 1000;
      f.Q.value = 5;
      return f;
    });
    this.phaLfo = ctx.createOscillator();
    this.phaLfo.type = 'sine';
    this.phaLfo.frequency.value = 0.5; // Hz
    this.phaLfoGain = ctx.createGain();
    this.phaLfoGain.gain.value = 800;
    this.phaWet = ctx.createGain();
    this.phaWet.gain.value = 0;

    // ── FLG ──────────────────────────────────────────────────
    this.flgDelay = ctx.createDelay(0.02);
    this.flgDelay.delayTime.value = 0.005;
    this.flgLfo = ctx.createOscillator();
    this.flgLfo.type = 'sine';
    this.flgLfo.frequency.value = 0.3;
    this.flgLfoGain = ctx.createGain();
    this.flgLfoGain.gain.value = 0.003;
    this.flgFeedback = ctx.createGain();
    this.flgFeedback.gain.value = 0.6;
    this.flgWet = ctx.createGain();
    this.flgWet.gain.value = 0;

    // ── CRUSH (bitcrusher — staircase waveshaper) ─────────────
    this.crushShaper = ctx.createWaveShaper();
    this.crushShaper.curve = DeckFx.buildCrushCurve(16); // 16 steps = mild
    this.crushShaper.oversample = 'none';
    this.crushWet = ctx.createGain();
    this.crushWet.gain.value = 0;

    // ── ECHO (dub delay — dark, long feedback) ──────────────
    this.echoDelay = ctx.createDelay(2);
    this.echoDelay.delayTime.value = 0.5;
    this.echoFilter = ctx.createBiquadFilter();
    this.echoFilter.type = 'lowpass';
    this.echoFilter.frequency.value = 2000;
    this.echoFilter.Q.value = 0.5;
    this.echoFeedback = ctx.createGain();
    this.echoFeedback.gain.value = 0.6;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;

    // ── TAPE (tape stop — LP darkening + volume pump) ──────────
    this.tapeFilter = ctx.createBiquadFilter();
    this.tapeFilter.type = 'lowpass';
    this.tapeFilter.frequency.value = 20000;
    this.tapeFilter.Q.value = 0.5;
    this.tapeWet = ctx.createGain();
    this.tapeWet.gain.value = 0;

    // ── NOISE (white noise sweep for buildups) ──────────────
    // M3: Share noise buffer between decks (352KB saved)
    if (!_sharedNoiseBuf) {
      _sharedNoiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = _sharedNoiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = _sharedNoiseBuf;
    this.noiseSource.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.value = 200;
    this.noiseFilter.Q.value = 2;
    this.noiseWet = ctx.createGain();
    this.noiseWet.gain.value = 0;
    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseWet);
    this.noiseSource.start();

    // ── GATE ─────────────────────────────────────────────────
    this.gateGain = ctx.createGain();
    this.gateGain.gain.value = 1;

    // ── Wiring ───────────────────────────────────────────────
    // Main chain: input → FLT → DLY/REV/PHA/FLG sends → GATE → output
    // Dry path always passes through

    // Input → FLT paths
    this.input.connect(this.fltBypass);
    this.input.connect(this.fltLP);
    this.input.connect(this.fltHP);
    this.fltLP.connect(this.fltLPGain);
    this.fltHP.connect(this.fltHPGain);
    this.fltBypass.connect(this.fltMerge);
    this.fltLPGain.connect(this.fltMerge);
    this.fltHPGain.connect(this.fltMerge);

    // FLT merge → dry path
    this.fltMerge.connect(this.dryGain);
    this.dryGain.connect(this.gateGain);

    // DLY send: fltMerge → delay → feedback loop → wet → gate
    this.fltMerge.connect(this.dlyNode);
    this.dlyNode.connect(this.dlyFeedback);
    this.dlyFeedback.connect(this.dlyNode);
    this.dlyNode.connect(this.dlyWet);
    this.dlyWet.connect(this.gateGain);

    // REV send: fltMerge → convolver → wet → gate
    this.fltMerge.connect(this.revConvolver);
    this.revConvolver.connect(this.revWet);
    this.revWet.connect(this.gateGain);

    // PHA send: fltMerge → allpass chain → wet → gate
    let phaInput: AudioNode = this.fltMerge;
    for (const f of this.phaFilters) {
      phaInput.connect(f);
      phaInput = f;
    }
    phaInput.connect(this.phaWet);
    this.phaWet.connect(this.gateGain);
    // LFO → allpass frequencies
    this.phaLfo.connect(this.phaLfoGain);
    for (const f of this.phaFilters) {
      this.phaLfoGain.connect(f.frequency);
    }
    this.phaLfo.start();

    // FLG send: fltMerge → flanger delay → feedback → wet → gate
    this.fltMerge.connect(this.flgDelay);
    this.flgDelay.connect(this.flgFeedback);
    this.flgFeedback.connect(this.flgDelay);
    this.flgDelay.connect(this.flgWet);
    this.flgWet.connect(this.gateGain);
    // LFO → delay time
    this.flgLfo.connect(this.flgLfoGain);
    this.flgLfoGain.connect(this.flgDelay.delayTime);
    this.flgLfo.start();

    // CRUSH send: fltMerge → crushShaper → crushWet → gate
    this.fltMerge.connect(this.crushShaper);
    this.crushShaper.connect(this.crushWet);
    this.crushWet.connect(this.gateGain);

    // ECHO send: fltMerge → echoDelay → echoFilter → echoFeedback → echoDelay (loop) → echoWet → gate
    this.fltMerge.connect(this.echoDelay);
    this.echoDelay.connect(this.echoFilter);
    this.echoFilter.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay);
    this.echoFilter.connect(this.echoWet);
    this.echoWet.connect(this.gateGain);

    // TAPE: fltMerge → tapeFilter (LP darkening) → tapeWet → gate
    this.fltMerge.connect(this.tapeFilter);
    this.tapeFilter.connect(this.tapeWet);
    this.tapeWet.connect(this.gateGain);

    // NOISE send: noiseSource → noiseFilter → noiseWet → gate (independent, not from fltMerge)
    this.noiseWet.connect(this.gateGain);

    // Gate → output
    this.gateGain.connect(this.output);
  }

  // ── Public API ────────────────────────────────────────────

  // G1: Track active wet gain to compensate dry level.
  // Without this, dry(1.0) + wet FX are summed, causing gain > 1.0.
  private _activeWetSum = 0;
  /** Target wet gain values — avoids reading stale .value during ramps. */
  private _wetTargets: Record<string, number> = {};

  setFx(id: FxId, amount: number, active: boolean, ctx: AudioContext): void {
    switch (id) {
      case 'flt': this.setFilter(amount, active, ctx); break;
      case 'dly': this.setDelay(amount, active, ctx); break;
      case 'rev': this.setReverb(amount, active, ctx); break;
      case 'pha': this.setPhaser(amount, active, ctx); break;
      case 'flg': this.setFlanger(amount, active, ctx); break;
      case 'gate': this.setGate(amount, active, ctx); break;
      case 'crush': this.setCrush(amount, active, ctx); break;
      case 'echo': this.setEcho(amount, active, ctx); break;
      case 'tape': this.setTape(amount, active, ctx); break;
      case 'noise': this.setNoise(amount, active, ctx); break;
    }
    // G1: Compensate dry gain — reduce proportionally to total wet send.
    // Use tracked TARGET values (not AudioParam.value which is stale
    // during setTargetAtTime ramps, causing momentary gain spikes).
    this._activeWetSum = Object.values(this._wetTargets).reduce((a, b) => a + b, 0);
    const dryLevel = 1.0 / (1.0 + this._activeWetSum);
    smoothParam(this.dryGain.gain, dryLevel, ctx);
  }

  // ── FLT ────────────────────────────────────────────────────

  /**
   * #39: Clamp Q based on frequency to prevent self-oscillation.
   * Near the extremes (20Hz / 20kHz) the filter becomes unstable
   * at high Q, so we taper it down.
   */
  private static safeQ(freq: number, maxQ: number): number {
    // Normalise into 0–1 where 0 = 20Hz, 1 = 20kHz (log scale)
    const norm = Math.log(freq / 20) / Math.log(1000); // 0..1
    // Taper Q toward extremes: full Q in the middle, halved at edges
    const taper = 1 - 0.6 * Math.pow(2 * Math.abs(norm - 0.5), 2);
    return maxQ * Math.max(0.3, taper);
  }

  private setFilter(amount: number, active: boolean, ctx: AudioContext): void {
    if (!active || Math.abs(amount) < 0.01) {
      smoothParam(this.fltBypass.gain, 1, ctx);
      smoothParam(this.fltLPGain.gain, 0, ctx);
      smoothParam(this.fltHPGain.gain, 0, ctx);
      return;
    }
    // Bipolar: negative = LPF, positive = HPF
    const knob = amount * 2 - 1; // map 0–1 to -1..+1
    const absK = Math.abs(knob);
    const freq = 20 * Math.pow(1000, absK);
    const q = DeckFx.safeQ(freq, 4); // #39: dynamic Q clamping
    if (knob < 0) {
      smoothParam(this.fltBypass.gain, 0, ctx);
      smoothParam(this.fltLPGain.gain, 1, ctx);
      smoothParam(this.fltHPGain.gain, 0, ctx);
      smoothParam(this.fltLP.frequency, Math.min(20000, freq), ctx);
      smoothParam(this.fltLP.Q, q, ctx);
    } else {
      smoothParam(this.fltBypass.gain, 0, ctx);
      smoothParam(this.fltLPGain.gain, 0, ctx);
      smoothParam(this.fltHPGain.gain, 1, ctx);
      smoothParam(this.fltHP.frequency, Math.max(20, freq), ctx);
      smoothParam(this.fltHP.Q, q, ctx);
    }
  }

  // ── DLY ────────────────────────────────────────────────────

  private setDelay(amount: number, active: boolean, ctx: AudioContext): void {
    this._wetTargets.dly = active ? amount * 0.6 : 0;
    smoothParam(this.dlyWet.gain, this._wetTargets.dly, ctx);
    smoothParam(this.dlyFeedback.gain, 0.3 + amount * 0.35, ctx);
  }

  /** Set delay time synced to BPM. */
  setDelayTime(bpm: number, ctx: AudioContext): void {
    if (bpm <= 0) return;
    const beatSec = 60 / bpm;
    smoothParam(this.dlyNode.delayTime, beatSec * 0.75, ctx); // dotted 8th
  }

  // ── REV ────────────────────────────────────────────────────

  private setReverb(amount: number, active: boolean, ctx: AudioContext): void {
    this._wetTargets.rev = active ? amount * 0.5 : 0;
    smoothParam(this.revWet.gain, this._wetTargets.rev, ctx);
    // BUG-06: Do NOT modify shared dryGain — it ducks all other FX.
  }

  // ── PHA ────────────────────────────────────────────────────

  private phaWasActive = false;

  private setPhaser(amount: number, active: boolean, ctx: AudioContext): void {
    // #40: Reset LFO phase on activation for predictable sweep start.
    if (active && !this.phaWasActive) {
      // OscillatorNode can't reset phase — stop & recreate won't work
      // because start() can only be called once. Instead, we momentarily
      // set frequency very high to "fast-forward" to a known phase,
      // then restore. This is a pragmatic hack for Web Audio's limitation.
      // A more correct approach: disconnect old, create new oscillator.
      // For now the continuous-run approach with wet-gain gating is
      // musically acceptable — the LFO starts from wherever it is.
    }
    this.phaWasActive = active;
    this._wetTargets.pha = active ? amount * 0.7 : 0;
    smoothParam(this.phaWet.gain, this._wetTargets.pha, ctx);
    smoothParam(this.phaLfo.frequency, 0.2 + amount * 2, ctx); // 0.2–2.2 Hz
    smoothParam(this.phaLfoGain.gain, 400 + amount * 1200, ctx);
  }

  // ── FLG ────────────────────────────────────────────────────

  private flgWasActive = false;

  private setFlanger(amount: number, active: boolean, ctx: AudioContext): void {
    // #40: Reset delay base to neutral when re-activated.
    if (active && !this.flgWasActive) {
      // Reset delay to its base value so the sweep starts from center.
      this.flgDelay.delayTime.cancelScheduledValues(ctx.currentTime);
      this.flgDelay.delayTime.setValueAtTime(0.003, ctx.currentTime);
    }
    this.flgWasActive = active;
    this._wetTargets.flg = active ? amount * 0.6 : 0;
    smoothParam(this.flgWet.gain, this._wetTargets.flg, ctx);
    smoothParam(this.flgLfo.frequency, 0.1 + amount * 1.5, ctx);
    smoothParam(this.flgLfoGain.gain, 0.001 + amount * 0.004, ctx);
    // G2: cap feedback at 0.6 to prevent resonant peaks above 0dB
    smoothParam(this.flgFeedback.gain, 0.3 + amount * 0.3, ctx);
  }

  // ── GATE (beat-locked volume chop) ──────────────────────────
  //
  // Simple approach: updateGate() is called every ~50ms.
  // It computes where we are in the current beat cycle and sets
  // gain to 1 (open) or 0 (closed) based on the duty cycle.
  // No complex look-ahead scheduling — just immediate state.
  // The smoothParam ramp (12ms) prevents clicks.

  private static readonly GATE_BEAT_DIVS = [1/32, 1/16, 1/8, 1/4, 1/2];
  private static readonly GATE_DUTY = 0.7;  // 70% open / 30% closed

  private setGate(amount: number, active: boolean, _ctx: AudioContext): void {
    if (!active) {
      if (this.gateActive) this.stopGate();
      return;
    }
    this.gateActive = true;
    this.gateDivision = Math.round(Math.min(4, Math.max(0, amount)));
  }

  /**
   * Call every ~50ms from the engine.
   * Computes current position in the beat grid and sets gain
   * to 1 (open phase) or 0 (closed phase) of the gate cycle.
   */
  updateGate(bpm: number, _currentTime: number, gridOffset: number): void {
    if (!this.gateActive || bpm <= 0) return;

    const beatSec = 60 / bpm;
    const divSec = Math.max(0.01, beatSec * DeckFx.GATE_BEAT_DIVS[this.gateDivision]);
    const now = this.ctx.currentTime;

    // Where are we in the current gate cycle? (0..1)
    const elapsed = now - gridOffset;
    const phase = ((elapsed / divSec) % 1 + 1) % 1;

    // Open (gain=1) during first 70% of cycle, closed (gain=0) for last 30%
    const target = phase < DeckFx.GATE_DUTY ? 1 : 0;

    // Use fast ramp (2ms) — snappy chop, no click
    this.gateGain.gain.cancelScheduledValues(now);
    this.gateGain.gain.setTargetAtTime(target, now, 0.002);
  }

  private stopGate(): void {
    this.gateActive = false;
    const now = this.ctx.currentTime;
    this.gateGain.gain.cancelScheduledValues(now);
    this.gateGain.gain.setTargetAtTime(1, now, 0.005);
  }

  // ── CRUSH (bitcrusher) ──────────────────────────────────────

  private _lastCrushSteps = 16;

  private setCrush(amount: number, active: boolean, ctx: AudioContext): void {
    this._wetTargets.crush = active ? amount * 0.7 : 0;
    smoothParam(this.crushWet.gain, this._wetTargets.crush, ctx);
    if (active) {
      const steps = Math.max(3, Math.round(16 - amount * 13));
      // C1: Only regenerate curve when step count actually changes
      if (steps !== this._lastCrushSteps) {
        this._lastCrushSteps = steps;
        this.crushShaper.curve = DeckFx.buildCrushCurve(steps);
      }
    }
  }

  /** Build a staircase waveshaper curve for bit reduction. */
  private static buildCrushCurve(steps: number): Float32Array<ArrayBuffer> {
    const n = 4096;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  // ── ECHO (dub delay) ───────────────────────────────────────

  private setEcho(amount: number, active: boolean, ctx: AudioContext): void {
    this._wetTargets.echo = active ? amount * 0.5 : 0;
    smoothParam(this.echoWet.gain, this._wetTargets.echo, ctx);
    // M4: capped at 0.7 (was 0.85). At 0.85 with LP in the loop, low freqs
    // decay very slowly and build up perceptibly. 0.7 is still long but stable.
    smoothParam(this.echoFeedback.gain, 0.4 + amount * 0.3, ctx);
    smoothParam(this.echoFilter.frequency, 3000 - amount * 2200, ctx);
  }

  /** Set echo delay time synced to BPM. */
  setEchoTime(bpm: number, ctx: AudioContext): void {
    if (bpm <= 0) return;
    const beatSec = 60 / bpm;
    smoothParam(this.echoDelay.delayTime, beatSec * 0.5, ctx); // 1/2 beat
  }

  // ── TAPE (tape stop tonal simulation) ─────────────────────

  private setTape(amount: number, active: boolean, ctx: AudioContext): void {
    // Simulates tape slowing down: progressive LP darkening + volume pump.
    // amount=0: 20kHz (open), amount=1: 200Hz (very muffled)
    // Frequency: 20000 * (200/20000)^amount = 20000 * 0.01^amount
    // At 0: 20kHz (bypass), at 0.5: ~2kHz (warm), at 1: 200Hz (underwater)
    const freq = active ? 20000 * Math.pow(0.01, amount) : 20000;
    const q = active ? 0.5 + amount * 2 : 0.5; // slight resonance bump at low freqs
    smoothParam(this.tapeFilter.frequency, freq, ctx);
    smoothParam(this.tapeFilter.Q, q, ctx);
    this._wetTargets.tape = active ? 0.3 + amount * 0.3 : 0;
    smoothParam(this.tapeWet.gain, this._wetTargets.tape, ctx);
  }

  // ── NOISE (white noise sweep) ─────────────────────────────

  private setNoise(amount: number, active: boolean, ctx: AudioContext): void {
    this._wetTargets.noise = active ? amount * 0.35 : 0;
    smoothParam(this.noiseWet.gain, this._wetTargets.noise, ctx);
    // Sweep filter: 200 Hz → 12 kHz based on amount
    smoothParam(this.noiseFilter.frequency, 200 + amount * 11800, ctx);
    // G3: cap Q at 4 (~12dB peak) to prevent violent transients
    smoothParam(this.noiseFilter.Q, 1 + amount * 3, ctx);
  }

  /** Reset all FX to off/zero without destroying nodes. */
  resetAllFx(ctx: AudioContext): void {
    this.setFx('flt', 0, false, ctx);
    this.setFx('dly', 0, false, ctx);
    this.setFx('rev', 0, false, ctx);
    this.setFx('pha', 0, false, ctx);
    this.setFx('flg', 0, false, ctx);
    this.setFx('gate', 0, false, ctx);
    this.setFx('crush', 0, false, ctx);
    this.setFx('echo', 0, false, ctx);
    this.setFx('tape', 0, false, ctx);
    this.setFx('noise', 0, false, ctx);
    // BUG-19: Kill delay feedback tails immediately.
    this.dlyFeedback.gain.cancelScheduledValues(ctx.currentTime);
    this.dlyFeedback.gain.setValueAtTime(0, ctx.currentTime);
    this.echoFeedback.gain.cancelScheduledValues(ctx.currentTime);
    this.echoFeedback.gain.setValueAtTime(0, ctx.currentTime);
  }

  destroy(): void {
    this.stopGate();
    this.phaLfo.stop();
    this.flgLfo.stop();
    this.input.disconnect();
    this.output.disconnect();
    this.dryGain.disconnect();
    this.fltLP.disconnect();
    this.fltHP.disconnect();
    this.fltBypass.disconnect();
    this.fltLPGain.disconnect();
    this.fltHPGain.disconnect();
    this.fltMerge.disconnect();
    this.dlyNode.disconnect();
    this.dlyFeedback.disconnect();
    this.dlyWet.disconnect();
    this.revConvolver.disconnect();
    this.revWet.disconnect();
    for (const f of this.phaFilters) f.disconnect();
    this.phaLfo.disconnect();
    this.phaLfoGain.disconnect();
    this.phaWet.disconnect();
    this.flgDelay.disconnect();
    this.flgLfo.disconnect();
    this.flgLfoGain.disconnect();
    this.flgFeedback.disconnect();
    this.flgWet.disconnect();
    this.crushShaper.disconnect();
    this.crushWet.disconnect();
    this.echoDelay.disconnect();
    this.echoFilter.disconnect();
    this.echoFeedback.disconnect();
    this.echoWet.disconnect();
    this.tapeWet.disconnect();
    try { this.noiseSource.stop(); } catch { /* ok */ }
    this.noiseSource.disconnect();
    this.noiseFilter.disconnect();
    this.noiseWet.disconnect();
    this.gateGain.disconnect();
  }
}
