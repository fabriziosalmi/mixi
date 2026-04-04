/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Disk Recording Bridge (Renderer Side)
//
// Crash-proof WAV recording via SharedArrayBuffer + AudioWorklet.
//
// Architecture:
//   MasterBus.output → recording-tap (AudioWorklet)
//     → SharedArrayBuffer (SPSC ring, 131072 frames, stereo f32)
//       → drainRing() every 500ms → ArrayBuffer
//         → IPC → Electron main: fs.writeSync → .wav on disk
//
// Fixed ~1MB RAM regardless of recording length.
// On crash, temp file survives with recoverable WAV header.
// ─────────────────────────────────────────────────────────────

interface DiskRecordingAPI {
  open: (args: { sampleRate: number; channels: number }) => Promise<{ filePath: string }>;
  flush: (data: ArrayBuffer) => Promise<{ bytesWritten: number }>;
  finalize: () => Promise<{ filePath: string; durationSecs: number; fileSizeBytes: number }>;
  cancel: () => Promise<void>;
  showSaveDialog: () => Promise<string | null>;
  saveAs: (src: string, dest: string) => Promise<{ dest: string }>;
  checkOrphans: () => Promise<Array<{
    path: string; sizeBytes: number; estimatedDurationSecs: number; createdAt: string;
  }>>;
  recover: (src: string, dest: string) => Promise<{ dest: string; sizeBytes: number }>;
  discard: (path: string) => Promise<void>;
}

function getDiskRecordingAPI(): DiskRecordingAPI | null {
  const w = window as any;
  if (w?.mixi?.diskRecording) {
    return w.mixi.diskRecording as DiskRecordingAPI;
  }
  return null;
}

/**
 * DiskRecordingBridge — Crash-proof WAV recording via SPSC ring + IPC disk writes.
 *
 * Usage:
 *   const bridge = DiskRecordingBridge.getInstance();
 *   if (bridge.isAvailable()) {
 *     await bridge.start(ctx, masterOutput);
 *     // ... recording ...
 *     const result = await bridge.stop();
 *     // result.filePath → temp WAV file
 *   }
 */
export class DiskRecordingBridge {
  private static instance: DiskRecordingBridge | null = null;

  /** Ring buffer capacity in frames (~3s at 44.1kHz) */
  static readonly RING_FRAMES = 131072;
  /** Stereo output */
  static readonly RING_CHANNELS = 2;
  /** Flush interval in ms */
  static readonly FLUSH_INTERVAL_MS = 500;

  private api: DiskRecordingAPI | null;
  private headerView: Uint32Array | null = null;
  private ringView: Float32Array | null = null;
  private tapNode: AudioWorkletNode | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readHead = 0;
  private _recording = false;
  private _totalFrames = 0;
  private _filePath: string | null = null;
  private _masterOutput: AudioNode | null = null;

  private constructor() {
    this.api = getDiskRecordingAPI();
  }

  static getInstance(): DiskRecordingBridge {
    if (!DiskRecordingBridge.instance) {
      DiskRecordingBridge.instance = new DiskRecordingBridge();
    }
    return DiskRecordingBridge.instance;
  }

  /** Whether disk recording is available (Electron with preload bridge + SAB support). */
  isAvailable(): boolean {
    return this.api !== null && typeof SharedArrayBuffer !== 'undefined';
  }

  /** Whether a recording is currently active. */
  get recording(): boolean { return this._recording; }

  /** Total frames written to disk so far. */
  get totalFrames(): number { return this._totalFrames; }

  /** Path to the current temp WAV file. */
  get filePath(): string | null { return this._filePath; }

