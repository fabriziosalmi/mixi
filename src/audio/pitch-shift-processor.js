/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// Granular Pitch Shift AudioWorkletProcessor
// Overlap-add grain-based pitch shifter for Key Lock.

const GRAIN_SIZE = 2048;
const HALF_GRAIN = GRAIN_SIZE / 2;

class PitchShiftProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pitchRatio = 1.0;
    this.enabled = false;
    this.inputBuf = new Float32Array(GRAIN_SIZE * 4);
    this.inputWrite = 0;
    this.grainAPos = 0;
    this.grainBPos = HALF_GRAIN;
    this.window = new Float32Array(GRAIN_SIZE);

    for (let i = 0; i < GRAIN_SIZE; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (GRAIN_SIZE - 1)));
    }

    this.port.onmessage = (e) => {
      if (e.data.type === 'setPitchRatio') {
        this.pitchRatio = e.data.value;
      } else if (e.data.type === 'setEnabled') {
        this.enabled = e.data.value;
        if (!this.enabled) this.pitchRatio = 1.0;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    if (!this.enabled || Math.abs(this.pitchRatio - 1.0) < 0.001) {
      for (let ch = 0; ch < output.length; ch++) {
        if (input[ch]) output[ch].set(input[ch]);
      }
      return true;
    }

    const inCh = input[0];
    const frames = inCh.length;
    const bufLen = this.inputBuf.length;

    for (let i = 0; i < frames; i++) {
      this.inputBuf[this.inputWrite % bufLen] = inCh[i];
      this.inputWrite++;
    }

    for (let i = 0; i < frames; i++) {
      const aIdx = this.grainAPos;
      const aFrac = aIdx * this.pitchRatio;
      const aInt = Math.floor(aFrac);
      const aT = aFrac - aInt;
      const aBase = (this.inputWrite - GRAIN_SIZE + aInt) % bufLen;
      const s0 = this.inputBuf[(aBase + bufLen) % bufLen];
      const s1 = this.inputBuf[(aBase + 1 + bufLen) % bufLen];
      const aSample = s0 + (s1 - s0) * aT;
      const aWin = this.window[aIdx];

      const bIdx = this.grainBPos;
      const bFrac = bIdx * this.pitchRatio;
      const bInt = Math.floor(bFrac);
      const bT = bFrac - bInt;
      const bBase = (this.inputWrite - GRAIN_SIZE + bInt - HALF_GRAIN) % bufLen;
      const t0 = this.inputBuf[(bBase + bufLen) % bufLen];
      const t1 = this.inputBuf[(bBase + 1 + bufLen) % bufLen];
      const bSample = t0 + (t1 - t0) * bT;
      const bWin = this.window[bIdx];

      const sample = aSample * aWin + bSample * bWin;
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = sample;
      }

      this.grainAPos++;
      this.grainBPos++;
      if (this.grainAPos >= GRAIN_SIZE) this.grainAPos = 0;
      if (this.grainBPos >= GRAIN_SIZE) this.grainBPos = 0;
    }

    if (input.length > 1 && input[1] && output[1]) {
      output[1].set(output[0]);
    }
    return true;
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor);
