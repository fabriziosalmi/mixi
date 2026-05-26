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

declare const sampleRate: number;
declare const currentTime: number;

const GRAIN_SIZE = 2048;
const HALF_GRAIN = GRAIN_SIZE / 2;

// Candidates for harmonic sync
const RATIOS = [1, 2, 0.5, 1.5, 0.75, 4 / 3, 3 / 4] as const;
const MAX_ERROR_BPM = 5;

function findBestRatio(masterBpm: number, slaveBpm: number): number {
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

function virtualBeatPeriod(slaveBpm: number, ratio: number): number {
  if (slaveBpm <= 0 || ratio <= 0) return 0;
  return (60 / slaveBpm) / ratio;
}

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

  // ── PLL variables ──────────────────────────────────────────
  private isSynced = false;
  private baseRate = 1.0;
  private pllCorrection = 0.0;
  private integral = 0.0;
  private lastPhaseDelta = 0.0;

  private masterBpm = 0.0;
  private masterOriginalBpm = 0.0;
  private masterFirstBeatOffset = 0.0;
  private masterTime = 0.0;

  private slaveOriginalBpm = 0.0;
  private slaveFirstBeatOffset = 0.0;
  private slaveTime = 0.0;

  private pllTarget = 0.0; // combined grooveOffset + cancelNudge
  private onsetOffset = 0.0;

  // Control loop state variables
  private nudge = 0.0;
  private driftCorrection = 0.0;

  private loopEnabled = false;
  private loopStart = 0.0;
  private loopEnd = 0.0;

  private isBraking = false;
  private brakeStartTime = 0.0;
  private brakeDuration = 0.0;
  private brakeStartRate = 1.0;
  private lastProcessTime = 0.0;

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

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const now = performance.now();
    if (this.lastProcessTime > 0) {
      const schedulingDelta = now - this.lastProcessTime;
      if (schedulingDelta > 4.5) {
        this.port.postMessage({
          type: 'glitch',
          durationMs: schedulingDelta,
          typeDetail: 'scheduling_delay',
          frames: inputs[0] && inputs[0][0] ? inputs[0][0].length : 128
        });
      }
    }
    this.lastProcessTime = now;

    const startCpu = performance.now();
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

        const slaveRate = this.baseRate * (1.0 + this.pllCorrection);
        this.slaveTime += dt * slaveRate;

        // Wrap slaveTime if looping
        if (this.loopEnabled && this.loopEnd > this.loopStart) {
          if (this.slaveTime >= this.loopEnd) {
            const loopLen = this.loopEnd - this.loopStart;
            this.slaveTime = this.loopStart + ((this.slaveTime - this.loopStart) % loopLen);
          }
        }

        // Calculate phase delta
        const masterPeriod = 60 / this.masterOriginalBpm;
        const slaveBpm = this.slaveOriginalBpm;
        const ratio = findBestRatio(this.masterBpm, this.slaveOriginalBpm);
        const slavePeriod = ratio !== 1
          ? virtualBeatPeriod(slaveBpm, ratio)
          : 60 / slaveBpm;

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

    // Process mono (channel 0)
    const inCh = input[0];
    const frames = inCh.length;
    const bufLen = this.inputBuf.length;

    // Write input to circular buffer
    for (let i = 0; i < frames; i++) {
      this.inputBuf[this.inputWrite % bufLen] = inCh[i];
      this.inputWrite++;
    }

    // Generate output by overlap-adding two resampled grains
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

      if (this.grainAPos >= GRAIN_SIZE) {
        this.grainAPos = 0;
      }
      if (this.grainBPos >= GRAIN_SIZE) {
        this.grainBPos = 0;
      }
    }

    if (input.length > 1 && input[1]) {
      const outR = output[1];
      if (outR) {
        outR.set(output[0]);
      }
    }

    const cpuDuration = performance.now() - startCpu;
    if (cpuDuration > 2.0) {
      this.port.postMessage({
        type: 'glitch',
        durationMs: cpuDuration,
        typeDetail: 'cpu_overload',
        frames: input[0] ? input[0].length : 128
      });
    }

    return true;
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor);
