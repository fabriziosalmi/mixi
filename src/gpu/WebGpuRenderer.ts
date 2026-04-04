/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – WebGPU VFX Renderer (VJ Edition)
//
// VJ Secrets applied:
//   #1 FFT as GPU texture (hardware interpolation)
//   #4 Isolated stems (kick/snare/hihat uniforms)
//   #5 BPM phase sync
//   #6 Energy derivative
//   #29 Emergency kill-switch support
//
// Single full-screen triangle, 64B uniforms + 128-texel FFT.
// ─────────────────────────────────────────────────────────────

import shaderSource from './shaders/vfx.wgsl?raw';

export interface VfxFrameParams {
  width: number;
  height: number;
  time: number;
  beatEnergy: number;
  kick: number;         // Secret #4: 20-80Hz RMS
  snare: number;        // Secret #4: 1-3kHz RMS
  hihat: number;        // Secret #4: 8-15kHz RMS
  hue: number;
  beatCount: number;
  beatPhase: number;    // Secret #5: 0→1 BPM sawtooth
  energyDeriv: number;  // Secret #6: dEnergy/dt
  totalEnergy: number;  // Secret #23: for Rule of Black
  crossfader: number;   // 0=A, 0.5=center, 1=B
  fftBins: Uint8Array;  // 128 bins, 0-255
}

export class WebGpuRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private fftTexture: GPUTexture;       // Secret #1: FFT as texture
  private bindGroup: GPUBindGroup;
  private context: GPUCanvasContext;

  // Reusable CPU-side staging arrays (zero GC)
  private uniformData = new Float32Array(16); // 64 bytes
  private fftData = new Float32Array(128);    // normalized 0..1

  private _destroyed = false;

  private constructor(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
    fftTexture: GPUTexture,
    bindGroup: GPUBindGroup,
    context: GPUCanvasContext,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.uniformBuffer = uniformBuffer;
    this.fftTexture = fftTexture;
    this.bindGroup = bindGroup;
    this.context = context;
  }

  /** Create a WebGPU renderer bound to the given canvas. */
  static async create(
    canvas: HTMLCanvasElement,
    onDeviceLost?: () => void,
  ): Promise<WebGpuRenderer> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');

    // Request float32-filterable for HW-interpolated FFT texture reads
    const features: GPUFeatureName[] = [];
    if (adapter.features.has('float32-filterable')) {
      features.push('float32-filterable');
    }
    const device = await adapter.requestDevice({
      requiredFeatures: features,
    });

    const canFilterFloat = device.features.has('float32-filterable');

    device.lost.then((info) => {
      console.warn(`[mixi-gpu] Device lost: ${info.reason} — ${info.message}`);
      onDeviceLost?.();
    });

    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('No WebGPU context');

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });

    // Shader module
    const shaderModule = device.createShaderModule({ code: shaderSource });

    // Secret #1: FFT texture (128×1, r32float) + linear sampler
    const fftTexture = device.createTexture({
      size: [128, 1, 1],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // HW interpolation between FFT bins when float32-filterable is available
    const fftSampler = device.createSampler({
      magFilter: canFilterFloat ? 'linear' : 'nearest',
      minFilter: canFilterFloat ? 'linear' : 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Bind group layout: uniform + texture + sampler
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {
          sampleType: canFilterFloat ? 'float' : 'unfilterable-float',
        } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {
          type: canFilterFloat ? 'filtering' : 'non-filtering',
        } },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    // Render pipeline
    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Uniform buffer (16 x f32 = 64 bytes)
    const uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Bind group
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: fftTexture.createView() },
        { binding: 2, resource: fftSampler },
      ],
    });

    return new WebGpuRenderer(device, pipeline, uniformBuffer, fftTexture, bindGroup, context);
  }

  /** Resize the WebGPU canvas. */
  resize(width: number, height: number): void {
    if (this._destroyed) return;
    const canvas = this.context.canvas as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  /** Render one frame. */
  render(params: VfxFrameParams): void {
    if (this._destroyed) return;

    const dpr = window.devicePixelRatio || 1;

    // Fill uniforms (reused Float32Array)
    const ud = this.uniformData;
    ud[0] = params.width * dpr;   // resolution.x
    ud[1] = params.height * dpr;  // resolution.y
    ud[2] = params.time;          // time
    ud[3] = params.beatEnergy;    // beat_energy
    ud[4] = params.kick;          // kick (Secret #4)
    ud[5] = params.snare;         // snare (Secret #4)
    ud[6] = params.hihat;         // hihat (Secret #4)
    ud[7] = params.hue;           // hue
    ud[8] = params.beatCount;     // beat_count
    ud[9] = params.beatPhase;     // beat_phase (Secret #5)
    ud[10] = params.energyDeriv;  // energy_deriv (Secret #6)
    ud[11] = params.totalEnergy;  // total_energy (Secret #23)
    ud[12] = params.crossfader;   // crossfader
    ud[13] = 0; // _pad0
    ud[14] = 0; // _pad1
    ud[15] = 0; // _pad2

    // Normalize FFT bins → 0..1 (reused Float32Array)
    const fd = this.fftData;
    const bins = params.fftBins;
    const len = Math.min(bins.length, 128);
    for (let i = 0; i < len; i++) fd[i] = bins[i] / 255;
    for (let i = len; i < 128; i++) fd[i] = 0;

    // Upload uniforms
    this.device.queue.writeBuffer(this.uniformBuffer, 0, ud);

    // Secret #1: Upload FFT as texture (128×1 r32float)
    this.device.queue.writeTexture(
      { texture: this.fftTexture },
      fd.buffer,
      { bytesPerRow: 128 * 4 },
      { width: 128, height: 1 },
    );

    // Render pass
    const textureView = this.context.getCurrentTexture().createView();
    const encoder = this.device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  /** Secret #29: Emergency kill-switch. Release all GPU resources immediately. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this.uniformBuffer.destroy();
    this.fftTexture.destroy();
    this.device.destroy();
  }

  get destroyed(): boolean { return this._destroyed; }
}
