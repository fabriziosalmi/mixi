/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Granular Pitch Shift AudioWorkletProcessor
//
// Overlap-add grain-based pitch shifter for Key Lock.
// Runs on the audio thread — zero main-thread overhead.
//
// When Key Lock is ON and playbackRate ≠ 1.0, this node
// compensates the pitch change so the musical key stays fixed
// while the tempo (playbackRate) changes.
//
// Algorithm:
//   pitchRatio = 1 / playbackRate
//   grainSize ~ 2048 samples (~46 ms @ 44.1 kHz)
//   Two overlapping grains, Hann-windowed, resampled by pitchRatio
//   Output = overlap-add of resampled grains
// ─────────────────────────────────────────────────────────────

// AudioWorklet global types (not available via lib.dom in main thread TS)
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const GRAIN_SIZE = 2048;
const HALF_GRAIN = GRAIN_SIZE / 2;

class PitchShiftProcessor extends AudioWorkletProcessor {
  private pitchRatio = 1.0;
  private enabled = false;

  // Circular input buffer
  private inputBuf = new Float32Array(GRAIN_SIZE * 4);
  private inputWrite = 0;

  // Grain output positions
  private grainAPos = 0;
  private grainBPos = HALF_GRAIN; // offset by half

  // Hann window (precomputed)
  private window = new Float32Array(GRAIN_SIZE);

  constructor() {
    super();
    // Precompute Hann window
    for (let i = 0; i < GRAIN_SIZE; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (GRAIN_SIZE - 1)));
    }

    this.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'setPitchRatio') {
        this.pitchRatio = e.data.value;
      } else if (e.data.type === 'setEnabled') {
        this.enabled = e.data.value;
        if (!this.enabled) {
          this.pitchRatio = 1.0;
        }
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !output || !output[0]) return true;

    // Passthrough when disabled or ratio ≈ 1.0
    if (!this.enabled || Math.abs(this.pitchRatio - 1.0) < 0.001) {
      for (let ch = 0; ch < output.length; ch++) {
        if (input[ch]) {
          output[ch].set(input[ch]);
        }
      }
      return true;
    }

    // Process mono (channel 0) — stereo gets the same treatment
    const inCh = input[0];
    const frames = inCh.length; // typically 128

    // Write input to circular buffer
    const bufLen = this.inputBuf.length;
    for (let i = 0; i < frames; i++) {
      this.inputBuf[this.inputWrite % bufLen] = inCh[i];
      this.inputWrite++;
    }

    // Generate output by overlap-adding two resampled grains
    for (let i = 0; i < frames; i++) {
      // Read from grain A
      const aIdx = this.grainAPos;
      const aFrac = aIdx * this.pitchRatio;
      const aInt = Math.floor(aFrac);
      const aT = aFrac - aInt;
      const aBase = (this.inputWrite - GRAIN_SIZE + aInt) % bufLen;
      const s0 = this.inputBuf[(aBase + bufLen) % bufLen];
      const s1 = this.inputBuf[(aBase + 1 + bufLen) % bufLen];
      const aSample = s0 + (s1 - s0) * aT;
      const aWin = this.window[aIdx];

      // Read from grain B
      const bIdx = this.grainBPos;
      const bFrac = bIdx * this.pitchRatio;
      const bInt = Math.floor(bFrac);
      const bT = bFrac - bInt;
      const bBase = (this.inputWrite - GRAIN_SIZE + bInt - HALF_GRAIN) % bufLen;
      const t0 = this.inputBuf[(bBase + bufLen) % bufLen];
      const t1 = this.inputBuf[(bBase + 1 + bufLen) % bufLen];
      const bSample = t0 + (t1 - t0) * bT;
      const bWin = this.window[bIdx];

      // Overlap-add
      const sample = aSample * aWin + bSample * bWin;

      // Write to all output channels
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = sample;
      }

      // Advance grain positions
      this.grainAPos++;
      this.grainBPos++;

      // Reset grains when they complete
      if (this.grainAPos >= GRAIN_SIZE) {
        this.grainAPos = 0;
      }
      if (this.grainBPos >= GRAIN_SIZE) {
        this.grainBPos = 0;
      }
    }

    // Copy mono output to other channels if stereo input exists
    if (input.length > 1 && input[1]) {
      const outR = output[1];
      if (outR) {
        outR.set(output[0]);
      }
    }

    return true;
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor);
