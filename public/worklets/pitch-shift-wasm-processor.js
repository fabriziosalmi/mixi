/**
 * Pitch Shift Wasm Processor — AudioWorklet
 *
 * Granular overlap-add pitch shifter running in Rust/Wasm.
 * Uses raw C-style exports (no wasm-bindgen glue needed in worklet).
 *
 * Message protocol (same as JS processor for drop-in replacement):
 *   { type: 'wasm-module', module: WebAssembly.Module }  — init Wasm
 *   { type: 'setPitchRatio', value: number }              — set ratio
 *   { type: 'setEnabled', value: boolean }                — toggle
 *   { type: 'setBaseRate', value: number }
 *   { type: 'setNudge', value: number }
 *   { type: 'setDriftCorrection', value: number }
 *   { type: 'setLoop', enabled: boolean, start: number, end: number }
 *   { type: 'brake', durationMs: number }
 *   { type: 'cancelBrake' }
 *   { type: 'sync', ... }
 *   { type: 'unsync' }
 *   { type: 'updatePlayheads', ... }
 *   { type: 'updateMasterBpm', value: number }
 *   { type: 'updatePllTarget', value: number }
 *   { type: 'updateOnsetOffset', value: number }
 *
 * Falls back to passthrough if Wasm fails to instantiate.
 *
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

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

/**
 * Monotonic millisecond clock that works inside AudioWorkletGlobalScope.
 * `performance` is not guaranteed to exist in the worklet realm (it throws
 * "performance is not defined" in some Chromium/Electron builds), so fall back
 * to the worklet's `currentTime` global (seconds → ms). Note: `currentTime` is
 * fixed within a single render quantum, so intra-process() CPU-duration deltas
 * degrade to ~0 on the fallback — but cross-quantum scheduling detection and,
 * above all, "no crash", are preserved.
 */
