/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – WebGPU VFX Renderer (Tier 2 — VJ Edition)
//
// VJ Secrets applied:
//   #1  FFT as GPU texture (HW interpolation)
//   #2  Ring texture spectrogram (64-frame history)
//   #3  Max-hold peak data
//   #14 Feedback loops (ping-pong render targets)
//   #24 Semantic deck colors
//   #29 Emergency kill-switch
//
// Resources: 128B uniforms, 128×1 FFT texture, 128×64 ring
//            texture, 2× screen-size ping-pong for feedback.
// ─────────────────────────────────────────────────────────────

import shaderSource from './shaders/vfx.wgsl?raw';

export interface VfxFrameParams {
  width: number;
  height: number;
  time: number;
  beatEnergy: number;
  kick: number;
  snare: number;
  hihat: number;
  hue: number;
  beatCount: number;
  beatPhase: number;
  energyDeriv: number;
  totalEnergy: number;
  crossfader: number;
  colorFilter: number;                  // #25: -1→+1
  ringWritePos: number;                 // #2: 0..63
  feedbackAmount: number;               // #14: 0..1
  deckAColor: [number, number, number]; // #24: RGB 0..1
  deckBColor: [number, number, number]; // #24: RGB 0..1
  fftBins: Uint8Array;
  peakBins: Float32Array;               // #3: peak-held 0..1
}

