/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// JS303 Bus — Pro FX Chain (Iter 2)
//
// Signal chain:
//   input → reverbSend ─→ convolver → reverbDuck → reverbReturn ─┐
//   input → dryPath ──────────────────────────────────────────────┤→ chorusMerge
//     → chorus (2× modulated delay) → autoPan (StereoPanner+LFO) │
//     → limiter (DynamicsCompressor) → output                    │
//
// Features:
//   - Spring reverb (generated IR, metallic comb character)
//   - Ducking reverb (gain modulated by note events)
//   - Chorus (dual modulated delay lines)
//   - Auto-pan (LFO → StereoPanner, depth linked to cutoff)
//   - Brick-wall limiter (ratio 20:1, 1ms attack)
// ─────────────────────────────────────────────────────────────

export class JS303Bus {
  private ctx: AudioContext;
  public readonly input: GainNode;
  public readonly output: GainNode;

  // ── Reverb ────────────────────────────────────────────────
  private convolver: ConvolverNode;
  private reverbSend: GainNode;
  private reverbReturn: GainNode;
  private reverbDuck: GainNode;
  private dryPath: GainNode;

  // ── Chorus ────────────────────────────────────────────────
  private chorusDry: GainNode;
  private chorusWet: GainNode;
  private chorusDelay1: DelayNode;
  private chorusDelay2: DelayNode;
  private chorusLfo1: OscillatorNode;
  private chorusLfo2: OscillatorNode;
  private chorusLfoGain1: GainNode;
  private chorusLfoGain2: GainNode;

  // ── Auto-Pan ──────────────────────────────────────────────
  private panner: StereoPannerNode;
  private panLfo: OscillatorNode;
  private panLfoGain: GainNode;

  // ── Limiter ───────────────────────────────────────────────
  private limiter: DynamicsCompressorNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // ── Spring Reverb (synthetic IR) ────────────────────────
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.generateSpringIR(1.2, 4);

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.5;
    this.reverbDuck = ctx.createGain();
    this.reverbDuck.gain.value = 1;
    this.dryPath = ctx.createGain();
    this.dryPath.gain.value = 1;

    // ── Chorus ──────────────────────────────────────────────
    this.chorusDry = ctx.createGain();
    this.chorusDry.gain.value = 1;
    this.chorusWet = ctx.createGain();
    this.chorusWet.gain.value = 0;

    this.chorusDelay1 = ctx.createDelay(0.05);
    this.chorusDelay1.delayTime.value = 0.012;
    this.chorusDelay2 = ctx.createDelay(0.05);
    this.chorusDelay2.delayTime.value = 0.018;

    this.chorusLfo1 = ctx.createOscillator();
    this.chorusLfo1.type = 'sine';
    this.chorusLfo1.frequency.value = 0.7;
    this.chorusLfoGain1 = ctx.createGain();
    this.chorusLfoGain1.gain.value = 0.003;

    this.chorusLfo2 = ctx.createOscillator();
    this.chorusLfo2.type = 'sine';
    this.chorusLfo2.frequency.value = 0.9;
    this.chorusLfoGain2 = ctx.createGain();
    this.chorusLfoGain2.gain.value = 0.004;

    // ── Auto-Pan ────────────────────────────────────────────
    this.panner = ctx.createStereoPanner();
    this.panner.pan.value = 0;

    this.panLfo = ctx.createOscillator();
    this.panLfo.type = 'sine';
    this.panLfo.frequency.value = 0.25;
    this.panLfoGain = ctx.createGain();
    this.panLfoGain.gain.value = 0; // off by default

    // ── Limiter ─────────────────────────────────────────────
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.01;
    this.limiter.knee.value = 0;

    // ══════════════════════════════════════════════════════════
    // WIRING
    // ══════════════════════════════════════════════════════════

    // Input splits: dry path + reverb send
    this.input.connect(this.dryPath);
    this.input.connect(this.reverbSend);

