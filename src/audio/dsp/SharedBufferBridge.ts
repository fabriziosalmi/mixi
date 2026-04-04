/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Shared Buffer Bridge
//
// Creates and manages the SharedArrayBuffers used for
// communication between the main thread and AudioWorklet:
//
//   1. Audio Ring Buffer:   Main → Worklet (sample data)
//   2. Parameter Bus:       Main ↔ Worklet (DSP parameters)
//   3. Metering Bus:        Worklet → Main (VU levels, peak)
//
// Requires COOP/COEP headers (already configured in Phase 1).
// ─────────────────────────────────────────────────────────────

import { PARAM_BUS_SIZE } from './ParamLayout';

// ── Constants ────────────────────────────────────────────────

/** Ring buffer capacity in frames (128-frame blocks × 32 = ~93ms at 44.1kHz). */
const RING_CAPACITY_FRAMES = 128 * 32; // 4096 frames

/** Number of audio channels (stereo). */
const CHANNELS = 2;

/** SPSC header size in bytes (write_idx u32 + read_idx u32). */
const SPSC_HEADER = 8;

/** Metering bus size: 2 channels × (peak + rms) + master peak + master rms = 24 bytes. */
const METERING_BUS_SIZE = 6 * 4; // 6 floats × 4 bytes

// ── Types ────────────────────────────────────────────────────

export interface DspSharedBuffers {
  /** Audio ring buffer (main → worklet). */
  audioRing: SharedArrayBuffer;
  /** Ring buffer capacity in samples (frames × channels). */
  audioRingCapacity: number;
  /** DSP parameter bus (main ↔ worklet). */
  paramBus: SharedArrayBuffer;
  /** Metering output (worklet → main). */
  meteringBus: SharedArrayBuffer;
}

// ── Factory ──────────────────────────────────────────────────

/**
 * Check if SharedArrayBuffer is available.
 * Requires COOP/COEP headers to be set (done in Phase 1).
 */
export function isSharedBufferSupported(): boolean {
  try {
    return typeof SharedArrayBuffer !== 'undefined'
      && typeof Atomics !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Create all shared buffers needed for the DSP bridge.
 *
 * @throws If SharedArrayBuffer is not available.
 */
export function createDspBuffers(): DspSharedBuffers {
  if (!isSharedBufferSupported()) {
    throw new Error(
      'SharedArrayBuffer not available. Ensure COOP/COEP headers are set.',
    );
  }

  const capacity = RING_CAPACITY_FRAMES * CHANNELS;
  const audioRingBytes = SPSC_HEADER + capacity * 4;

  return {
    audioRing: new SharedArrayBuffer(audioRingBytes),
    audioRingCapacity: capacity,
    paramBus: new SharedArrayBuffer(PARAM_BUS_SIZE),
    meteringBus: new SharedArrayBuffer(METERING_BUS_SIZE),
  };
}

/**
 * Send shared buffers to an AudioWorkletNode via MessagePort.
 *
 * The worklet processor receives these in its `onmessage` handler
 * and uses them for zero-copy parameter reads and audio I/O.
 */
export function sendBuffersToWorklet(
  node: AudioWorkletNode,
  buffers: DspSharedBuffers,
): void {
  node.port.postMessage({
    type: 'init',
    audioRing: buffers.audioRing,
    audioRingCapacity: buffers.audioRingCapacity,
    paramBus: buffers.paramBus,
    meteringBus: buffers.meteringBus,
  });
}

// ── Metering Reader ──────────────────────────────────────────

/**
 * Read metering values from the metering bus.
 * Layout: [peakL, rmsL, peakR, rmsR, masterPeak, masterRms]
 */
export class MeteringReader {
  private readonly view: Float32Array;

  constructor(meteringBus: SharedArrayBuffer) {
    this.view = new Float32Array(meteringBus);
  }

  get peakL(): number { return Atomics.load(new Int32Array(this.view.buffer), 0) as unknown as number; }
  get rmsL(): number { return this.view[1]; }
  get peakR(): number { return this.view[2]; }
  get rmsR(): number { return this.view[3]; }
  get masterPeak(): number { return this.view[4]; }
  get masterRms(): number { return this.view[5]; }

  /** Get stereo peak as a single value (max of L/R). */
  get peak(): number {
    return Math.max(Math.abs(this.view[0]), Math.abs(this.view[2]));
  }

  /** Get stereo RMS as a single value (max of L/R). */
  get rms(): number {
    return Math.max(this.view[1], this.view[3]);
  }
}