export class WebGpuRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private fftTexture: GPUTexture;
  private ringTexture: GPUTexture;              // #2: 128×64 spectrogram
  private fbA: GPUTexture | null = null;        // #14: ping-pong A
  private fbB: GPUTexture | null = null;        // #14: ping-pong B
  private bindGroupA: GPUBindGroup | null = null;
  private bindGroupB: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout;
  private fftSampler: GPUSampler;
  private feedbackSampler: GPUSampler;
  private context: GPUCanvasContext;
  private canvasFormat: GPUTextureFormat;
  private pingPong = false;                     // alternates each frame

  // CPU-side staging (zero GC)
  private uniformData = new Float32Array(32);   // 128 bytes
  private fftData = new Float32Array(128);
  private ringData = new Float32Array(128 * 64); // spectrogram history
  private ringRow = 0;

  private _destroyed = false;
  private _fbWidth = 0;
  private _fbHeight = 0;

  private constructor(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
    fftTexture: GPUTexture,
    ringTexture: GPUTexture,
    fftSampler: GPUSampler,
    feedbackSampler: GPUSampler,
    bindGroupLayout: GPUBindGroupLayout,
    context: GPUCanvasContext,
    canvasFormat: GPUTextureFormat,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.uniformBuffer = uniformBuffer;
    this.fftTexture = fftTexture;
    this.ringTexture = ringTexture;
    this.fftSampler = fftSampler;
    this.feedbackSampler = feedbackSampler;
    this.bindGroupLayout = bindGroupLayout;
    this.context = context;
    this.canvasFormat = canvasFormat;
  }

  static async create(
    canvas: HTMLCanvasElement,
    onDeviceLost?: () => void,
  ): Promise<WebGpuRenderer> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');

    const features: GPUFeatureName[] = [];
    if (adapter.features.has('float32-filterable')) {
      features.push('float32-filterable');
    }
    const device = await adapter.requestDevice({ requiredFeatures: features });
    const canFilterFloat = device.features.has('float32-filterable');

    device.lost.then((info) => {
      console.warn(`[mixi-gpu] Device lost: ${info.reason} — ${info.message}`);
      onDeviceLost?.();
    });

    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('No WebGPU context');

    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat, alphaMode: 'premultiplied' });

    const shaderModule = device.createShaderModule({ code: shaderSource });

    // Textures
    const fftTexture = device.createTexture({
      size: [128, 1, 1], format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const ringTexture = device.createTexture({
      size: [128, 64, 1], format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Samplers
    const fftSampler = device.createSampler({
      magFilter: canFilterFloat ? 'linear' : 'nearest',
      minFilter: canFilterFloat ? 'linear' : 'nearest',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    const feedbackSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    // Bind group layout (6 bindings)
    const floatTexType = canFilterFloat ? 'float' : 'unfilterable-float';
    const floatSamplerType = canFilterFloat ? 'filtering' : 'non-filtering';

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: floatTexType as GPUTextureSampleType } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: floatSamplerType as GPUSamplerBindingType } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: floatTexType as GPUTextureSampleType } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vs' },
      fragment: {
        module: shaderModule, entryPoint: 'fs',
        targets: [{
          format: canvasFormat,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const uniformBuffer = device.createBuffer({
      size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const renderer = new WebGpuRenderer(
      device, pipeline, uniformBuffer, fftTexture, ringTexture,
      fftSampler, feedbackSampler, bindGroupLayout, context, canvasFormat,
    );

    // Create initial feedback textures
    const dpr = window.devicePixelRatio || 1;
    renderer.ensureFeedbackTextures(Math.ceil(canvas.width || window.innerWidth * dpr), Math.ceil(canvas.height || window.innerHeight * dpr));

    return renderer;
  }

  /** Ensure ping-pong feedback textures match the given size. */
  private ensureFeedbackTextures(w: number, h: number): void {
    if (w === this._fbWidth && h === this._fbHeight && this.fbA && this.fbB) return;
    if (w < 1 || h < 1) return;

    this.fbA?.destroy();
    this.fbB?.destroy();

    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
    this.fbA = this.device.createTexture({ size: [w, h, 1], format: this.canvasFormat, usage });
    this.fbB = this.device.createTexture({ size: [w, h, 1], format: this.canvasFormat, usage });
    this._fbWidth = w;
    this._fbHeight = h;

    // Rebuild bind groups for ping-pong
    this.bindGroupA = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.fftTexture.createView() },
        { binding: 2, resource: this.fftSampler },
        { binding: 3, resource: this.ringTexture.createView() },
        { binding: 4, resource: this.fbB!.createView() },  // reads B
        { binding: 5, resource: this.feedbackSampler },
      ],
    });
    this.bindGroupB = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.fftTexture.createView() },
        { binding: 2, resource: this.fftSampler },
        { binding: 3, resource: this.ringTexture.createView() },
        { binding: 4, resource: this.fbA!.createView() },  // reads A
        { binding: 5, resource: this.feedbackSampler },
      ],
    });
  }

  resize(width: number, height: number): void {
    if (this._destroyed) return;
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.context.canvas as HTMLCanvasElement;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    this.ensureFeedbackTextures(canvas.width, canvas.height);
  }

  render(params: VfxFrameParams): void {
    if (this._destroyed) return;

    const dpr = window.devicePixelRatio || 1;
    const pw = params.width * dpr;
    const ph = params.height * dpr;

    // Ensure feedback textures match
    this.ensureFeedbackTextures(Math.ceil(pw), Math.ceil(ph));

    // ── Fill uniforms (128 bytes = 32 × f32) ─────────────────
    const ud = this.uniformData;
    ud[0] = pw;                      // resolution.x
    ud[1] = ph;                      // resolution.y
    ud[2] = params.time;             // time
    ud[3] = params.beatEnergy;       // beat_energy
    ud[4] = params.kick;             // kick
    ud[5] = params.snare;            // snare
    ud[6] = params.hihat;            // hihat
    ud[7] = params.hue;              // hue
    ud[8] = params.beatCount;        // beat_count
    ud[9] = params.beatPhase;        // beat_phase
    ud[10] = params.energyDeriv;     // energy_deriv
    ud[11] = params.totalEnergy;     // total_energy
    ud[12] = params.crossfader;      // crossfader
    ud[13] = params.colorFilter;     // color_filter (#25)
    ud[14] = this.ringRow;           // ring_write_pos (#2)
    ud[15] = params.feedbackAmount;  // feedback_amount (#14)
    // deck_a_color (vec4f at offset 16)
    ud[16] = params.deckAColor[0];
    ud[17] = params.deckAColor[1];
    ud[18] = params.deckAColor[2];
    ud[19] = 0; // .w unused
    // deck_b_color (vec4f at offset 20)
    ud[20] = params.deckBColor[0];
    ud[21] = params.deckBColor[1];
    ud[22] = params.deckBColor[2];
    ud[23] = 0;
    // padding
    ud[24] = 0; ud[25] = 0; ud[26] = 0; ud[27] = 0;
    ud[28] = 0; ud[29] = 0; ud[30] = 0; ud[31] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, ud);

    // ── FFT texture (current frame, raw) ─────────────────────
    const fd = this.fftData;
    const bins = params.fftBins;
    const len = Math.min(bins.length, 128);
    for (let i = 0; i < len; i++) fd[i] = bins[i] / 255;
    for (let i = len; i < 128; i++) fd[i] = 0;
    this.device.queue.writeTexture(
      { texture: this.fftTexture }, fd.buffer,
      { bytesPerRow: 128 * 4 }, { width: 128, height: 1 },
    );

    // ── Ring texture (#2): write peak-held row ───────────────
    const peak = params.peakBins;
    const rowOffset = this.ringRow * 128;
    for (let i = 0; i < 128; i++) {
      this.ringData[rowOffset + i] = i < peak.length ? peak[i] : 0;
    }
    this.device.queue.writeTexture(
      { texture: this.ringTexture }, this.ringData.buffer,
      { bytesPerRow: 128 * 4 }, { width: 128, height: 64 },
    );
    this.ringRow = (this.ringRow + 1) % 64;

    // ── Render: direct to swap chain ──────────────────────────
    // Feedback reads from the ping-pong offscreen texture (prev frame).
    // We render to swap chain AND to the offscreen fb for next frame's feedback.
    const bindGroup = this.pingPong ? this.bindGroupA! : this.bindGroupB!;
    const feedbackTarget = this.pingPong ? this.fbA! : this.fbB!;
    this.pingPong = !this.pingPong;

    const encoder = this.device.createCommandEncoder();

    // Pass 1: render to swap chain (display)
    const swapChainView = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: swapChainView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    // Pass 2: render same frame to offscreen fb (for next frame's feedback)
    const fbPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: feedbackTarget.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    fbPass.setPipeline(this.pipeline);
    fbPass.setBindGroup(0, bindGroup);
    fbPass.draw(3);
    fbPass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.uniformBuffer.destroy();
    this.fftTexture.destroy();
    this.ringTexture.destroy();
    this.fbA?.destroy();
    this.fbB?.destroy();
    this.device.destroy();
  }

  get destroyed(): boolean { return this._destroyed; }
}