const nowMs = () =>
  (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : currentTime * 1000;

/**
 * Resource Acquisition Is Initialization (RAII) wrapper for the raw Wasm pitch shifter pointer.
 * Ensures the pointer is freed via FinalizationRegistry when garbage-collected or explicitly destroyed.
 */
class WasmPitchShifter {
  constructor(exports, pointer) {
    this.exports = exports;
    this.pointer = pointer;
    WasmPitchShifter.registry.register(this, { exports, pointer }, this);
  }

  destroy() {
    if (this.pointer) {
      WasmPitchShifter.registry.unregister(this);
      try {
        this.exports.destroy_pitch_shifter(this.pointer);
      } catch (err) {
        // Suppress errors during manual cleanup
      }
      this.pointer = null;
    }
  }
}

WasmPitchShifter.registry = new FinalizationRegistry(({ exports, pointer }) => {
  try {
    exports.destroy_pitch_shifter(pointer);
  } catch (err) {
    // Suppress errors during garbage collection cleanup
  }
});

class PitchShiftWasmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasmReady = false;
    this._exports = null;
    this._memory = null;
    this._shifterL = null;
    this._shifterR = null;
    this._inPtr = 0;
    this._outPtr = 0;
    this._allocatedFrames = 0;
    this._lastProcessTime = 0;

    // Pitch shifter state
    this.pitchRatio = 1.0;
    this.enabled = false;

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

    this.port.onmessage = (e) => {
      const { type } = e.data;

      if (type === 'wasm-bytes') {
        // Preferred: raw bytes compiled inside the worklet realm. Cloning a
        // WebAssembly.Module across realms via postMessage is unreliable and
        // previously caused silent init failures.
        this._initWasm(e.data.bytes);
      } else if (type === 'wasm-module') {
        this._initWasm(e.data.module); // legacy path
      } else if (type === 'setPitchRatio') {
        this.pitchRatio = e.data.value;
        if (this.wasmReady && this._shifterL && this._shifterR) {
          this._exports.pitch_shifter_set_ratio(this._shifterL.pointer, this.pitchRatio);
          this._exports.pitch_shifter_set_ratio(this._shifterR.pointer, this.pitchRatio);
        }
      } else if (type === 'setEnabled') {
        this.enabled = e.data.value;
        if (!this.enabled) {
          this.pitchRatio = 1.0;
        }
        if (this.wasmReady && this._shifterL && this._shifterR) {
          this._exports.pitch_shifter_set_enabled(this._shifterL.pointer, this.enabled ? 1 : 0);
          this._exports.pitch_shifter_set_enabled(this._shifterR.pointer, this.enabled ? 1 : 0);
          if (!this.enabled) {
            this._exports.pitch_shifter_set_ratio(this._shifterL.pointer, 1.0);
            this._exports.pitch_shifter_set_ratio(this._shifterR.pointer, 1.0);
          }
        }
      } else if (type === 'setBaseRate') {
        this.baseRate = e.data.value;
      } else if (type === 'setNudge') {
        this.nudge = e.data.value;
      } else if (type === 'setDriftCorrection') {
        this.driftCorrection = e.data.value;
      } else if (type === 'setLoop') {
        this.loopEnabled = e.data.enabled;
        this.loopStart = e.data.start;
        this.loopEnd = e.data.end;
      } else if (type === 'brake') {
        this.brakeStartTime = currentTime;
        this.brakeDuration = e.data.durationMs / 1000;
        this.isBraking = true;
        this.brakeStartRate = this.baseRate * (1 + this.pllCorrection);
      } else if (type === 'cancelBrake') {
        this.isBraking = false;
      } else if (type === 'sync') {
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
      } else if (type === 'unsync') {
        this.isSynced = false;
        this.integral = 0.0;
        this.pllCorrection = 0.0;
      } else if (type === 'updatePlayheads') {
        this.masterTime = e.data.masterTime;
        this.slaveTime = e.data.slaveTime;
      } else if (type === 'updateMasterBpm') {
        this.masterBpm = e.data.value;
      } else if (type === 'updatePllTarget') {
        this.pllTarget = e.data.value;
      } else if (type === 'updateOnsetOffset') {
        this.onsetOffset = e.data.value;
      }
    };
  }

  async _initWasm(source) {
    try {
      // `source` may be raw bytes (ArrayBuffer) or a precompiled Module.
      // instantiate(bytes) → {module, instance}; instantiate(module) → instance.
      const result = await WebAssembly.instantiate(source, {
        env: {},
        wasi_snapshot_preview1: {
          proc_exit: () => {},
          fd_write: () => 0,
          fd_seek: () => 0,
          fd_close: () => 0,
        },
      });
      const instance = result.instance || result;
      this._exports = instance.exports;
      this._memory = instance.exports.memory;

      // Allocate Left & Right pitch shifters via handle-based factory pattern
      const ptrL = this._exports.create_pitch_shifter();
      const ptrR = this._exports.create_pitch_shifter();
      if (!ptrL || !ptrR) {
        throw new Error("Failed to allocate pitch shifters in WASM");
      }
      this._shifterL = new WasmPitchShifter(this._exports, ptrL);
      this._shifterR = new WasmPitchShifter(this._exports, ptrR);

      // Configure current states
      this._exports.pitch_shifter_set_ratio(this._shifterL.pointer, this.pitchRatio);
      this._exports.pitch_shifter_set_ratio(this._shifterR.pointer, this.pitchRatio);
      this._exports.pitch_shifter_set_enabled(this._shifterL.pointer, this.enabled ? 1 : 0);
      this._exports.pitch_shifter_set_enabled(this._shifterR.pointer, this.enabled ? 1 : 0);

      // Allocate initial I/O buffers in Wasm memory (128 frames)
      this._allocatedFrames = 128;
      this._inPtr = this._exports.wasm_alloc(128);
      this._outPtr = this._exports.wasm_alloc(128);

      this.wasmReady = true;
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  disconnectedCallback() {
    if (this.wasmReady && this._exports) {
      if (this._shifterL) this._shifterL.destroy();
      if (this._shifterR) this._shifterR.destroy();
      if (this._inPtr) this._exports.wasm_free(this._inPtr, this._allocatedFrames);
      if (this._outPtr) this._exports.wasm_free(this._outPtr, this._allocatedFrames);
    }
  }

  process(inputs, outputs) {
    // NOTE: A wall-clock "scheduling delay" detector used to live here, comparing
    // the time between consecutive process() calls. AudioWorklets render quanta in
    // bursts, so that gap is not a real audio metric — it produced constant false
    // "scheduling_delay" glitch telemetry under normal load. Removed. Genuine
    // overload is still caught by the in-call CPU-duration check below.
    const startCpu = nowMs();
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
        const masterPeriod = 60 / this.masterBpm;
        const slaveBpm = this.slaveOriginalBpm * this.baseRate;
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

    // Passthrough when Wasm not ready or not enabled or ratio is exactly 1.0
    if (!this.wasmReady || !this._exports || !this._memory || !this.enabled || Math.abs(this.pitchRatio - 1.0) < 0.001) {
      for (let ch = 0; ch < output.length; ch++) {
        if (input[ch]) {
          output[ch].set(input[ch]);
        }
      }
      return true;
    }

    const frames = input[0].length;

    // Dynamic buffer allocation/resize if needed
    if (frames > this._allocatedFrames) {
      if (this._inPtr) this._exports.wasm_free(this._inPtr, this._allocatedFrames);
      if (this._outPtr) this._exports.wasm_free(this._outPtr, this._allocatedFrames);

      this._allocatedFrames = frames;
      this._inPtr = this._exports.wasm_alloc(frames);
      this._outPtr = this._exports.wasm_alloc(frames);
    }

    // Process Left Channel
    const wasmIn = new Float32Array(this._memory.buffer, this._inPtr, frames);
    const wasmOut = new Float32Array(this._memory.buffer, this._outPtr, frames);

    wasmIn.set(input[0]);
    this._exports.pitch_shifter_process(this._shifterL.pointer, this._inPtr, this._outPtr, frames);
    output[0].set(wasmOut);

    // Process Right Channel
    if (input[1] && output[1]) {
      wasmIn.set(input[1]);
      this._exports.pitch_shifter_process(this._shifterR.pointer, this._inPtr, this._outPtr, frames);
      output[1].set(wasmOut);
    } else if (output[1]) {
      output[1].set(output[0]);
    }

    const cpuDuration = nowMs() - startCpu;
    if (cpuDuration > 2.0) {
      this.port.postMessage({
        type: 'glitch',
        durationMs: cpuDuration,
        typeDetail: 'cpu_overload',
        frames
      });
    }

    return true;
  }
}

registerProcessor('pitch-shift-wasm-processor', PitchShiftWasmProcessor);