    // Reverb: send → convolver → duck → return
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.reverbDuck);
    this.reverbDuck.connect(this.reverbReturn);

    // Merge dry + reverb → chorus
    const chorusMerge = ctx.createGain();
    this.dryPath.connect(chorusMerge);
    this.reverbReturn.connect(chorusMerge);

    // Chorus: dry bypass + 2× wet delay
    chorusMerge.connect(this.chorusDry);
    chorusMerge.connect(this.chorusDelay1);
    chorusMerge.connect(this.chorusDelay2);

    this.chorusLfo1.connect(this.chorusLfoGain1);
    this.chorusLfoGain1.connect(this.chorusDelay1.delayTime);
    this.chorusLfo2.connect(this.chorusLfoGain2);
    this.chorusLfoGain2.connect(this.chorusDelay2.delayTime);

    this.chorusDelay1.connect(this.chorusWet);
    this.chorusDelay2.connect(this.chorusWet);

    // Chorus merge → auto-pan
    this.chorusDry.connect(this.panner);
    this.chorusWet.connect(this.panner);

    // Auto-pan LFO
    this.panLfo.connect(this.panLfoGain);
    this.panLfoGain.connect(this.panner.pan);

    // Panner → limiter → output
    this.panner.connect(this.limiter);
    this.limiter.connect(this.output);

    // Start LFOs
    this.chorusLfo1.start();
    this.chorusLfo2.start();
    this.panLfo.start();
  }

  setVolume(value: number): void {
    this.smooth(this.output.gain, value * value);
  }

  // ── Reverb Control ────────────────────────────────────────

  setReverb(send: number, decay: number): void {
    this.smooth(this.reverbSend.gain, send);
    // Regenerate IR when decay changes significantly
    if (Math.abs(decay - this._lastReverbDecay) > 0.1) {
      this._lastReverbDecay = decay;
      const duration = 0.5 + decay * 2.5; // 0.5s – 3.0s
      const rate = 2 + decay * 6; // faster decay rate for shorter times
      this.convolver.buffer = this.generateSpringIR(duration, rate);
    }
  }
  private _lastReverbDecay = 0.4;

  /** Duck reverb return — call on note on/off from engine */
  duckReverb(noteOn: boolean): void {
    const t = this.ctx.currentTime;
    this.reverbDuck.gain.cancelScheduledValues(t);
    if (noteOn) {
      // Duck reverb when note plays
      this.reverbDuck.gain.setTargetAtTime(0.15, t, 0.005);
    } else {
      // Release reverb when note ends (slow bloom)
      this.reverbDuck.gain.setTargetAtTime(1, t, 0.15);
    }
  }

  // ── Chorus Control ────────────────────────────────────────

  setChorus(mix: number, rate: number): void {
    const t = this.ctx.currentTime;
    this.chorusWet.gain.setTargetAtTime(mix * 0.5, t, 0.01);
    this.chorusDry.gain.setTargetAtTime(1 - mix * 0.3, t, 0.01);
    // Rate: 0→0.2Hz (slow), 0.5→1Hz, 1→4Hz (fast vibrato)
    const lfoHz = 0.2 + rate * 3.8;
    this.chorusLfo1.frequency.setTargetAtTime(lfoHz, t, 0.02);
    this.chorusLfo2.frequency.setTargetAtTime(lfoHz * 1.28, t, 0.02);
  }

  // ── Auto-Pan Control ──────────────────────────────────────

  setAutoPan(depth: number): void {
    this.smooth(this.panLfoGain.gain, depth * 0.8);
  }

  // ── Internals ─────────────────────────────────────────────

  destroy(): void {
    this.chorusLfo1.stop();
    this.chorusLfo2.stop();
    this.panLfo.stop();
    [
      this.input, this.output, this.convolver,
      this.reverbSend, this.reverbReturn, this.reverbDuck, this.dryPath,
      this.chorusDry, this.chorusWet, this.chorusDelay1, this.chorusDelay2,
      this.chorusLfo1, this.chorusLfo2, this.chorusLfoGain1, this.chorusLfoGain2,
      this.panner, this.panLfo, this.panLfoGain, this.limiter,
    ].forEach(n => n.disconnect());
  }

  private smooth(param: AudioParam, value: number, tau = 0.012): void {
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setTargetAtTime(value, this.ctx.currentTime, tau);
  }

  /** Generate synthetic spring reverb impulse response */
  private generateSpringIR(duration: number, decayRate: number): AudioBuffer {
    const len = Math.ceil(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    // Comb filter delays for metallic spring character (in samples)
    const combs = [97, 233, 389, 557];
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / this.ctx.sampleRate;
        // White noise with exponential decay
        let sample = (Math.random() * 2 - 1) * Math.exp(-decayRate * t);
        // Add comb reflections (metallic spring character)
        for (const d of combs) {
          if (i > d) sample += data[i - d] * (ch === 0 ? 0.25 : 0.2);
        }
        // Slight pre-delay (springs have mechanical delay)
        const preDelay = ch === 0 ? 0.008 : 0.012;
        data[i] = t < preDelay ? 0 : sample * 0.3;
      }
    }
    return buf;
  }
}
