/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – DSP Processor Abstraction Layer
//
// This interface defines the contract that ALL audio processors
// must implement, regardless of backend:
//
//   • "Native" backend:  Thin wrappers around WebAudio API nodes
//                        (GainNode, BiquadFilterNode, etc.)
//
//   • "Wasm" backend:    Rust DSP running inside an AudioWorklet
//                        via SharedArrayBuffer
//
// The abstraction allows Mixi to:
//   1. Hot-swap backends at runtime (Settings toggle)
//   2. Fall back to Native if Wasm init fails
//   3. Test DSP logic in isolation (no AudioContext needed)
//
// ─────────────────────────────────────────────────────────────

import { GLOBAL } from './ParamLayout';

/**
 * A view into the shared parameter memory.
 *
 * In Native mode, this wraps a plain Float32Array.
 * In Wasm mode, this wraps a SharedArrayBuffer accessed via Atomics.
 *
 * All parameter offsets are defined in ParamLayout.ts.
 */
export interface DspParamBus {
  /** Read a float parameter at the given byte offset. */
  getFloat(byteOffset: number): number;

  /** Write a float parameter at the given byte offset. */
  setFloat(byteOffset: number, value: number): void;

  /** Read a boolean flag (stored as 0.0 / 1.0). */
  getBool(byteOffset: number): boolean;

  /** Write a boolean flag. */
  setBool(byteOffset: number, value: boolean): void;

  /**
   * Open a seqlock write transaction. Nestable — only the outermost
   * begin/end pair bumps the generation counter. No-op in non-shared mode.
   */
  beginWrite(): void;

  /** Close a seqlock write transaction (see beginWrite). */
  endWrite(): void;

  /** The underlying buffer (SharedArrayBuffer in Wasm mode). */
  readonly buffer: ArrayBuffer | SharedArrayBuffer;
}

/**
 * Backend identifier.
 * - 'native': WebAudio API nodes (GainNode, BiquadFilter, etc.)
 * - 'wasm':   Rust DSP in AudioWorklet via SharedArrayBuffer
 */
export type DspBackend = 'native' | 'wasm';

/**
 * Describes a single audio processing unit.
 *
 * Implementations MUST be stateless with respect to params:
 * all parameter values are read from the DspParamBus.
 * Internal state (filter memory, delay buffers) is kept
 * in the implementation.
 */
export interface DspProcessor {
  /** Human-readable name for logging. */
  readonly name: string;

  /** The backend this processor belongs to. */
  readonly backend: DspBackend;

  /**
   * Process a block of audio samples in-place.
   *
   * @param inputs  - Input channels (may be empty for generators)
   * @param outputs - Output channels (same length as inputs for effects)
   * @param params  - Shared parameter bus
   * @param frames  - Number of frames to process (typically 128)
   */
  process(
    inputs: Float32Array[],
    outputs: Float32Array[],
    params: DspParamBus,
    frames: number,
  ): void;

  /**
   * Reset all internal state (filter memories, delay buffers).
   * Called on track load or when switching backends.
   */
  reset(): void;

  /**
   * Optional: Called once when the processor is no longer needed.
   * Use for cleanup (disconnect native nodes, free Wasm memory).
   */
  destroy?(): void;
}

/**
 * A chain of DspProcessors that can be swapped atomically.
 *
 * In Native mode, each processor wraps a WebAudio node and the
 * chain is the native graph (no process() calls needed).
 *
 * In Wasm mode, the chain is executed sequentially inside the
 * AudioWorklet's process() callback.
 */
export interface DspChain {
  /** The ordered list of processors in this chain. */
  readonly processors: readonly DspProcessor[];

  /** The active backend. */
  readonly backend: DspBackend;

  /**
   * Sync all processors with the current parameter bus state.
   * In Native mode, this reads params and sets native node values.
   * In Wasm mode, this is a no-op (Worklet reads params directly).
   */
  syncParams(params: DspParamBus): void;

  /** Reset all processors in the chain. */
  resetAll(): void;

  /** Tear down the chain and release resources. */
  destroy(): void;
}

// ── Concrete DspParamBus implementations ─────────────────────

/**
 * Local (non-shared) parameter bus for Native mode.
 * Uses a regular Float32Array — no SharedArrayBuffer needed.
 */
export class LocalParamBus implements DspParamBus {
  private readonly view: DataView;
  readonly buffer: ArrayBuffer;

  constructor(sizeBytes: number) {
    this.buffer = new ArrayBuffer(sizeBytes);
    this.view = new DataView(this.buffer);
  }

  getFloat(byteOffset: number): number {
    return this.view.getFloat32(byteOffset, true); // little-endian
  }

  setFloat(byteOffset: number, value: number): void {
    this.view.setFloat32(byteOffset, value, true);
  }

  getBool(byteOffset: number): boolean {
    return this.view.getFloat32(byteOffset, true) > 0.5;
  }

  setBool(byteOffset: number, value: boolean): void {
    this.view.setFloat32(byteOffset, value ? 1.0 : 0.0, true);
  }

  // No cross-thread reader in native mode — the seqlock is a no-op.
  beginWrite(): void { /* no-op */ }
  endWrite(): void { /* no-op */ }
}

/**
 * Shared parameter bus for Wasm/Worklet mode.
 * Uses SharedArrayBuffer + Atomics for lock-free cross-thread access.
 */
export class SharedParamBus implements DspParamBus {
  private readonly i32View: Int32Array;
  readonly buffer: SharedArrayBuffer;

  /** Seqlock generation slot (i32 index) and nesting depth. */
  private readonly seqIdx = GLOBAL.SEQ >> 2;
  private writeDepth = 0;

  /** Reusable f32↔i32 reinterpret scratch — avoids two TypedArray allocations
   *  on every get/setFloat (~thousands/sec during a flush → main-thread GC). */
  private readonly _f32 = new Float32Array(1);
  private readonly _i32 = new Int32Array(this._f32.buffer);

  constructor(sizeBytes: number) {
    this.buffer = new SharedArrayBuffer(sizeBytes);
    this.i32View = new Int32Array(this.buffer);
  }

  beginWrite(): void {
    // Only the outermost transaction flips the counter odd (write in progress).
    if (this.writeDepth++ === 0) {
      Atomics.add(this.i32View, this.seqIdx, 1);
    }
  }

  endWrite(): void {
    if (this.writeDepth > 0 && --this.writeDepth === 0) {
      Atomics.add(this.i32View, this.seqIdx, 1); // back to even — snapshot stable
    }
  }

  getFloat(byteOffset: number): number {
    this._i32[0] = Atomics.load(this.i32View, byteOffset >> 2); // i32 bits → f32
    return this._f32[0];
  }

  setFloat(byteOffset: number, value: number): void {
    this._f32[0] = value; // f32 → i32 bits
    Atomics.store(this.i32View, byteOffset >> 2, this._i32[0]);
  }

  getBool(byteOffset: number): boolean {
    return this.getFloat(byteOffset) > 0.5;
  }

  setBool(byteOffset: number, value: boolean): void {
    this.setFloat(byteOffset, value ? 1.0 : 0.0);
  }
}
