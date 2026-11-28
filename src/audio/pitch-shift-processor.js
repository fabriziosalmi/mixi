/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

const GRAIN_SIZE = 2048;
const HALF_GRAIN = GRAIN_SIZE / 2;

// Candidates for harmonic sync
const RATIOS = [1, 2, 0.5, 1.5, 0.75, 4 / 3, 3 / 4];
const MAX_ERROR_BPM = 5;

function findBestRatio(masterBpm, slaveBpm) {
  if (masterBpm <= 0 || slaveBpm <= 0) return 1;

  let bestRatio = 1;
  let bestError = Infinity;

  for (const ratio of RATIOS) {
    const targetBpm = masterBpm / ratio;
    const error = Math.abs(slaveBpm - targetBpm);
    if (error < bestError && error < MAX_ERROR_BPM) {
      bestError = error;
      bestRatio = ratio;
    }
  }

  return bestRatio;
}

function virtualBeatPeriod(slaveBpm, ratio) {
  if (slaveBpm <= 0 || ratio <= 0) return 0;
  return (60 / slaveBpm) / ratio;
}

class PitchShiftProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pitchRatio = 1.0;
    this.enabled = false;

    // Circular stereo input buffers
    this.inputBuf = new Float32Array(GRAIN_SIZE * 4);
    this.inputBufR = new Float32Array(GRAIN_SIZE * 4);
    this.inputWrite = 0;

    // Grain output positions & fixed circular-buffer anchors (eliminates 375Hz quantum warble)
    this.grainAPos = 0;
    this.grainBPos = HALF_GRAIN;
    this.grainAStart = 0;
    this.grainBStart = 0;

    // Hann window (precomputed)
    this.window = new Float32Array(GRAIN_SIZE);

    // ── PLL variables ──────────────────────────────────────────
    this.isSynced = false;
    this.baseRate = 1.0;
    this.pllCorrection = 0.0;
    this.integral = 0.0;
    this.lastPhaseDelta = 0.0;

    this.masterBpm = 0.0;
    this.masterOriginalBpm = 0.0;
    this.masterFirstBeatOffset = 0.0;
    this.masterTime = 0.0;

    this.slaveOriginalBpm = 0.0;
    this.slaveFirstBeatOffset = 0.0;
    this.slaveTime = 0.0;

    this.pllTarget = 0.0; // combined grooveOffset + cancelNudge
    this.onsetOffset = 0.0;

    // Control loop state variables
    this.nudge = 0.0;
    this.driftCorrection = 0.0;

    this.loopEnabled = false;
    this.loopStart = 0.0;
    this.loopEnd = 0.0;

    this.isBraking = false;
    this.brakeStartTime = 0.0;
    this.brakeDuration = 0.0;
    this.brakeStartRate = 1.0;

    // Precompute Hann window
    for (let i = 0; i < GRAIN_SIZE; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (GRAIN_SIZE - 1)));
    }

    this.port.onmessage = (e) => {
      if (e.data.type === 'setPitchRatio') {
        this.pitchRatio = e.data.value;
      } else if (e.data.type === 'setEnabled') {
        this.enabled = e.data.value;
        if (!this.enabled) {
          this.pitchRatio = 1.0;
        }
      } else if (e.data.type === 'setBaseRate') {
        this.baseRate = e.data.value;
      } else if (e.data.type === 'setNudge') {
        this.nudge = e.data.value;
      } else if (e.data.type === 'setDriftCorrection') {
        this.driftCorrection = e.data.value;
      } else if (e.data.type === 'setLoop') {
        this.loopEnabled = e.data.enabled;
        this.loopStart = e.data.start;
        this.loopEnd = e.data.end;
      } else if (e.data.type === 'brake') {
        this.brakeStartTime = currentTime;
        this.brakeDuration = e.data.durationMs / 1000;
        this.isBraking = true;
        this.brakeStartRate = this.baseRate * (1 + this.pllCorrection);
      } else if (e.data.type === 'cancelBrake') {
        this.isBraking = false;
      } else if (e.data.type === 'sync') {
        this.isSynced = true;
        this.masterBpm = e.data.masterBpm;
        this.masterOriginalBpm = e.data.masterOriginalBpm;
        this.masterFirstBeatOffset = e.data.masterFirstBeatOffset;
        this.masterTime = e.data.masterTime;
        this.slaveOriginalBpm = e.data.slaveOriginalBpm;
        this.slaveFirstBeatOffset = e.data.slaveFirstBeatOffset;
        this.slaveTime = e.data.slaveTime;
        this.pllTarget = e.data.pllTarget || 0.0;
        this.onsetOffset = e.data.onsetOffset || 0.0;
        this.integral = 0.0;
        this.pllCorrection = 0.0;
      } else if (e.data.type === 'unsync') {
        this.isSynced = false;
        this.integral = 0.0;
        this.pllCorrection = 0.0;
      } else if (e.data.type === 'updatePlayheads') {
        this.masterTime = e.data.masterTime;
        this.slaveTime = e.data.slaveTime;
      } else if (e.data.type === 'updateMasterBpm') {
        this.masterBpm = e.data.value;
      } else if (e.data.type === 'updatePllTarget') {
        this.pllTarget = e.data.value;
      } else if (e.data.type === 'updateOnsetOffset') {
        this.onsetOffset = e.data.value;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    // ── 1. Calculate & write control signal (Output 1) ──────────
    const controlOutput = outputs[1];
    if (controlOutput && controlOutput[0]) {
      const rateOutput = controlOutput[0];
      const frames = rateOutput.length;
      let effectiveRate = this.baseRate;

      if (this.isSynced && !this.isBraking) {
        const dt = frames / sampleRate;

        // Integrate playheads
        const masterRate = this.masterOriginalBpm > 0 ? (this.masterBpm / this.masterOriginalBpm) : 1.0;
        this.masterTime += dt * masterRate;

        const slaveRate = Math.max(
          0.001,
          this.baseRate * (1.0 + this.pllCorrection + this.driftCorrection) + this.nudge,
        );
        this.slaveTime += dt * slaveRate;

        // Wrap slaveTime if looping
        if (this.loopEnabled && this.loopEnd > this.loopStart) {
          if (this.slaveTime >= this.loopEnd) {
            const loopLen = this.loopEnd - this.loopStart;
            this.slaveTime = this.loopStart + ((this.slaveTime - this.loopStart) % loopLen);
          }
        }

        // Calculate phase delta using original (buffer-time) beat periods
        // because masterTime/slaveTime advance in original-track seconds.
        const masterPeriod = this.masterOriginalBpm > 0 ? 60 / this.masterOriginalBpm : 0;
        const slaveBpm = this.slaveOriginalBpm;
        const ratio = findBestRatio(this.masterBpm, this.slaveOriginalBpm);
        const slavePeriod = ratio !== 1
          ? virtualBeatPeriod(slaveBpm, ratio)
          : (slaveBpm > 0 ? 60 / slaveBpm : 0);

        if (masterPeriod > 0 && slavePeriod > 0) {
          const masterFrac = (((this.masterTime - this.masterFirstBeatOffset) / masterPeriod) % 1 + 1) % 1;
          const slaveFrac = (((this.slaveTime - this.slaveFirstBeatOffset) / slavePeriod) % 1 + 1) % 1;

          let phaseDelta = masterFrac - slaveFrac;
          if (phaseDelta > 0.5) phaseDelta -= 1;
          if (phaseDelta < -0.5) phaseDelta += 1;

          // Discontinuity detection (DISCONTINUITY_THRESHOLD = 0.25)
          if (Math.abs(phaseDelta - this.lastPhaseDelta) > 0.25) {
            this.integral = 0;
            this.lastPhaseDelta = phaseDelta;
            this.pllCorrection = 0;
          } else {
            this.lastPhaseDelta = phaseDelta;

            // Error = actual phase delta + onset offset - desired target (pllTarget)
            const error = phaseDelta + this.onsetOffset - this.pllTarget;

            if (Math.abs(error) < 0.003) { // DEADZONE = 0.003
              this.integral *= 0.95;
              this.pllCorrection *= 0.95;
            } else {
              const P = 0.04 * error; // Kp = 0.04
              this.integral += error * dt;
              this.integral = Math.max(-0.05, Math.min(0.05, this.integral)); // INTEGRAL_MAX = 0.05
              const I = 0.002 * this.integral; // Ki = 0.002
              const raw = P + I;
              this.pllCorrection = Math.max(-0.003, Math.min(0.003, raw)); // MAX_CORRECTION = 0.003
            }
          }
        }

        effectiveRate = this.baseRate * (1.0 + this.pllCorrection + this.driftCorrection) + this.nudge;
      } else if (this.isBraking) {
        const elapsed = currentTime - this.brakeStartTime;
        if (elapsed >= this.brakeDuration) {
          this.pllCorrection = 0;
          this.isBraking = false;
          effectiveRate = 0.001;
        } else {
          const t = elapsed / this.brakeDuration;
          effectiveRate = this.brakeStartRate * Math.pow(0.001 / this.brakeStartRate, t);
        }
      } else {
        effectiveRate = this.baseRate + this.nudge;
      }

      effectiveRate = Math.max(0.001, effectiveRate);
      rateOutput.fill(effectiveRate);
    }

    // ── 2. Process audio (Output 0) ─────────────────────────────
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

    // Stereo granular overlap-add with per-grain anchors & ratio-safe lookBack
    const inL = input[0];
    const inR = (input.length > 1 && input[1]) ? input[1] : input[0];
    const frames = inL.length;
    const bufLen = this.inputBuf.length;
    const bufMask = bufLen - 1;
    const lookBack = Math.ceil(GRAIN_SIZE * Math.max(1, this.pitchRatio));
    const outR = output.length > 1 ? output[1] : null;

    for (let i = 0; i < frames; i++) {
      const w = this.inputWrite & bufMask;
      this.inputBuf[w] = inL[i];
      this.inputBufR[w] = inR[i];
      this.inputWrite = (this.inputWrite + 1) & bufMask;

      if (this.grainAPos === 0) {
        this.grainAStart = (this.inputWrite - lookBack + bufLen) & bufMask;
      }
      if (this.grainBPos === 0) {
        this.grainBStart = (this.inputWrite - lookBack + bufLen) & bufMask;
      }

      const aIdx = this.grainAPos;
      const aFrac = aIdx * this.pitchRatio;
      const aInt = Math.floor(aFrac);
      const aT = aFrac - aInt;
      const aI0 = (this.grainAStart + aInt) & bufMask;
      const aI1 = (aI0 + 1) & bufMask;
      const aw = this.window[aIdx];

      const bIdx = this.grainBPos;
      const bFrac = bIdx * this.pitchRatio;
      const bInt = Math.floor(bFrac);
      const bT = bFrac - bInt;
      const bI0 = (this.grainBStart + bInt) & bufMask;
      const bI1 = (bI0 + 1) & bufMask;
      const bw = this.window[bIdx];

      const aL = this.inputBuf[aI0] + (this.inputBuf[aI1] - this.inputBuf[aI0]) * aT;
      const bL = this.inputBuf[bI0] + (this.inputBuf[bI1] - this.inputBuf[bI0]) * bT;
      output[0][i] = aL * aw + bL * bw;

      if (outR) {
        const aR = this.inputBufR[aI0] + (this.inputBufR[aI1] - this.inputBufR[aI0]) * aT;
        const bR = this.inputBufR[bI0] + (this.inputBufR[bI1] - this.inputBufR[bI0]) * bT;
        outR[i] = aR * aw + bR * bw;
      }

      this.grainAPos++;
      this.grainBPos++;

      if (this.grainAPos >= GRAIN_SIZE) {
        this.grainAPos = 0;
      }
      if (this.grainBPos >= GRAIN_SIZE) {
        this.grainBPos = 0;
      }
    }

    return true;
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor);
