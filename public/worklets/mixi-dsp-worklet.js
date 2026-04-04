/**
 * Mixi DSP AudioWorklet Processor
 *
 * This is the real-time audio thread processor. It runs in a
 * separate thread from the main UI thread and has direct access
 * to the audio sample buffers.
 *
 * Current state: PASSTHROUGH (Phase 3, Step 7d)
 *
 * Roadmap:
 *   Step 8: Load Wasm module, receive SharedArrayBuffer for params
 *   Step 9: Process audio through Rust DSP chain
 *   Step 10: Read params via Atomics from SharedArrayBuffer
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor
 */
class MixiDspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Listen for messages from the main thread.
    this.port.onmessage = (event) => {
      const { type } = event.data;

      switch (type) {
        case 'init':
          // Future: receive SharedArrayBuffer and Wasm module
          this.port.postMessage({ type: 'ready' });
          break;

        case 'reset':
          // Future: reset all DSP state (filter memories, delay lines)
          break;
      }
    };
  }

  /**
   * Process 128 frames of audio.
   *
   * Current: passthrough (copy input → output).
   * Future: run Rust DSP chain via Wasm.
   *
   * @param inputs  - Array of input buses, each with N channels of 128 samples
   * @param outputs - Array of output buses, same structure
   * @returns true to keep the processor alive
   */
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !output) return true;

    // Passthrough: copy input channels to output channels.
    for (let ch = 0; ch < output.length; ch++) {
      if (input[ch]) {
        output[ch].set(input[ch]);
      } else {
        output[ch].fill(0);
      }
    }

    return true;
  }
}

registerProcessor('mixi-dsp-processor', MixiDspProcessor);