  /**
   * Start crash-proof WAV recording.
   *
   * @param ctx — AudioContext (for worklet registration)
   * @param masterOutput — Node to tap (typically engine.getMasterOutput())
   */
  async start(ctx: AudioContext, masterOutput: AudioNode): Promise<boolean> {
    if (!this.api) return false;
    if (this._recording) return true; // already recording

    try {
      const channels = DiskRecordingBridge.RING_CHANNELS;
      const capacity = DiskRecordingBridge.RING_FRAMES;

      // 1. Create SharedArrayBuffer ring
      const headerBytes = 8; // write_head (u32) + read_head (u32)
      const dataBytes = capacity * channels * 4; // float32
      const ringBuffer = new SharedArrayBuffer(headerBytes + dataBytes);
      new Uint32Array(ringBuffer, 0, 2).fill(0); // zero header

      this.headerView = new Uint32Array(ringBuffer, 0, 2);
      this.ringView = new Float32Array(ringBuffer, 8);
      this.readHead = 0;

      // 2. Register AudioWorklet processor
      // C4 fix: relative worklet path
      const workletUrl = new URL('/worklets/recording-tap.js', import.meta.url);
      await ctx.audioWorklet.addModule(workletUrl.href);

      // 3. Create worklet node
      const tapNode = new AudioWorkletNode(ctx, 'recording-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // 4. Send ring buffer to worklet
      tapNode.port.postMessage({
        type: 'init',
        ringBuffer,
        ringCapacityFrames: capacity,
      });

      // Wait for worklet ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Recording worklet init timeout')), 3000);
        tapNode.port.onmessage = (e) => {
          if (e.data.type === 'ready') {
            clearTimeout(timeout);
            resolve();
          }
        };
      });

      // 5. Insert tap: masterOutput → tapNode → ctx.destination
      masterOutput.connect(tapNode);
      tapNode.connect(ctx.destination);

      // 6. Open temp file via IPC
      const { filePath } = await this.api.open({
        sampleRate: ctx.sampleRate,
        channels,
      });

      // 7. Start flush interval
      this.flushInterval = setInterval(() => this.flushToDisk(), DiskRecordingBridge.FLUSH_INTERVAL_MS);

      this.tapNode = tapNode;
      this._filePath = filePath;
      this._recording = true;
      this._totalFrames = 0;
      this._masterOutput = masterOutput;

      return true;
    } catch (err) {
      // Cleanup partial state
      if (this.tapNode) {
        this.tapNode.disconnect();
        this.tapNode = null;
      }
      this.headerView = null;
      this.ringView = null;
      this._recording = false;
      console.error('[DiskRecordingBridge] start failed:', err);
      return false;
    }
  }

  /**
   * Stop recording. Finalizes WAV header and returns file info.
   */
  async stop(): Promise<{ filePath: string; durationSecs: number; fileSizeBytes: number } | null> {
    if (!this._recording || !this.api) return null;

    // 1. Stop flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // 2. Final drain
    await this.flushToDisk();

    // 3. Finalize WAV header
    const result = await this.api.finalize();

    // 4. Tear down worklet
    this.teardownTap();

    return result;
  }

  /**
   * Cancel recording. Deletes temp file.
   */
  async cancel(): Promise<void> {
    if (!this._recording || !this.api) return;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.api.cancel();
    this.teardownTap();
  }

  /** Show native save dialog. */
  async showSaveDialog(): Promise<string | null> {
    if (!this.api) return null;
    return this.api.showSaveDialog();
  }

  /** Copy recording to user-chosen path. */
  async saveAs(src: string, dest: string): Promise<void> {
    if (!this.api) return;
    await this.api.saveAs(src, dest);
  }

  /** Check for orphan recordings from previous crashes. */
  async checkOrphans(): Promise<Array<{
    path: string; sizeBytes: number; estimatedDurationSecs: number; createdAt: string;
  }>> {
    if (!this.api) return [];
    return this.api.checkOrphans();
  }

  /** Recover an orphan recording. */
  async recover(src: string, dest: string): Promise<void> {
    if (!this.api) return;
    await this.api.recover(src, dest);
  }

  /** Discard an orphan recording. */
  async discard(path: string): Promise<void> {
    if (!this.api) return;
    await this.api.discard(path);
  }

  // ── Private ──────────────────────────────────────────────────

  /**
   * Drain available frames from the SPSC ring buffer.
   * Returns a new ArrayBuffer with interleaved f32 stereo PCM, or null if empty.
   */
  private drainRing(): ArrayBuffer | null {
    if (!this.headerView || !this.ringView) return null;

    const capacity = DiskRecordingBridge.RING_FRAMES;
    const channels = DiskRecordingBridge.RING_CHANNELS;

    const writeHead = Atomics.load(this.headerView, 0);
    const readHead = this.readHead;

    if (writeHead === readHead) return null; // empty

    // Calculate available frames
    const available = writeHead >= readHead
      ? writeHead - readHead
      : capacity - readHead + writeHead;

    // Copy frames to output buffer
    const outSamples = available * channels;
    const out = new Float32Array(outSamples);

    if (writeHead > readHead) {
      // Contiguous region
      const srcOffset = readHead * channels;
      out.set(this.ringView.subarray(srcOffset, srcOffset + outSamples));
    } else {
      // Wrap-around: two segments
      const seg1Frames = capacity - readHead;
      const seg1Samples = seg1Frames * channels;
      const seg1Offset = readHead * channels;
      out.set(this.ringView.subarray(seg1Offset, seg1Offset + seg1Samples), 0);

      const seg2Samples = (available - seg1Frames) * channels;
      out.set(this.ringView.subarray(0, seg2Samples), seg1Samples);
    }

    // Update read head
    this.readHead = (readHead + available) % capacity;
    Atomics.store(this.headerView, 1, this.readHead);

    return out.buffer;
  }

  /** Drain ring and send PCM data to main process for disk write. */
  private async flushToDisk(): Promise<void> {
    if (!this.api) return;

    const data = this.drainRing();
    if (data && data.byteLength > 0) {
      await this.api.flush(data);
      this._totalFrames += data.byteLength / (4 * DiskRecordingBridge.RING_CHANNELS);
    }
  }

  /** Disconnect and destroy the recording tap worklet. */
  private teardownTap(): void {
    if (this.tapNode) {
      this.tapNode.port.postMessage({ type: 'stop' });
      if (this._masterOutput) {
        try { this._masterOutput.disconnect(this.tapNode); } catch { /* ok */ }
      }
      this.tapNode.disconnect();
      this.tapNode = null;
    }

    this.headerView = null;
    this.ringView = null;
    this._masterOutput = null;
    this._recording = false;
    this._totalFrames = 0;
    this._filePath = null;
  }
}
