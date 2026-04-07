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
 *
 * Falls back to passthrough if Wasm fails to instantiate.
 *
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

class PitchShiftWasmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasmReady = false;
    this._exports = null;
    this._memory = null;
    this._inPtr = 0;
    this._outPtr = 0;

    this.port.onmessage = (e) => {
      const { type } = e.data;

      if (type === 'wasm-module') {
        this._initWasm(e.data.module);
      } else if (type === 'setPitchRatio') {
        if (this.wasmReady) {
          this._exports.pitch_shifter_set_ratio(e.data.value);
        }
      } else if (type === 'setEnabled') {
        if (this.wasmReady) {
          this._exports.pitch_shifter_set_enabled(e.data.value ? 1 : 0);
        }
      }
    };
  }

  async _initWasm(module) {
    try {
      const instance = await WebAssembly.instantiate(module, {
        env: {},
        wasi_snapshot_preview1: {
          // Stub WASI imports if needed
          proc_exit: () => {},
          fd_write: () => 0,
          fd_seek: () => 0,
          fd_close: () => 0,
        },
      });
      this._exports = instance.exports;
      this._memory = instance.exports.memory;

      // Initialize pitch shifters (L + R)
      this._exports.pitch_shifter_init();

      // Allocate I/O buffers in Wasm memory (128 frames each)
      this._inPtr = this._exports.pitch_shifter_alloc(128);
      this._outPtr = this._exports.pitch_shifter_alloc(128);

      this.wasmReady = true;
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !output || !output[0]) return true;

    // Passthrough when Wasm not ready
    if (!this.wasmReady || !this._exports || !this._memory) {
      output[0].set(input[0]);
      if (output[1]) output[1].set(input[1] || input[0]);
      return true;
    }

    const frames = input[0].length;

    // Process left channel
    const wasmIn = new Float32Array(this._memory.buffer, this._inPtr, frames);
    const wasmOut = new Float32Array(this._memory.buffer, this._outPtr, frames);

    wasmIn.set(input[0]);
    this._exports.pitch_shifter_process_l(this._inPtr, this._outPtr, frames);
    output[0].set(wasmOut);

    // Process right channel (if stereo input)
    if (input[1] && output[1]) {
      wasmIn.set(input[1]);
      this._exports.pitch_shifter_process_r(this._inPtr, this._outPtr, frames);
      output[1].set(wasmOut);
    } else if (output[1]) {
      // Mono to stereo: copy L to R
      output[1].set(output[0]);
    }

    return true;
  }
}

registerProcessor('pitch-shift-wasm-processor', PitchShiftWasmProcessor);
