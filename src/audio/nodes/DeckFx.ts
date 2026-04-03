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

export type FxId = 'flt' | 'dly' | 'rev' | 'pha' | 'flg' | 'gate';

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

  // GATE (beat-locked via AudioParam scheduling)
  private readonly gateGain: GainNode;
  private gateActive = false;

  get isGateActive(): boolean { return this.gateActive; }
  private gateDivision = 2; // index into GATE_DIVISIONS
  private gateLastScheduled = 0;
  private gateLastBpm = 0;

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
    this.revConvolver.buffer = createReverbIR(ctx);
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

    // Gate → output
    this.gateGain.connect(this.output);
  }

  // ── Public API ────────────────────────────────────────────

  setFx(id: FxId, amount: number, active: boolean, ctx: AudioContext): void {
    switch (id) {
      case 'flt': this.setFilter(amount, active, ctx); break;
      case 'dly': this.setDelay(amount, active, ctx); break;
      case 'rev': this.setReverb(amount, active, ctx); break;
      case 'pha': this.setPhaser(amount, active, ctx); break;
      case 'flg': this.setFlanger(amount, active, ctx); break;
      case 'gate': this.setGate(amount, active, ctx); break;
    }
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
    smoothParam(this.dlyWet.gain, active ? amount * 0.6 : 0, ctx);
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
    smoothParam(this.revWet.gain, active ? amount * 0.5 : 0, ctx);
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
    smoothParam(this.phaWet.gain, active ? amount * 0.7 : 0, ctx);
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
    smoothParam(this.flgWet.gain, active ? amount * 0.6 : 0, ctx);
    smoothParam(this.flgLfo.frequency, 0.1 + amount * 1.5, ctx);
    smoothParam(this.flgLfoGain.gain, 0.001 + amount * 0.004, ctx);
    smoothParam(this.flgFeedback.gain, 0.4 + amount * 0.4, ctx);
  }

  // ── GATE (beat-locked AudioParam scheduling) ───────────────
  //
  // Uses setValueAtTime / linearRampToValueAtTime to schedule
  // precise on/off transitions on the audio thread.
  // Duty cycle: 70% open / 30% closed — punchy, not mechanical.
  // Ramp time: 1ms — sharp but click-free.

  private static readonly GATE_BEAT_DIVS = [1/32, 1/16, 1/8, 1/4, 1/2];
  private static readonly GATE_DUTY = 0.7;  // 70% open
  private static readonly GATE_RAMP = 0.001; // 1ms attack/release

  private setGate(amount: number, active: boolean, _ctx: AudioContext): void {
    if (!active) {
      if (this.gateActive) this.stopGate();
      return;
    }
    this.gateActive = true;
    this.gateDivision = Math.round(Math.min(4, Math.max(0, amount)));
    // Scheduling happens in updateGate() called externally
  }

  /**
   * Call every ~50ms from the engine or rAF loop.
   * Schedules gate events 200ms ahead on the audio timeline.
   */
  updateGate(bpm: number, currentTime: number, gridOffset: number): void {
    if (!this.gateActive || bpm <= 0) return;

    // #31 — When BPM changes (pitch bend), cancel stale scheduled events
    // so the gate re-locks to the new tempo immediately.
    if (bpm !== this.gateLastBpm) {
      this.gateGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gateLastScheduled = 0;
      this.gateLastBpm = bpm;
    }

    const beatSec = 60 / bpm;
    // BUG-17: Clamp minimum division to 10ms to prevent scheduling explosion.
    const divSec = Math.max(0.01, beatSec * DeckFx.GATE_BEAT_DIVS[this.gateDivision]);
    const duty = DeckFx.GATE_DUTY;
    const ramp = DeckFx.GATE_RAMP;
    const lookAhead = 0.2; // schedule 200ms ahead
    const scheduleEnd = currentTime + lookAhead;

    const gain = this.gateGain.gain;

    // Find the next gate boundary relative to grid
    const elapsed = currentTime - gridOffset;
    const currentCycle = Math.floor(elapsed / divSec);
    let nextCycleStart = gridOffset + (currentCycle + 1) * divSec;

    // If we already scheduled past this point, skip
    if (nextCycleStart <= this.gateLastScheduled) {
      nextCycleStart = this.gateLastScheduled + divSec;
    }

    // Schedule gate events within the look-ahead window
    while (nextCycleStart < scheduleEnd) {
      const openEnd = nextCycleStart + divSec * duty;
      const closeEnd = nextCycleStart + divSec;

      // Open: ramp to 1
      if (nextCycleStart > currentTime) {
        gain.setValueAtTime(0, nextCycleStart);
        gain.linearRampToValueAtTime(1, nextCycleStart + ramp);
      }
      // Close: ramp to 0
      if (openEnd > currentTime) {
        gain.setValueAtTime(1, openEnd);
        gain.linearRampToValueAtTime(0, openEnd + ramp);
      }

      this.gateLastScheduled = closeEnd;
      nextCycleStart = closeEnd;
    }
  }

  private stopGate(): void {
    this.gateActive = false;
    this.gateLastScheduled = 0;
    // Cancel all scheduled gain events and hard-reset to unity.
    // Use a tiny future offset to avoid AudioParam timeline race.
    const t = this.ctx.currentTime + 0.005;
    this.gateGain.gain.cancelScheduledValues(0);
    this.gateGain.gain.setValueAtTime(1, t);
  }

  /** Reset all FX to off/zero without destroying nodes. */
  resetAllFx(ctx: AudioContext): void {
    this.setFx('flt', 0, false, ctx);
    this.setFx('dly', 0, false, ctx);
    this.setFx('rev', 0, false, ctx);
    this.setFx('pha', 0, false, ctx);
    this.setFx('flg', 0, false, ctx);
    this.setFx('gate', 0, false, ctx);
    // BUG-19: Kill delay feedback tail immediately.
    this.dlyFeedback.gain.cancelScheduledValues(ctx.currentTime);
    this.dlyFeedback.gain.setValueAtTime(0, ctx.currentTime);
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
    this.gateGain.disconnect();
  }
}
