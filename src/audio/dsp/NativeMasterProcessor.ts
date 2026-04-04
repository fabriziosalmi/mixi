/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Native Master Processor
//
// Wraps the existing WebAudio MasterBus in the DspProcessor
// interface. Reads parameter values from the DspParamBus and
// applies them to the native MasterBus nodes.
// ─────────────────────────────────────────────────────────────

import type { DspProcessor, DspParamBus, DspBackend } from './DspProcessor';
import type { MasterBus } from '../nodes/MasterBus';
import { MASTER } from './ParamLayout';

/**
 * Native WebAudio adapter for the MasterBus.
 */
export class NativeMasterProcessor implements DspProcessor {
  readonly name = 'NativeMaster';
  readonly backend: DspBackend = 'native';

  constructor(
    private readonly master: MasterBus,
    private readonly ctx: AudioContext,
  ) {}

  process(
    _inputs: Float32Array[],
    _outputs: Float32Array[],
    _params: DspParamBus,
    _frames: number,
  ): void {
    // No-op: WebAudio graph handles DSP.
  }

  /**
   * Sync native master bus from the param bus.
   */
  syncFromBus(params: DspParamBus): void {
    const t = this.ctx.currentTime + 0.01;

    // Master gain
    const gain = params.getFloat(MASTER.GAIN);
    this.master.gainNode.gain.linearRampToValueAtTime(gain, t);

    // Master filter (bipolar -1..+1)
    const filter = params.getFloat(MASTER.FILTER);
    this.master.setFilter(filter, this.ctx);

    // Distortion
    const distAmount = params.getFloat(MASTER.DISTORTION);
    this.master.setDistortion(distAmount, this.ctx);

    // Punch
    const punchAmount = params.getFloat(MASTER.PUNCH);
    this.master.setPunch(punchAmount, this.ctx);

    // Limiter threshold
    const limiterActive = params.getBool(MASTER.LIMITER_ACTIVE);
    this.master.limiter.threshold.linearRampToValueAtTime(
      limiterActive ? -1 : 0, t,
    );
  }

  reset(): void {
    // Native nodes reset automatically.
  }

  destroy(): void {
    this.master.destroy();
  }
}
