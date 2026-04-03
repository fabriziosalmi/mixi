/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Master Bus
//
// Signal path:
//
//   Deck A/B ─► Master Gain ─► Master Filter (bipolar HPF/LPF)
//                                    │
//                               ┌────┴────┐
//                               │ Dist    │  Band-split distortion
//                               │ LP→mono │  (bass protected)
//                               │ HP→WS   │
//                               └────┬────┘
//                                    │
//                               distMerge ─► Punch Compressor ─► Limiter ─► Analyser ─► (output)
//
// Master Filter: bipolar knob -1..+1
//   -1 = full LPF (cuts highs), 0 = bypass, +1 = full HPF (cuts bass)
//   Frequency sweeps exponentially: 20Hz–20kHz
//
// Punch Compressor: parallel compression 0..1
//   Dry signal + heavily compressed signal mixed together
//   Adds weight and impact without killing transients
// ─────────────────────────────────────────────────────────────

import { smoothParam } from '../utils/paramSmooth';

const DIST_CROSSOVER = 300;

function makeDistortionCurve(amount: number, samples = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  const drive = amount * amount;
  const k = drive * 80 + 1;
  const norm = Math.tanh(k);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * Map filter knob (-1..+1) to frequency (Hz).
 * Exponential sweep: 20 Hz – 20 kHz.
 * At 0 the filter is bypassed (handled by gain crossfade).
 */
function filterFreq(knob: number): number {
  const absK = Math.abs(knob);
  // Exponential: at absK=0 → 20kHz (bypass), at absK=1 → 20 Hz (max filter).
  return 20 * Math.pow(1000, 1 - absK);
}

export class MasterBus {
  readonly gainNode: GainNode;
  /** −0.3 dB headroom pad before the limiter to prevent inter-sample clipping. */
  readonly headroomGain: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly analyser: AnalyserNode;

  // Master Filter (bipolar HPF/LPF)
  private readonly filterLP: BiquadFilterNode;
  private readonly filterHP: BiquadFilterNode;
  private readonly filterBypassGain: GainNode;
  private readonly filterLPGain: GainNode;
  private readonly filterHPGain: GainNode;
  private readonly filterMerge: GainNode;

  // Band-split distortion
  private readonly distLP: BiquadFilterNode;
  private readonly distHP: BiquadFilterNode;
  private readonly bassSplitter: ChannelSplitterNode;
  private readonly bassMonoGain: GainNode;
  private readonly bassMonoMerger: ChannelMergerNode;
  readonly distortion: WaveShaperNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly distMerge: GainNode;

  // Punch compressor (parallel compression)
  private readonly punchComp: DynamicsCompressorNode;
  private readonly punchDry: GainNode;
  private readonly punchWet: GainNode;
  private readonly punchMerge: GainNode;

  // Stereo analysis
  readonly splitter: ChannelSplitterNode;
  readonly analyserL: AnalyserNode;
  readonly analyserR: AnalyserNode;

  // Edge-case #13: Fixed subsonic HPF to remove DC offset
  private readonly dcBlocker: BiquadFilterNode;

  get input(): GainNode { return this.gainNode; }
  get output(): AnalyserNode { return this.analyser; }

  constructor(ctx: AudioContext) {
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 1;

    // ── Master Filter ────────────────────────────────────────
    this.filterLP = ctx.createBiquadFilter();
    this.filterLP.type = 'lowpass';
    this.filterLP.frequency.value = 20000;
    this.filterLP.Q.value = 0.707;

    this.filterHP = ctx.createBiquadFilter();
    this.filterHP.type = 'highpass';
    this.filterHP.frequency.value = 20;
    this.filterHP.Q.value = 0.707;

    this.filterBypassGain = ctx.createGain();
    this.filterBypassGain.gain.value = 1; // bypass by default
    this.filterLPGain = ctx.createGain();
    this.filterLPGain.gain.value = 0;
    this.filterHPGain = ctx.createGain();
    this.filterHPGain.gain.value = 0;
    this.filterMerge = ctx.createGain();
    this.filterMerge.gain.value = 1;

    // ── Distortion (band-split) ──────────────────────────────
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;

    this.distLP = ctx.createBiquadFilter();
    this.distLP.type = 'lowpass';
    this.distLP.frequency.value = DIST_CROSSOVER;
    this.distLP.Q.value = 0.707;

    this.distHP = ctx.createBiquadFilter();
    this.distHP.type = 'highpass';
    this.distHP.frequency.value = DIST_CROSSOVER;
    this.distHP.Q.value = 0.707;

    this.bassSplitter = ctx.createChannelSplitter(2);
    this.bassMonoGain = ctx.createGain();
    this.bassMonoGain.gain.value = 0;
    this.bassMonoMerger = ctx.createChannelMerger(2);

    this.distortion = ctx.createWaveShaper();
    this.distortion.curve = makeDistortionCurve(0);
    this.distortion.oversample = '4x';

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0;

    this.distMerge = ctx.createGain();
    this.distMerge.gain.value = 1;

    // ── Punch Compressor (parallel) ──────────────────────────
    // #41: Moderate ratio + higher threshold to avoid cross-deck
    // pumping. Web Audio DynamicsCompressorNode has no sidechain,
    // so we keep the compressor gentle and rely on the limiter
    // as the brick-wall safety net.
    this.punchComp = ctx.createDynamicsCompressor();
    this.punchComp.threshold.value = -14;
    this.punchComp.ratio.value = 3;
    this.punchComp.attack.value = 0.003;
    this.punchComp.release.value = 0.12;
    this.punchComp.knee.value = 10;

    this.punchDry = ctx.createGain();
    this.punchDry.gain.value = 1;
    this.punchWet = ctx.createGain();
    this.punchWet.gain.value = 0;
    this.punchMerge = ctx.createGain();
    this.punchMerge.gain.value = 1;

    // ── Headroom pad (−0.3 dB before the limiter) ────────────
    // DAC reconstruction can produce inter-sample peaks above
    // 0 dBFS that the DynamicsCompressorNode doesn't catch.
    // A fixed −0.3 dB pad leaves breathing room.
    this.headroomGain = ctx.createGain();
    this.headroomGain.gain.value = 0.966; // 10^(-0.3/20) ≈ 0.966

    // ── Limiter ──────────────────────────────────────────────
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -0.5;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;
    this.limiter.knee.value = 0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    this.splitter = ctx.createChannelSplitter(2);
    this.analyserL = ctx.createAnalyser();
    this.analyserL.fftSize = 512;
    this.analyserL.smoothingTimeConstant = 0.4;
    this.analyserR = ctx.createAnalyser();
    this.analyserR.fftSize = 512;
    this.analyserR.smoothingTimeConstant = 0.4;

    // Edge-case #13: DC Offset blocker — fixed 10 Hz HPF, 12 dB/oct.
    // Removes subsonic garbage and protects subwoofers from DC pops
    // when filters with high Q are abruptly cut.
    this.dcBlocker = ctx.createBiquadFilter();
    this.dcBlocker.type = 'highpass';
    this.dcBlocker.frequency.value = 10;
    this.dcBlocker.Q.value = 0.707;  // Butterworth (no resonance)

    // ── Wiring ───────────────────────────────────────────────

    // 1. Gain → Filter paths (3 parallel: bypass, LP, HP)
    this.gainNode.connect(this.filterBypassGain);
    this.gainNode.connect(this.filterLP);
    this.gainNode.connect(this.filterHP);
    this.filterLP.connect(this.filterLPGain);
    this.filterHP.connect(this.filterHPGain);
    this.filterBypassGain.connect(this.filterMerge);
    this.filterLPGain.connect(this.filterMerge);
    this.filterHPGain.connect(this.filterMerge);

    // 2. FilterMerge → Distortion paths
    // Dry bypass
    this.filterMerge.connect(this.dryGain);
    this.dryGain.connect(this.distMerge);

    // Bass protect: FilterMerge → distLP → split → mono → merger → distMerge
    this.filterMerge.connect(this.distLP);
    this.distLP.connect(this.bassSplitter);
    this.bassSplitter.connect(this.bassMonoGain, 0);
    this.bassSplitter.connect(this.bassMonoGain, 1);
    this.bassMonoGain.connect(this.bassMonoMerger, 0, 0);
    this.bassMonoGain.connect(this.bassMonoMerger, 0, 1);
    this.bassMonoMerger.connect(this.distMerge);

    // Distortion: FilterMerge → distHP → WaveShaper → Wet → distMerge
    this.filterMerge.connect(this.distHP);
    this.distHP.connect(this.distortion);
    this.distortion.connect(this.wetGain);
    this.wetGain.connect(this.distMerge);

    // 3. distMerge → Punch paths (parallel compression)
    this.distMerge.connect(this.punchDry);
    this.distMerge.connect(this.punchComp);
    this.punchComp.connect(this.punchWet);
    this.punchDry.connect(this.punchMerge);
    this.punchWet.connect(this.punchMerge);

    // 4. Punch → DC blocker → Headroom pad → Limiter → Analyser (output)
    this.punchMerge.connect(this.dcBlocker);
    this.dcBlocker.connect(this.headroomGain);
    this.headroomGain.connect(this.limiter);
    this.limiter.connect(this.analyser);

    // 5. Analyser → Splitter → L/R
    this.analyser.connect(this.splitter);
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
  }

  setVolume(value: number, ctx: AudioContext): void {
    smoothParam(this.gainNode.gain, value, ctx);
  }

  /**
   * Master Filter: bipolar knob -1..+1.
   * -1 = full LPF, 0 = bypass, +1 = full HPF.
   * Crossfades between bypass/LP/HP gains.
   */
  setFilter(knob: number, ctx: AudioContext): void {
    const absK = Math.abs(knob);

    if (absK < 0.01) {
      // Bypass
      smoothParam(this.filterBypassGain.gain, 1, ctx);
      smoothParam(this.filterLPGain.gain, 0, ctx);
      smoothParam(this.filterHPGain.gain, 0, ctx);
    } else if (knob < 0) {
      // LPF active
      smoothParam(this.filterBypassGain.gain, 0, ctx);
      smoothParam(this.filterLPGain.gain, 1, ctx);
      smoothParam(this.filterHPGain.gain, 0, ctx);
      const freq = filterFreq(knob);
      smoothParam(this.filterLP.frequency, Math.min(20000, freq), ctx);
    } else {
      // HPF active
      smoothParam(this.filterBypassGain.gain, 0, ctx);
      smoothParam(this.filterLPGain.gain, 0, ctx);
      smoothParam(this.filterHPGain.gain, 1, ctx);
      const freq = filterFreq(knob);
      smoothParam(this.filterHP.frequency, Math.max(20, freq), ctx);
    }
  }

  private _lastDistAmount = -1;

  setDistortion(amount: number, ctx: AudioContext): void {
    smoothParam(this.dryGain.gain, 1 - amount, ctx);
    smoothParam(this.wetGain.gain, amount, ctx);
    smoothParam(this.bassMonoGain.gain, amount * 0.5, ctx);

    // Toggle oversampling: '4x' when active, 'none' when off.
    // Saves CPU by avoiding 4x upsampling on a silent wet path.
    this.distortion.oversample = amount > 0.001 ? '4x' : 'none';

    // Only regenerate the waveshaper curve when the amount changes
    // by a meaningful delta — avoids 2048-sample Float32Array alloc
    // + Math.tanh per frame during knob drags.
    if (amount > 0.001 && Math.abs(amount - this._lastDistAmount) > 0.01) {
      this._lastDistAmount = amount;
      this.distortion.curve = makeDistortionCurve(amount);
    }
  }

  /**
   * Punch compressor: parallel compression 0..1.
   * 0 = pure dry. 1 = 50/50 dry+compressed.
   * Never fully replaces dry — always additive.
   */
  setPunch(amount: number, ctx: AudioContext): void {
    // Dry stays at 1, wet blends in proportionally
    smoothParam(this.punchDry.gain, 1, ctx);
    smoothParam(this.punchWet.gain, amount * 0.5, ctx);
  }

  destroy(): void {
    this.gainNode.disconnect();
    this.filterLP.disconnect();
    this.filterHP.disconnect();
    this.filterBypassGain.disconnect();
    this.filterLPGain.disconnect();
    this.filterHPGain.disconnect();
    this.filterMerge.disconnect();
    this.dryGain.disconnect();
    this.distLP.disconnect();
    this.distHP.disconnect();
    this.bassSplitter.disconnect();
    this.bassMonoGain.disconnect();
    this.bassMonoMerger.disconnect();
    this.distortion.disconnect();
    this.wetGain.disconnect();
    this.distMerge.disconnect();
    this.punchComp.disconnect();
    this.punchDry.disconnect();
    this.punchWet.disconnect();
    this.punchMerge.disconnect();
    this.dcBlocker.disconnect();
    this.headroomGain.disconnect();
    this.limiter.disconnect();
    this.analyser.disconnect();
    this.splitter.disconnect();
    this.analyserL.disconnect();
    this.analyserR.disconnect();
  }
}
