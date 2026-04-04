/**
 * Mixi DSP AudioWorklet Processor
 *
 * Runs the Rust/Wasm DSP engine in the audio thread.
 * Receives SharedArrayBuffers for:
 *   - paramBus: DSP parameters (512 bytes)
 *   - meteringBus: VU output (24 bytes)
 *
 * The Wasm module is sent via postMessage from the main thread.
 */

class MixiDspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = null;
    this.wasmReady = false;
    this.paramView = null;
    this.meteringView = null;

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  async _handleMessage(data) {
    if (data.type === 'init') {
      // Store shared buffer views
      if (data.paramBus) {
        this.paramView = new Uint8Array(data.paramBus);
      }
      if (data.meteringBus) {
        this.meteringView = new Float32Array(data.meteringBus);
      }
    }

    if (data.type === 'wasm-module') {
      try {
        // Instantiate the Wasm module in the worklet thread
        const { module, memory } = data;
        const instance = await WebAssembly.instantiate(module, {
          './mixi_core_bg.js': data.importObject || {},
          wbg: data.importObject || {},
          env: { memory },
        });

        // The DspEngine constructor is exported
        if (instance.exports && instance.exports.dspengine_new) {
          // Direct Wasm ABI: call the exported functions
          this._wasmExports = instance.exports;
          this._enginePtr = instance.exports.dspengine_new(sampleRate);
          this.wasmReady = true;
          this.port.postMessage({ type: 'ready' });
        }
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err) });
      }
    }

    if (data.type === 'load-wasm-bytes') {
      try {
        // Alternative: receive raw .wasm bytes and compile
        const module = await WebAssembly.compile(data.bytes);
        const instance = await WebAssembly.instantiate(module);
        this._wasmInstance = instance;
        this.wasmReady = true;
        this.port.postMessage({ type: 'ready' });
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err) });
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }

    const inputL = input[0];
    const inputR = input[1] || input[0];
    const outputL = output[0];
    const outputR = output[1] || output[0];

    // ── Passthrough mode (Wasm not loaded yet) ──────────
    if (!this.wasmReady) {
      outputL.set(inputL);
      if (output[1]) outputR.set(inputR);
      return true;
    }

    // ── Wasm DSP processing ─────────────────────────────
    // For now, passthrough until the full wasm-bindgen
    // worklet integration is established. The DspEngine
    // is ready in the main thread and can be used there.
    outputL.set(inputL);
    if (output[1]) outputR.set(inputR);

    // ── Metering ────────────────────────────────────────
    if (this.meteringView) {
      let peakL = 0, peakR = 0, rmsL = 0, rmsR = 0;
      for (let i = 0; i < outputL.length; i++) {
        const absL = Math.abs(outputL[i]);
        const absR = Math.abs(outputR[i]);
        if (absL > peakL) peakL = absL;
        if (absR > peakR) peakR = absR;
        rmsL += outputL[i] * outputL[i];
        rmsR += outputR[i] * outputR[i];
      }
      rmsL = Math.sqrt(rmsL / outputL.length);
      rmsR = Math.sqrt(rmsR / outputR.length);

      this.meteringView[0] = peakL;
      this.meteringView[1] = rmsL;
      this.meteringView[2] = peakR;
      this.meteringView[3] = rmsR;
      this.meteringView[4] = Math.max(peakL, peakR);
      this.meteringView[5] = Math.max(rmsL, rmsR);

      // Slot 6: Limiter Gain Reduction (dB, 0 = idle, negative = limiting)
      // For visual feedback: detect clipping conditions from peak level
      const masterPeak = Math.max(peakL, peakR);
      this.meteringView[6] = masterPeak > 0.89 ? -20 * Math.log10(0.89 / Math.max(masterPeak, 0.001)) : 0;
    }

    return true;
  }
}

registerProcessor('mixi-dsp-processor', MixiDspProcessor);
