/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Wasm DSP Bridge
//
// Manages the AudioWorklet-based Rust DSP path:
//
//   1. Registers the worklet processor
//   2. Creates 2-input AudioWorkletNode (Deck A + Deck B)
//   3. Sends SharedArrayBuffers (paramBus, meteringBus)
//   4. Fetches, compiles, and sends the Wasm module to worklet
//   5. Waits for worklet to confirm Wasm engine ready
//   6. Provides connect/disconnect for the audio graph
//
// When active, audio flows through Rust DSP (EQ, FX, Master)
// instead of through the WebAudio nodes.
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
   * 3. Creates 2-input AudioWorkletNode (Deck A + Deck B)
   * 4. Sends shared buffers to the worklet thread
   * 5. Fetches, compiles, and sends the .wasm module
   * 6. Waits for the worklet to confirm engine instantiation
   */
  async init(ctx: AudioContext): Promise<boolean> {
    if (!isSharedBufferSupported()) {
      log.warn('WasmDsp', 'SharedArrayBuffer not available — falling back to native');
      return false;
    }

    try {
      // 1. Register the worklet processor
      await ctx.audioWorklet.addModule('/worklets/mixi-dsp-worklet.js');
      log.info('WasmDsp', 'AudioWorklet processor registered');

      // 2. Create 2-input worklet node (Deck A = input 0, Deck B = input 1)
      this.node = new AudioWorkletNode(ctx, 'mixi-dsp-processor', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // 3. Create shared buffers
      this.buffers = createDspBuffers();
      log.info('WasmDsp', `Shared buffers: params=${this.buffers.paramBus.byteLength}B`);

      // 4. Send buffers to worklet
      sendBuffersToWorklet(this.node, this.buffers);

      // 5. Fetch and compile the Wasm module
      const wasmUrl = new URL('/mixi-core/pkg/mixi_core_bg.wasm', window.location.origin);
      const response = await fetch(wasmUrl.href);
      if (!response.ok) {
        throw new Error(`Failed to fetch wasm: ${response.status}`);
      }
      const wasmBytes = await response.arrayBuffer();
      const wasmModule = await WebAssembly.compile(wasmBytes);
      log.info('WasmDsp', `Wasm module compiled (${(wasmBytes.byteLength / 1024).toFixed(0)} KB)`);

      // 6. Send compiled module to worklet and wait for ready
      const ready = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          log.warn('WasmDsp', 'Worklet init timeout (5s)');
          resolve(false);
        }, 5000);

        this.node!.port.onmessage = (e) => {
          if (e.data.type === 'ready') {
            clearTimeout(timeout);
            resolve(true);
          }
          if (e.data.type === 'error') {
            clearTimeout(timeout);
            log.error('WasmDsp', `Worklet error: ${e.data.message}`);
            resolve(false);
          }
        };

        this.node!.port.postMessage({
          type: 'wasm-module',
          module: wasmModule,
        });
      });

      if (!ready) {
        log.warn('WasmDsp', 'Wasm init failed — falling back to native');
        this.destroy();
        return false;
      }

      this._ready = true;
      log.success('WasmDsp', 'Rust DSP engine ACTIVE in AudioWorklet');
      return true;
    } catch (err) {
      log.error('WasmDsp', `Failed to init: ${err}`);
      this.destroy();
      return false;
    }
  }

  /**
   * Connect deck A's trimGain to worklet input 0.
   */
  connectDeckA(trimGain: AudioNode): void {
    if (!this.node) return;
    trimGain.connect(this.node, 0, 0);
  }

  /**
   * Connect deck B's trimGain to worklet input 1.
   */
  connectDeckB(trimGain: AudioNode): void {
    if (!this.node) return;
    trimGain.connect(this.node, 0, 1);
  }

  /**
   * Connect worklet output to destination (master analyser, etc).
   */
  connectOutput(destination: AudioNode): void {
    if (!this.node) return;
    this.node.connect(destination);
  }

  /**
   * Disconnect worklet from all sources and destinations.
   */
  disconnectAll(): void {
    if (!this.node) return;
    try { this.node.disconnect(); } catch { /* ok */ }
  }

  destroy(): void {
    this.disconnectAll();
    this.node = null;
    this.buffers = null;
    this._ready = false;
  }
}
