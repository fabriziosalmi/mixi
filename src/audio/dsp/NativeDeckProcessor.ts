/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Native Deck Processor
//
// Wraps the existing WebAudio DeckChannel in the DspProcessor
// interface. This adapter reads from the DspParamBus and
// applies values to the native BiquadFilter/GainNode instances.
//
// In Native mode, the WebAudio graph does the actual DSP —
// this class only syncs parameter values from the bus.
// ─────────────────────────────────────────────────────────────

import type { DspProcessor, DspParamBus, DspBackend } from './DspProcessor';
import type { DeckChannel } from '../nodes/DeckChannel';
import { DECK, DECK_A_BASE, DECK_B_BASE } from './ParamLayout';
import type { DeckId } from '../../types';

/**
 * Native WebAudio adapter for a DeckChannel.
 *
 * Reads parameters from the DspParamBus and applies them
 * to the underlying WebAudio nodes. The actual audio
 * processing is done by the browser's native implementation.
 */
export class NativeDeckProcessor implements DspProcessor {
  readonly name: string;
  readonly backend: DspBackend = 'native';
  private readonly base: number;

  constructor(
    private readonly channel: DeckChannel,
    private readonly ctx: AudioContext,
    deck: DeckId,
  ) {
    this.name = `NativeDeck_${deck}`;
    this.base = deck === 'A' ? DECK_A_BASE : DECK_B_BASE;
  }

  /**
   * In Native mode, process() is a no-op.
   * The WebAudio graph processes audio natively.
   */
  process(
    _inputs: Float32Array[],
    _outputs: Float32Array[],
    _params: DspParamBus,
    _frames: number,
  ): void {
    // No-op: WebAudio graph handles DSP.
  }

  /**
   * Sync native node parameters from the param bus.
   * Called from the main thread's sync loop (~60Hz).
   */
  syncFromBus(params: DspParamBus): void {
    const b = this.base;
    const t = this.ctx.currentTime + 0.01; // 10ms ramp

    // Trim
    this.channel.trimGain.gain.linearRampToValueAtTime(
      params.getFloat(b + DECK.TRIM), t,
    );

    // EQ
    this.channel.eqLow.gain.linearRampToValueAtTime(
      params.getFloat(b + DECK.EQ_LOW), t,
    );
    this.channel.eqMid.gain.linearRampToValueAtTime(
      params.getFloat(b + DECK.EQ_MID), t,
    );
    this.channel.eqHigh.gain.linearRampToValueAtTime(
      params.getFloat(b + DECK.EQ_HIGH), t,
    );

    // Fader
    this.channel.faderGain.gain.linearRampToValueAtTime(
      params.getFloat(b + DECK.FADER), t,
    );

    // Crossfader gain
    this.channel.xfaderGain.gain.linearRampToValueAtTime(
      params.getFloat(b + DECK.XFADER_GAIN), t,
    );

    // CUE
    this.channel.cueGain.gain.linearRampToValueAtTime(
      params.getBool(b + DECK.CUE_ACTIVE) ? 1 : 0, t,
    );
  }

  reset(): void {
    // Native nodes reset automatically on disconnect/reconnect.
  }

  destroy(): void {
    this.channel.destroy();
  }
}
