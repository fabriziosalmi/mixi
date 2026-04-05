/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – TurboKick Audio Bus
//
// Single-channel kick bus with dual valve insert chain:
//
//   KickSource → InputGain → ValveA (tube saturation)
//              → ValveB (punch compressor) → FX section → Output
//
// FX section: Filter → Bitcrush → Delay Send (dry/wet)
//
// Output connects to DeckChannel.input so audio flows through
// EQ → ColorFX → Fader → Crossfader → Master.
// ─────────────────────────────────────────────────────────────

export class TurboKickBus {
  /** Bus output — connect to DeckChannel.input. */
  readonly output: GainNode;
  /** Where kick samples connect. */
  readonly input: GainNode;

  // ── Valve nodes ─────────────────────────────────────────
  private readonly valveAShaper: WaveShaperNode;
  private readonly valveADrive: GainNode;
  private readonly valveBShaper: WaveShaperNode;
  private readonly valveBDrive: GainNode;

  // ── FX nodes ────────────────────────────────────────────
  private readonly filterNode: BiquadFilterNode;
  private readonly delayNode: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly delayWet: GainNode;
  private readonly dryGain: GainNode;

  // ── LFO nodes ──────────────────────────────────────────
  private readonly lfoOsc: OscillatorNode;
  private readonly lfoGain: GainNode;

  // ── RUMBLE nodes ───────────────────────────────────────
  // Reverb (convolver) → dark LP filter → sidechain compressor → wet mix
  private readonly rumbleConvolver: ConvolverNode;
  private readonly rumbleDarkFilter: BiquadFilterNode;
  private readonly rumbleDelay: DelayNode;
  private readonly rumbleDelayFb: GainNode;
  private readonly rumbleWet: GainNode;
  private readonly rumbleCompGain: GainNode;  // sidechain ducking

  // ── State ───────────────────────────────────────────────
  private _valveA = 0;
  private _valveB = 0;
  private _filter = 1;
  private _resonance = 0;
  private _delay = 0;
  private _lfoRate = 0;
  private _lfoDepth = 0;
  private _rumble = 0;

  constructor(private readonly ctx: AudioContext) {
    // Input gain
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    // ── Valve A: Tube saturation (tanh waveshaper) ────────
    this.valveADrive = ctx.createGain();
    this.valveADrive.gain.value = 1;
    this.valveAShaper = ctx.createWaveShaper();
    this.valveAShaper.curve = makeTubeCurve(1);
    this.valveAShaper.oversample = 'none'; // M1: start clean, enable on drive > 1

    // ── Valve B: Punch (harder clip waveshaper) ───────────
    this.valveBDrive = ctx.createGain();
    this.valveBDrive.gain.value = 1;
    this.valveBShaper = ctx.createWaveShaper();
    this.valveBShaper.curve = makePunchCurve(1);
    this.valveBShaper.oversample = 'none';

    // ── Filter ────────────────────────────────────────────
    this.filterNode = ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = 20000;
    this.filterNode.Q.value = 0.707;

    // ── Delay ─────────────────────────────────────────────
    this.delayNode = ctx.createDelay(1.0);
    this.delayNode.delayTime.value = 0.15;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.35;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0;
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;

    // ── LFO — modulates filter cutoff ───────────────────────
    // The LFO oscillates around the filter's base frequency.
    // Range is "smart": sweeps between ~200 Hz and ~4000 Hz
    // so it never kills the sub nor opens fully — always musical.
    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.type = 'sine';
    this.lfoOsc.frequency.value = 0;   // starts off (0 Hz = DC)
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0;       // depth off by default
    this.lfoOsc.connect(this.lfoGain);
    this.lfoGain.connect(this.filterNode.frequency);
    this.lfoOsc.start();

    // ── RUMBLE — dark reverb + short delay + sidechain ───
    // Convolver with synthetic dark impulse response
    this.rumbleConvolver = ctx.createConvolver();
    this.rumbleConvolver.buffer = buildDarkIR(ctx, 2.5);

    // Dark LP filter on reverb tail — only sub/low-mid passes
    this.rumbleDarkFilter = ctx.createBiquadFilter();
    this.rumbleDarkFilter.type = 'lowpass';
    this.rumbleDarkFilter.frequency.value = 250;
    this.rumbleDarkFilter.Q.value = 0.5;

    // Short rhythmic delay (1/16 note, set dynamically)
    this.rumbleDelay = ctx.createDelay(0.5);
    this.rumbleDelay.delayTime.value = 0.088; // ~1/16 at 170 BPM
    this.rumbleDelayFb = ctx.createGain();
    this.rumbleDelayFb.gain.value = 0.3;

    // Sidechain compressor gain (ducked by kick trigger)
    this.rumbleCompGain = ctx.createGain();
    this.rumbleCompGain.gain.value = 1;

    // Wet mix (0 = off by default)
    this.rumbleWet = ctx.createGain();
    this.rumbleWet.gain.value = 0;

    // Output
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;

    // ── Wire ──────────────────────────────────────────────
    // Input → ValveA drive → ValveA shaper → ValveB drive → ValveB shaper → Filter
    this.input.connect(this.valveADrive);
    this.valveADrive.connect(this.valveAShaper);
    this.valveAShaper.connect(this.valveBDrive);
    this.valveBDrive.connect(this.valveBShaper);
    this.valveBShaper.connect(this.filterNode);

    // Filter → Dry path → Output
    this.filterNode.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Filter → Delay → Feedback loop → Wet → Output
    this.filterNode.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.output);

