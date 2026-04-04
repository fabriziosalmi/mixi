/**
 * Mixi DSP AudioWorklet Processor
 *
 * Runs the Rust/Wasm DSP engine in the audio thread.
 * Two inputs: input[0] = Deck A, input[1] = Deck B.
 * One stereo output: mixed master.
 *
 * Uses processRaw() — direct Wasm memory access via byte offsets.
 * No wasm-bindgen heap object machinery needed.
 *
 * SharedArrayBuffers:
 *   - paramBus: DSP parameters (512 bytes, written by main thread)
 *   - meteringBus: VU output (28 bytes, read by main thread)
 */

class MixiDspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasmReady = false;
    this.paramView = null;     // Uint8Array on SharedArrayBuffer
    this.meteringView = null;  // Float32Array on SharedArrayBuffer

    // Wasm state (set after module instantiation)
    this._exports = null;      // Wasm instance exports
    this._enginePtr = 0;       // Pointer to DspEngine in Wasm memory
    this._memory = null;       // Wasm linear memory (ArrayBuffer)

    // Pre-allocated buffer offsets in Wasm linear memory
    this._inL = 0;    // 128 × f32 = 512 bytes
    this._inR = 0;
    this._outL = 0;
    this._outR = 0;
    this._params = 0; // 512 bytes

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  async _handleMessage(data) {
    if (data.type === 'init') {
      if (data.paramBus) {
        this.paramView = new Uint8Array(data.paramBus);
      }
      if (data.meteringBus) {
        this.meteringView = new Float32Array(data.meteringBus);
      }
    }

    if (data.type === 'wasm-module') {
      try {
        const { module } = data;

        // Minimal import object — processRaw uses direct memory, no wasm-bindgen glue
        const self = this;
        const importObject = {
          wbg: {
            // H4 fix: Extract actual panic message from Wasm memory
            __wbindgen_throw: (ptr, len) => {
              try {
                const bytes = new Uint8Array(self._memory.buffer, ptr, len);
                const message = new TextDecoder().decode(bytes);
                console.error('[mixi-dsp] Wasm panic:', message);
                self.port.postMessage({ type: 'error', message: 'Wasm panic: ' + message });
              } catch {
                console.error('[mixi-dsp] Wasm panic (could not read message)');
              }
            },
          },
        };

        const instance = await WebAssembly.instantiate(module, importObject);
        this._exports = instance.exports;
        this._memory = instance.exports.memory;

        // M4 fix: Create DspEngine — explicit error if export not found
        const engineNew = this._exports.dspengine_new || this._exports.__wbg_dspengine_new;
        if (!engineNew) {
          this.port.postMessage({ type: 'error', message: 'dspengine_new export not found — wasm-bindgen ABI mismatch. Available: ' + Object.keys(this._exports).join(', ') });
          return;
        }
        this._enginePtr = engineNew(sampleRate);

        // H5 fix: Allocate buffers — explicit error if malloc not found
        const malloc = this._exports.__wbindgen_export_0 || this._exports.__wbindgen_malloc || this._exports.wasm_malloc;
        if (!malloc) {
          this.port.postMessage({ type: 'error', message: 'Wasm malloc export not found — wasm-bindgen version mismatch? Available: ' + Object.keys(this._exports).filter(k => k.includes('export') || k.includes('malloc')).join(', ') });
          return;
        }

        if (this._enginePtr) {
          // 4 audio buffers × 128 samples × 4 bytes = 2048 bytes
          // 1 param buffer × 512 bytes
          this._inL = malloc(512, 4);    // 128 f32
          this._inR = malloc(512, 4);
          this._outL = malloc(512, 4);
          this._outR = malloc(512, 4);
          this._params = malloc(512, 1); // 512 u8

          this.wasmReady = true;
          this.port.postMessage({ type: 'ready' });
        } else {
          this.port.postMessage({ type: 'error', message: 'Missing malloc or engine constructor' });
        }
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err) });
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const outputL = output[0];
    const outputR = output[1] || output[0];
    const len = outputL.length; // typically 128

    // Get deck inputs (2-input worklet)
    const deckA = inputs[0];
    const deckB = inputs[1];
    const inAL = deckA && deckA[0] ? deckA[0] : null;
    const inBL = deckB && deckB[0] ? deckB[0] : null;

    // ── Wasm DSP Processing ─────────────────────────────────
    if (this.wasmReady && this._exports && this._enginePtr) {
      const mem = new Float32Array(this._memory.buffer);
      const memU8 = new Uint8Array(this._memory.buffer);

      // Copy deck inputs into Wasm memory
      const inLOff = this._inL / 4; // byte offset → f32 index
      const inROff = this._inR / 4;
      const outLOff = this._outL / 4;
      const outROff = this._outR / 4;

      // Deck A → inL, Deck B → inR
      if (inAL) {
        mem.set(inAL, inLOff);
      } else {
        mem.fill(0, inLOff, inLOff + len);
      }
      if (inBL) {
        mem.set(inBL, inROff);
      } else {
        mem.fill(0, inROff, inROff + len);
      }

      // Copy param bus from SharedArrayBuffer into Wasm memory
      if (this.paramView) {
        memU8.set(this.paramView, this._params);
      }

      // Call Rust DSP engine via raw memory offsets
      // M7 fix: cache export lookup once, log if missing
      if (!this._processRaw) {
        this._processRaw = this._exports.processRaw || this._exports.dspengine_processRaw;
        if (!this._processRaw) {
          console.error('[mixi-dsp] processRaw export not found — Wasm DSP disabled');
          this.wasmReady = false;
          return true;
        }
      }
      this._processRaw(this._enginePtr,
        this._inL, this._inR, this._outL, this._outR,
        this._params, len);

      // Copy processed output from Wasm memory to JS output buffers
      outputL.set(mem.subarray(outLOff, outLOff + len));
      outputR.set(mem.subarray(outROff, outROff + len));

    } else {
      // ── Passthrough mode (Wasm not ready) ───────────────────
      // Mix both deck inputs to output (simple sum)
      if (inAL) outputL.set(inAL); else outputL.fill(0);
      if (inBL) {
        for (let i = 0; i < len; i++) outputL[i] += inBL[i];
      }
      // Mono → stereo copy
      outputR.set(outputL);
    }

    // ── Metering (always, regardless of Wasm state) ──────────
    if (this.meteringView) {
      let peakL = 0, peakR = 0, rmsL = 0, rmsR = 0;
      for (let i = 0; i < len; i++) {
        const absL = Math.abs(outputL[i]);
        const absR = Math.abs(outputR[i]);
        if (absL > peakL) peakL = absL;
        if (absR > peakR) peakR = absR;
        rmsL += outputL[i] * outputL[i];
        rmsR += outputR[i] * outputR[i];
      }
      rmsL = Math.sqrt(rmsL / len);
      rmsR = Math.sqrt(rmsR / len);

      this.meteringView[0] = peakL;
      this.meteringView[1] = rmsL;
      this.meteringView[2] = peakR;
      this.meteringView[3] = rmsR;
      this.meteringView[4] = Math.max(peakL, peakR);
      this.meteringView[5] = Math.max(rmsL, rmsR);

      const masterPeak = Math.max(peakL, peakR);
      this.meteringView[6] = masterPeak > 0.89
        ? -20 * Math.log10(0.89 / Math.max(masterPeak, 0.001))
        : 0;
    }

    return true;
  }
}

registerProcessor('mixi-dsp-processor', MixiDspProcessor);
