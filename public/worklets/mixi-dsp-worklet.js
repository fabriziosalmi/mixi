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

// Seqlock generation counter byte offset in the param bus
// (ParamLayout.GLOBAL.SEQ = 408) → i32 index. JS/worklet-only; the Rust
// engine never reads it. The main thread bumps it odd while writing a batch
// of params and even when done, so we can copy a consistent snapshot.
const PARAM_SEQ_I32 = 408 >> 2; // 102
const PARAM_SEQ_MAX_RETRIES = 8;

class MixiDspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasmReady = false;
    this.paramView = null;     // Uint8Array on SharedArrayBuffer
    this.paramI32 = null;      // Int32Array on the SAME buffer (seqlock reads)
    this.meteringView = null;  // Float32Array on SharedArrayBuffer

    // Wasm state (set after instantiation of the lean mixi-dsp wasm)
    this._exports = null;      // Wasm instance exports (stable C ABI)
    this._engine = 0;          // Handle from dsp_engine_new()
    this._memory = null;       // Wasm linear memory
    this._memF32 = null;       // cached Float32 view over _memory.buffer
    this._memU8 = null;        // cached Uint8 view over _memory.buffer

    // Engine-owned buffer byte-offsets (from the dsp_*_ptr accessors)
    this._inL = 0;
    this._inR = 0;
    this._outL = 0;
    this._outR = 0;
    this._paramPtr = 0;

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  async _handleMessage(data) {
    if (data.type === 'init') {
      if (data.paramBus) {
        this.paramView = new Uint8Array(data.paramBus);
        this.paramI32 = new Int32Array(data.paramBus);
      }
      if (data.meteringBus) {
        this.meteringView = new Float32Array(data.meteringBus);
      }
      return;
    }

    if (data.type === 'wasm-bytes') {
      try {
        // The lean mixi-dsp wasm has ZERO imports — instantiate with {}.
        // (We receive raw bytes, not a WebAssembly.Module: cloning a Module into
        // an AudioWorklet realm is unreliable and previously caused a silent
        // init timeout.)
        const { instance } = await WebAssembly.instantiate(data.bytes, {});
        const ex = instance.exports;

        if (typeof ex.dsp_engine_new !== 'function' || typeof ex.dsp_process !== 'function') {
          this.port.postMessage({
            type: 'error',
            message: 'lean DSP exports missing (dsp_engine_new / dsp_process). Available: ' +
              Object.keys(ex).filter(k => k.startsWith('dsp_')).join(', '),
          });
          return;
        }

        this._exports = ex;
        this._memory = ex.memory;

        // Create the engine; cache its owned I/O buffer byte-offsets.
        // `sampleRate` is a global in AudioWorkletGlobalScope.
        this._engine = ex.dsp_engine_new(sampleRate);
        this._inL = ex.dsp_in_l_ptr(this._engine);
        this._inR = ex.dsp_in_r_ptr(this._engine);
        this._outL = ex.dsp_out_l_ptr(this._engine);
        this._outR = ex.dsp_out_r_ptr(this._engine);
        this._paramPtr = ex.dsp_param_ptr(this._engine);

        if (!this._engine) {
          this.port.postMessage({ type: 'error', message: 'dsp_engine_new returned null' });
          return;
        }

        this.wasmReady = true;
        this.port.postMessage({ type: 'ready' });
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
    if (this.wasmReady && this._exports && this._engine) {
      // Cache the views over Wasm memory; allocating two TypedArrays per block
      // (~700/sec) churned GC on the audio render thread (xrun risk). Rebuild
      // only if the backing ArrayBuffer changed (memory.grow detaches it — the
      // fixed-size lean DSP never grows, but the guard is cheap insurance).
      if (!this._memF32 || this._memF32.buffer !== this._memory.buffer) {
        this._memF32 = new Float32Array(this._memory.buffer);
        this._memU8 = new Uint8Array(this._memory.buffer);
      }
      const mem = this._memF32;
      const memU8 = this._memU8;

      // Engine-owned buffer offsets (bytes → f32 index; ptrs are 4-aligned).
      const inLOff = this._inL / 4;
      const inROff = this._inR / 4;
      const outLOff = this._outL / 4;
      const outROff = this._outR / 4;

      // Deck A → in_l, Deck B → in_r.
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

      // Param bus (SharedArrayBuffer snapshot) → engine param buffer.
      // Seqlock: if the writer publishes mid-copy (counter is odd or changes
      // across the copy), retry so the DSP never sees a half-written batch
      // (e.g. an FX `active` flag without its matching `amount`). If the writer
      // never bumps the counter it stays 0/even and this copies once.
      if (this.paramView) {
        const i32 = this.paramI32;
        if (i32) {
          let s1, s2, attempts = 0;
          do {
            s1 = Atomics.load(i32, PARAM_SEQ_I32);
            if (s1 & 1) continue;                      // write in progress — spin
            memU8.set(this.paramView, this._paramPtr); // tentative snapshot copy
            s2 = Atomics.load(i32, PARAM_SEQ_I32);
          } while (((s1 & 1) || s1 !== s2) && ++attempts < PARAM_SEQ_MAX_RETRIES);
        } else {
          memU8.set(this.paramView, this._paramPtr);
        }
      }

      // Run the Rust DSP engine on its owned buffers (stable C ABI).
      this._exports.dsp_process(this._engine, len);

      // Copy processed output back to the worklet output.
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
