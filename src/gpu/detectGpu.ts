/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – WebGPU Feature Detection
//
// Probes the GPU adapter and device to determine if WebGPU
// is available. Returns 'canvas2d' on any failure.
// ─────────────────────────────────────────────────────────────

export type GpuBackend = 'webgpu' | 'canvas2d';

export async function detectGpuBackend(): Promise<GpuBackend> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return 'canvas2d';

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return 'canvas2d';

    const device = await adapter.requestDevice();
    device.destroy(); // probe only — real device created by WebGpuRenderer
    return 'webgpu';
  } catch {
    return 'canvas2d';
  }
}
