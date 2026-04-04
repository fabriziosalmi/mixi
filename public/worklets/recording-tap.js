/**
 * Mixi Recording Tap — AudioWorklet Processor
 *
 * Captures audio samples from the WebAudio master bus and writes them
 * into a SharedArrayBuffer (SPSC ring buffer) for consumption by the
 * Electron main process disk flusher (crash-proof WAV recording).
 *
 * Ring buffer layout (same as native-output-tap.js):
 *   [0..3]  = write_head (u32, atomic)
 *   [4..7]  = read_head  (u32, atomic)
 *   [8..]   = interleaved f32 samples (stereo: L, R per frame)
 *
 * This processor is a transparent tap — audio passes through unchanged.
 */
class RecordingTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ringBuffer = null;
    this._ringView = null;
    this._ringCapacity = 0;
    this._writeHead = 0;
    this._active = false;

    this.port.onmessage = (e) => {
      if (e.data.type === 'init') {
        this._ringBuffer = e.data.ringBuffer;  // SharedArrayBuffer
        this._ringCapacity = e.data.ringCapacityFrames;
        this._ringView = new Float32Array(this._ringBuffer, 8); // skip 8-byte header
        this._headerView = new Uint32Array(this._ringBuffer, 0, 2); // [write_head, read_head]
        this._writeHead = 0;
        this._active = true;
        this.port.postMessage({ type: 'ready' });
      }
      if (e.data.type === 'stop') {
        this._active = false;
      }
    };
  }

  process(inputs, outputs) {
    // Always pass audio through (this is a tap, not a sink)
    const input = inputs[0];
    const output = outputs[0];

    if (input && output) {
      for (let ch = 0; ch < output.length; ch++) {
        if (input[ch]) {
          output[ch].set(input[ch]);
        }
      }
    }

    // Write to ring buffer if active
    if (!this._active || !this._ringView || !input || !input[0]) {
      return true;
    }

    const left = input[0];
    const right = input[1] || input[0]; // mono → duplicate
    const frames = left.length; // typically 128
    const capacity = this._ringCapacity;
    const channels = 2;

    // Check how much space is available
    const readHead = Atomics.load(this._headerView, 1); // read_head at index 1
    let writeHead = this._writeHead;

    const used = writeHead >= readHead
      ? writeHead - readHead
      : capacity - readHead + writeHead;
    const free = capacity - used - 1; // -1 to distinguish full from empty

    if (free < frames) {
      // Ring buffer full — drop samples (consumer is too slow)
      return true;
    }

    // Write interleaved samples to ring buffer
    for (let i = 0; i < frames; i++) {
      const ringIdx = ((writeHead + i) % capacity) * channels;
      this._ringView[ringIdx] = left[i];
      this._ringView[ringIdx + 1] = right[i];
    }

    // Update write head atomically
    this._writeHead = (writeHead + frames) % capacity;
    Atomics.store(this._headerView, 0, this._writeHead);

    return true;
  }
}

registerProcessor('recording-tap', RecordingTapProcessor);
