/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – TurboKick Real-Time Synthesizer
//
// Generates kick drums on-the-fly using WebAudio nodes.
// Parameters are tweakable in real time:
//
//   Pitch  (0–1)  →  30–100 Hz fundamental
//   Decay  (0–1)  →  50–600 ms amplitude envelope
//   Click  (0–1)  →  transient noise burst amount
//   Drive  (0–1)  →  waveshaper distortion pre-output
//
// Each trigger creates a short-lived node graph that
// self-destructs after playback.
// ─────────────────────────────────────────────────────────────

import type { SynthParamId } from './types';

export class KickSynth {
  private _params: Record<SynthParamId, number> = {
    pitch: 0.35,
    decay: 0.5,
    click: 0.3,
    drive: 0,
  };

  constructor(private readonly ctx: AudioContext) {}

  // ── Parameters ────────────────────────────────────────────

  get params(): Record<SynthParamId, number> { return { ...this._params }; }

  setParam(id: SynthParamId, value: number): void {
    this._params[id] = Math.max(0, Math.min(1, value));
  }

  /** THUMP macro: 0 = short clicky psy-kick, 1 = deep boomy industrial sub.
   *  Maps a single value to pitch + decay + click simultaneously. */
  setThump(v: number): void {
    const t = Math.max(0, Math.min(1, v));
    // Pitch: 0→high (0.7), 1→low (0.15) — inverted, deeper = lower
    this._params.pitch = 0.7 - t * 0.55;
    // Decay: 0→short (0.15), 1→long (0.85) — more boom
    this._params.decay = 0.15 + t * 0.7;
    // Click: 0→lots of click (0.7), 1→less click (0.1) — deep kicks are smoother
    this._params.click = 0.7 - t * 0.6;
  }

  // ── Trigger ───────────────────────────────────────────────

  /** Fire a kick at the given time, connecting output to `dest`. */
  trigger(dest: AudioNode, time: number, velocity = 1.0): void {
    const { pitch, decay, click, drive } = this._params;

    // Map params to physical values
    const baseFreq = 30 + pitch * 70;             // 30–100 Hz
    const pitchSweep = baseFreq + 150;              // sweep start
    const decaySec = 0.05 + decay * 0.55;           // 50–600 ms
    const pitchDecay = 0.015 + decay * 0.03;        // pitch env speed
    const clickAmt = click;
    const driveAmt = drive;

    // ── Body oscillator ───────────────────────────────────
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitchSweep, time);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, time + pitchDecay);

    // Body amplitude envelope
    const bodyGain = this.ctx.createGain();
    bodyGain.gain.setValueAtTime(velocity * 0.9, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + decaySec);

    osc.connect(bodyGain);

    // ── Click transient (noise burst) ─────────────────────
    let clickNodes: AudioNode[] = [];
    if (clickAmt > 0.01) {
      const clickLen = 0.012;
      const noiseBuf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * clickLen), this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1);
      }
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;

      const clickGain = this.ctx.createGain();
      clickGain.gain.setValueAtTime(clickAmt * velocity, time);
      clickGain.gain.exponentialRampToValueAtTime(0.001, time + clickLen);

      // Highpass to keep click snappy
      const clickFilter = this.ctx.createBiquadFilter();
      clickFilter.type = 'highpass';
      clickFilter.frequency.value = 800;

      noiseSrc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(dest);

      noiseSrc.start(time);
      noiseSrc.stop(time + clickLen + 0.01);
      clickNodes = [noiseSrc, clickFilter, clickGain];
    }

    // ── Drive (optional waveshaper) ───────────────────────
    let finalNode: AudioNode = bodyGain;
    let shaperNode: WaveShaperNode | null = null;

    if (driveAmt > 0.01) {
      shaperNode = this.ctx.createWaveShaper();
      const driveVal = 1 + driveAmt * 12;
      const n = 4096;
      const curve = new Float32Array(new ArrayBuffer(n * 4));
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * driveVal) / Math.tanh(driveVal);
      }
      shaperNode.curve = curve;
      shaperNode.oversample = '2x';

      // Post-drive gain to compensate volume
      const postGain = this.ctx.createGain();
      postGain.gain.value = 1 / (1 + driveAmt * 0.5);

      bodyGain.connect(shaperNode);
      shaperNode.connect(postGain);
      postGain.connect(dest);
      finalNode = postGain;
    } else {
      bodyGain.connect(dest);
    }

    // ── Schedule cleanup ──────────────────────────────────
    const stopTime = time + decaySec + 0.05;
    osc.start(time);
    osc.stop(stopTime);

    osc.onended = () => {
      try { osc.disconnect(); } catch { /* ok */ }
      try { bodyGain.disconnect(); } catch { /* ok */ }
      if (shaperNode) try { shaperNode.disconnect(); } catch { /* ok */ }
      if (finalNode !== bodyGain) try { finalNode.disconnect(); } catch { /* ok */ }
      for (const n of clickNodes) try { n.disconnect(); } catch { /* ok */ }
    };
  }
}
