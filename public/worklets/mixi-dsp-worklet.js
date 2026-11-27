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
    this.paramScratch = null;  // local read target (non-shared)
    this.lastGoodParams = null;// last seqlock-validated snapshot (non-shared)
    this.meteringView = null;  // Float32Array on SharedArrayBuffer

    // Wasm state (set after instantiation of the lean mixi-dsp wasm)
    this._exports = null;      // Wasm instance exports (stable C ABI)
    this._engine = 0;          // Handle from dsp_engine_new()
    this._memory = null;       // Wasm linear memory
    this._memF32 = null;       // cached Float32 view over _memory.buffer
    this._memU8 = null;        // cached Uint8 view over _memory.buffer

    // Engine-owned buffer byte-offsets (from the dsp_*_ptr accessors)
    this._inAL = 0;
    this._inAR = 0;
    this._inBL = 0;
    this._inBR = 0;
    this._outL = 0;
    this._outR = 0;
    this._paramPtr = 0;

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  async _handleMessage(data) {
    if (data.type === 'reset') {
      if (this.wasmReady && this._exports && this._engine && typeof this._exports.dsp_engine_reset === 'function') {
        this._exports.dsp_engine_reset(this._engine);
      }
      return;
    }

    if (data.type === 'destroy') {
      if (this._exports && this._engine && typeof this._exports.dsp_engine_free === 'function') {
        this._exports.dsp_engine_free(this._engine);
      }
      this._engine = 0;
      this.wasmReady = false;
      return;
    }

    if (data.type === 'init') {
      if (data.paramBus) {
        this.paramView = new Uint8Array(data.paramBus);
        this.paramI32 = new Int32Array(data.paramBus);
        this.paramScratch = new Uint8Array(data.paramBus.byteLength);
        this.lastGoodParams = new Uint8Array(data.paramBus.byteLength);
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

        // Create the engine; cache its owned stereo I/O buffer byte-offsets.
        // `sampleRate` is a global in AudioWorkletGlobalScope.
        this._engine = ex.dsp_engine_new(sampleRate);
        this._inAL = typeof ex.dsp_in_a_l_ptr === 'function' ? ex.dsp_in_a_l_ptr(this._engine) : ex.dsp_in_l_ptr(this._engine);
        this._inAR = typeof ex.dsp_in_a_r_ptr === 'function' ? ex.dsp_in_a_r_ptr(this._engine) : this._inAL;
        this._inBL = typeof ex.dsp_in_b_l_ptr === 'function' ? ex.dsp_in_b_l_ptr(this._engine) : ex.dsp_in_r_ptr(this._engine);
        this._inBR = typeof ex.dsp_in_b_r_ptr === 'function' ? ex.dsp_in_b_r_ptr(this._engine) : this._inBL;
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

    // Get true stereo deck inputs (2-input worklet: Deck A L/R, Deck B L/R)
    const deckA = inputs[0];
    const deckB = inputs[1];
    const inAL = deckA && deckA[0] ? deckA[0] : null;
    const inAR = deckA && deckA[1] ? deckA[1] : inAL;
    const inBL = deckB && deckB[0] ? deckB[0] : null;
    const inBR = deckB && deckB[1] ? deckB[1] : inBL;

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

      // Engine-owned stereo buffer offsets (bytes → f32 index; ptrs are 4-aligned).
      const inALOff = this._inAL / 4;
      const inAROff = this._inAR / 4;
      const inBLOff = this._inBL / 4;
      const inBROff = this._inBR / 4;
      const outLOff = this._outL / 4;
      const outROff = this._outR / 4;

      // Deck A (L/R) → in_a_l / in_a_r; Deck B (L/R) → in_b_l / in_b_r.
      if (inAL) mem.set(inAL, inALOff); else mem.fill(0, inALOff, inALOff + len);
      if (inAR) mem.set(inAR, inAROff); else mem.fill(0, inAROff, inAROff + len);
      if (inBL) mem.set(inBL, inBLOff); else mem.fill(0, inBLOff, inBLOff + len);
      if (inBR) mem.set(inBR, inBROff); else mem.fill(0, inBROff, inBROff + len);

      // Param bus (SharedArrayBuffer snapshot) → engine param buffer.
      // Seqlock: read into a local scratch and only promote it to lastGood when
      // the generation counter is even AND unchanged across the read. We then
      // ALWAYS feed the engine lastGood — so on retry exhaustion it sees the
      // PREVIOUS consistent snapshot, never a half-written one (e.g. an FX
      // `active` flag without its matching `amount`). If the writer never bumps
      // the counter it stays 0/even and the first read validates immediately.
      if (this.paramView) {
        const i32 = this.paramI32;
        if (i32 && this.paramScratch && this.lastGoodParams) {
          for (let attempts = 0; attempts < PARAM_SEQ_MAX_RETRIES; attempts++) {
            const s1 = Atomics.load(i32, PARAM_SEQ_I32);
            if (s1 & 1) continue;                       // write in progress — spin
            this.paramScratch.set(this.paramView);      // tentative read
            const s2 = Atomics.load(i32, PARAM_SEQ_I32);
            if (s1 === s2) {                            // clean → promote
              this.lastGoodParams.set(this.paramScratch);
              break;
            }
          }
          memU8.set(this.lastGoodParams, this._paramPtr);
        } else {
          memU8.set(this.paramView, this._paramPtr);
        }
      }

      // Run the Rust DSP engine on its owned stereo buffers (stable C ABI).
      this._exports.dsp_process(this._engine, len);

      // Copy processed stereo output back to the worklet output.
      outputL.set(mem.subarray(outLOff, outLOff + len));
      outputR.set(mem.subarray(outROff, outROff + len));

    } else {
      // ── Passthrough mode (Wasm not ready) — preserve true stereo ──
      if (inAL) outputL.set(inAL); else outputL.fill(0);
      if (inBL) {
        for (let i = 0; i < len; i++) outputL[i] += inBL[i];
      }
      if (inAR) outputR.set(inAR); else outputR.fill(0);
      if (inBR) {
        for (let i = 0; i < len; i++) outputR[i] += inBR[i];
      }
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

      // SE-09: Read real limiter gain reduction in dB from Rust PredictiveLimiter
      if (this.wasmReady && this._exports && this._engine && typeof this._exports.dsp_limiter_gr === 'function') {
        this.meteringView[6] = this._exports.dsp_limiter_gr(this._engine);
      } else {
        const masterPeak = Math.max(peakL, peakR);
        this.meteringView[6] = masterPeak > 0.89
          ? -20 * Math.log10(0.89 / Math.max(masterPeak, 0.001))
          : 0;
      }
    }

    return true;
  }
}

registerProcessor('mixi-dsp-processor', MixiDspProcessor);
