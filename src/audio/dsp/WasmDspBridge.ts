/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Wasm DSP Bridge
//
// Manages the lifecycle of the AudioWorklet-based DSP path:
//
//   1. Registers the worklet processor
//   2. Creates the AudioWorkletNode
//   3. Sends SharedArrayBuffers to the worklet
//   4. Provides connect/disconnect methods for the audio graph
//
// This is the "Big Switch" — when active, audio flows through
// the worklet instead of through the native WebAudio nodes.
// ─────────────────────────────────────────────────────────────

import { createDspBuffers, sendBuffersToWorklet, isSharedBufferSupported } from './SharedBufferBridge';
import type { DspSharedBuffers } from './SharedBufferBridge';
import { log } from '../../utils/logger';

export class WasmDspBridge {
  private node: AudioWorkletNode | null = null;
  private buffers: DspSharedBuffers | null = null;
  private _ready = false;

  get isReady(): boolean { return this._ready; }
  get workletNode(): AudioWorkletNode | null { return this.node; }
  get sharedBuffers(): DspSharedBuffers | null { return this.buffers; }

  /**
   * Initialize the Wasm DSP worklet path.
   *
   * 1. Checks SharedArrayBuffer support
   * 2. Registers the AudioWorklet processor
   * 3. Creates the AudioWorkletNode
   * 4. Sends shared buffers to the worklet thread
   */
  async init(ctx: AudioContext): Promise<boolean> {
    // Guard: SharedArrayBuffer required
    if (!isSharedBufferSupported()) {
      log.warn('WasmDsp', 'SharedArrayBuffer not available — falling back to native');
      return false;
    }

    try {
      // 1. Register the worklet processor
      await ctx.audioWorklet.addModule('/worklets/mixi-dsp-worklet.js');
      log.info('WasmDsp', 'AudioWorklet processor registered');

      // 2. Create the worklet node (stereo in/out)
      this.node = new AudioWorkletNode(ctx, 'mixi-dsp-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // 3. Create shared buffers
      this.buffers = createDspBuffers();
      log.info('WasmDsp', `Shared buffers created: ring=${this.buffers.audioRing.byteLength}B, params=${this.buffers.paramBus.byteLength}B`);

      // 4. Send buffers to worklet
      sendBuffersToWorklet(this.node, this.buffers);

      // Listen for ready signal
      this.node.port.onmessage = (e) => {
        if (e.data.type === 'ready') {
          log.success('WasmDsp', 'Worklet Wasm engine ready');
        }
        if (e.data.type === 'error') {
          log.error('WasmDsp', `Worklet error: ${e.data.message}`);
        }
      };

      this._ready = true;
      log.success('WasmDsp', 'DSP worklet bridge initialised (passthrough)');
      return true;
    } catch (err) {
      log.error('WasmDsp', `Failed to init worklet: ${err}`);
      return false;
    }
  }

  /**
   * Insert the worklet node into the audio graph.
   *
   * Before:  source → destination
   * After:   source → workletNode → destination
   */
  insertBetween(source: AudioNode, destination: AudioNode): void {
    if (!this.node) return;
    source.disconnect(destination);
    source.connect(this.node);
    this.node.connect(destination);
    log.info('WasmDsp', 'Worklet inserted into audio graph');
  }

  /**
   * Remove the worklet node from the audio graph.
   *
   * After:   source → destination (direct)
   */
  removeBetween(source: AudioNode, destination: AudioNode): void {
    if (!this.node) return;
    try {
      source.disconnect(this.node);
      this.node.disconnect(destination);
    } catch {
      // Already disconnected
    }
    source.connect(destination);
    log.info('WasmDsp', 'Worklet removed from audio graph');
  }

  destroy(): void {
    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }
    this.buffers = null;
    this._ready = false;
  }
}