    // RUMBLE chain: Input → Convolver → DarkFilter → RumbleDelay(fb loop) → Sidechain → Wet → Output
    this.input.connect(this.rumbleConvolver);
    this.rumbleConvolver.connect(this.rumbleDarkFilter);
    this.rumbleDarkFilter.connect(this.rumbleDelay);
    this.rumbleDelay.connect(this.rumbleDelayFb);
    this.rumbleDelayFb.connect(this.rumbleDelay);
    this.rumbleDarkFilter.connect(this.rumbleCompGain);
    this.rumbleDelay.connect(this.rumbleCompGain);
    this.rumbleCompGain.connect(this.rumbleWet);
    this.rumbleWet.connect(this.output);
  }

  // ── Valve A: Tube saturation ──────────────────────────────

  private _lastTubeDrive = 1;
  private _lastPunchDrive = 1;

  get valveA(): number { return this._valveA; }
  set valveA(v: number) {
    this._valveA = clamp01(v);
    const drive = 1 + this._valveA * 7;
    this.valveADrive.gain.setTargetAtTime(drive, this.ctx.currentTime, 0.01);
    // M1: Toggle oversample only when needed (saves ~10% CPU on mobile)
    this.valveAShaper.oversample = drive > 1.05 ? '4x' : 'none';
    // C2: Only regen curve when drive changes meaningfully (0.05 step)
    const quantized = Math.round(drive * 20) / 20;
    if (quantized !== this._lastTubeDrive) {
      this._lastTubeDrive = quantized;
      this.valveAShaper.curve = makeTubeCurve(drive);
    }
  }

  // ── Valve B: Punch compressor ─────────────────────────────

  get valveB(): number { return this._valveB; }
  set valveB(v: number) {
    this._valveB = clamp01(v);
    const drive = 1 + this._valveB * 5;
    this.valveBDrive.gain.setTargetAtTime(drive, this.ctx.currentTime, 0.01);
    this.valveBShaper.oversample = drive > 1.05 ? '4x' : 'none';
    const quantized = Math.round(drive * 20) / 20;
    if (quantized !== this._lastPunchDrive) {
      this._lastPunchDrive = quantized;
      this.valveBShaper.curve = makePunchCurve(drive);
    }
  }

  // ── FX controls ───────────────────────────────────────────

  get filter(): number { return this._filter; }
  set filter(v: number) {
    this._filter = clamp01(v);
    // Map 0–1 → 60–20000 Hz (exponential)
    const freq = 60 * Math.pow(20000 / 60, this._filter);
    this.filterNode.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.01);
  }

  get resonance(): number { return this._resonance; }
  set resonance(v: number) {
    this._resonance = clamp01(v);
    // Map 0–1 → 0.707–18
    this.filterNode.Q.setTargetAtTime(0.707 + this._resonance * 17.3, this.ctx.currentTime, 0.01);
  }


  get delay(): number { return this._delay; }
  set delay(v: number) {
    this._delay = clamp01(v);
    this.delayWet.gain.setTargetAtTime(this._delay * 0.6, this.ctx.currentTime, 0.01);
  }

  // ── RUMBLE controls ────────────────────────────────────────
  //
  // Berghain rumble: dark reverb + short delay + sidechain.
  // When kick fires, rumble ducks (compresses) and swells back
  // between hits, filling the space with dark sub-boom.

  get rumble(): number { return this._rumble; }
  set rumble(v: number) {
    this._rumble = clamp01(v);
    this.rumbleWet.gain.setTargetAtTime(this._rumble * 0.7, this.ctx.currentTime, 0.02);
  }

  /** Call on every kick trigger to duck the rumble (sidechain). */
  duckRumble(): void {
    if (this._rumble < 0.01) return;
    const now = this.ctx.currentTime;
    const g = this.rumbleCompGain.gain;
    // Fast attack: duck to near-zero in 5ms
    g.cancelScheduledValues(now);
    g.setValueAtTime(0.05, now);
    // Slow release: swell back over ~200ms (the "suck" effect)
    g.setTargetAtTime(1, now + 0.005, 0.08);
  }

  /** Update rumble delay time to match BPM (1/16 note). */
  setRumbleBpm(bpm: number): void {
    if (bpm <= 0) return;
    const sixteenth = 60 / bpm / 4;
    this.rumbleDelay.delayTime.setTargetAtTime(sixteenth, this.ctx.currentTime, 0.01);
  }

  // ── LFO controls ───────────────────────────────────────────
  //
  // "Smart" LFO: modulates filter frequency around a musical
  // mid-range (200–4000 Hz band). The base filter cutoff sets
  // the center point; the LFO swings ±depth around it.
  // At depth 0 the LFO is silent. At depth 1 it sweeps wide
  // but never fully closes (sub-safe) or fully opens.

  get lfoRate(): number { return this._lfoRate; }
  set lfoRate(v: number) {
    this._lfoRate = clamp01(v);
    // 0–1 → 0.1–20 Hz (exponential for musical feel)
    const hz = 0.1 * Math.pow(200, this._lfoRate);
    this.lfoOsc.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
  }

  get lfoDepth(): number { return this._lfoDepth; }
  set lfoDepth(v: number) {
    this._lfoDepth = clamp01(v);
    // Depth modulates filter freq in Hz.
    // Max swing: ±3000 Hz — keeps it in the 200–4000 sweet spot
    // when filter knob is centered. Musical, never destructive.
    const swing = this._lfoDepth * 3000;
    this.lfoGain.gain.setTargetAtTime(swing, this.ctx.currentTime, 0.02);
  }

  // ── Cleanup ───────────────────────────────────────────────

  destroy(): void {
    try { this.lfoOsc.stop(); } catch { /* ok */ }
    const nodes = [
      this.input, this.valveADrive, this.valveAShaper,
      this.valveBDrive, this.valveBShaper, this.filterNode,
      this.delayNode, this.delayFeedback, this.delayWet,
      this.dryGain, this.output, this.lfoOsc, this.lfoGain,
      this.rumbleConvolver, this.rumbleDarkFilter, this.rumbleDelay,
      this.rumbleDelayFb, this.rumbleWet, this.rumbleCompGain,
    ];
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* ok */ }
    }
  }
}

// ── Dark impulse response for RUMBLE reverb ───────────────────

/** Synthesize a dark, boomy impulse response (no samples needed). */
function buildDarkIR(ctx: AudioContext, duration: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * duration);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // Exponential decay
      const env = Math.exp(-t * 2.5);
      // Filtered noise — only low frequencies survive
      const noise = (Math.random() * 2 - 1);
      // Simple 1-pole lowpass to darken the IR
      const lp = i > 0 ? data[i - 1] * 0.97 + noise * 0.03 : noise * 0.03;
      data[i] = lp * env * 0.4;
    }
  }
  return buf;
}

// ── Waveshaper curves ─────────────────────────────────────────

/** Tube saturation: smooth tanh-based curve. */
function makeTubeCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 8192;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive || 1);
  }
  return curve;
}

/** Punch curve: harder clipping with asymmetric compression. */
function makePunchCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 8192;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const driven = x * drive;
    // Asymmetric soft-clip: positive side compresses harder
    if (driven >= 0) {
      curve[i] = 1 - Math.exp(-driven);
    } else {
      curve[i] = -1 + Math.exp(driven);
    }
  }
  return curve;
}

function clamp01(v: number): number {
  return v > 1 ? 1 : v < 0 ? 0 : v;
}
