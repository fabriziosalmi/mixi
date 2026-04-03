/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Headphone Bus (PFL / Cue Monitoring)
//
// Implements the complete headphone monitoring chain:
//
//   CueGain A ─┐
//               ├─► cueSumBus → cueMixGain ─┐
//   CueGain B ─┘                            ├─► hpSumBus → levelGain → (routing)
//                         masterTapGain ─────┘
//
// CUE / MASTER MIX:
//   Uses equal-power cosine crossfade (same math as the
//   main crossfader).
//
//   mix = 0  →  100 % CUE     (cueMixGain = 1, masterTapGain = 0)
//   mix = 0.5 →  equal blend
//   mix = 1  →  100 % MASTER  (cueMixGain = 0, masterTapGain = 1)
//
//   cueMixGain   = cos(mix × π/2)
//   masterTapGain = sin(mix × π/2)
//
// MONO SPLIT MODE:
//   When enabled, the output stage downmixes both Master and
//   Headphone to mono and routes them to separate ears:
//
//     Left ear  → Headphone (CUE)
//     Right ear → Master
//
//   This uses a ChannelSplitterNode to extract mono from each
//   stereo bus, then a ChannelMergerNode to combine them into
//   a single stereo signal:  L=Cue, R=Master.
//
//   This allows DJs without a 4-channel audio interface to
//   monitor cues through one ear while hearing the master in
//   the other — standard practice for bedroom DJing.
// ─────────────────────────────────────────────────────────────

import { smoothParam } from '../utils/paramSmooth';

export class HeadphoneBus {
  /** Connect deck cueGain outputs here. */
  readonly cueSumBus: GainNode;

  // ── Internal nodes ─────────────────────────────────────────
  private readonly cueMixGain: GainNode;
  private readonly masterTapGain: GainNode;
  private readonly hpSumBus: GainNode;
  private readonly levelGain: GainNode;

  // ── Split mode nodes ───────────────────────────────────────
  private readonly masterSplitter: ChannelSplitterNode;
  private readonly hpSplitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;
  private readonly masterMonoGain: GainNode;
  private readonly hpMonoGain: GainNode;

  // #42: Always-wired routing with crossfade gains
  private readonly stereoPathGain: GainNode;  // master → destination (stereo mode)
  private readonly splitPathGain: GainNode;   // merger → destination (split mode)
  private _wired = false;

  private splitMode = false;
  private ctx: AudioContext;

  /** The master signal source — connect masterBus.output here. */
  readonly masterTapInput: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // ── Cue summing ──────────────────────────────────────────
    // Both deck cueGains connect here.
    this.cueSumBus = ctx.createGain();
    this.cueSumBus.gain.value = 1;

    // ── Cue/Master crossfade ─────────────────────────────────
    this.cueMixGain = ctx.createGain();
    this.cueMixGain.gain.value = 1; // default: all cue

    this.masterTapInput = ctx.createGain();
    this.masterTapInput.gain.value = 1;

    this.masterTapGain = ctx.createGain();
    this.masterTapGain.gain.value = 0; // default: no master in cue

    this.masterTapInput.connect(this.masterTapGain);
    this.cueSumBus.connect(this.cueMixGain);

    // ── Headphone sum ────────────────────────────────────────
    this.hpSumBus = ctx.createGain();
    this.hpSumBus.gain.value = 1;

    this.cueMixGain.connect(this.hpSumBus);
    this.masterTapGain.connect(this.hpSumBus);

    // ── Level control ────────────────────────────────────────
    this.levelGain = ctx.createGain();
    this.levelGain.gain.value = 1;
    this.hpSumBus.connect(this.levelGain);

    // ── Split mode infrastructure ────────────────────────────
    // Pre-create all split nodes so we can switch instantly.

    // Splitters: extract channel 0 (L) from stereo signals.
    this.masterSplitter = ctx.createChannelSplitter(2);
    this.hpSplitter = ctx.createChannelSplitter(2);

    // Mono downmix gains (sum L+R, halve to avoid clipping).
    this.masterMonoGain = ctx.createGain();
    this.masterMonoGain.gain.value = 0.5;
    this.hpMonoGain = ctx.createGain();
    this.hpMonoGain.gain.value = 0.5;

    // Merger: combine two mono signals into L/R.
    this.merger = ctx.createChannelMerger(2);

    // #42: Both routing paths are always wired; we crossfade between them.
    this.stereoPathGain = ctx.createGain();
    this.stereoPathGain.gain.value = 1; // default: stereo active
    this.splitPathGain = ctx.createGain();
    this.splitPathGain.gain.value = 0;  // default: split inactive

    // Wire split path permanently (merger → splitPathGain → destination).
    this.merger.connect(this.splitPathGain);
    this.splitPathGain.connect(ctx.destination);

    // stereoPathGain → destination is wired in init when masterBusOutput
    // is first provided via setSplitMode or setMix.

    // Default: stereo mode.
    // HP does NOT connect to destination — CUE audio must never
    // leak into the master output.  The DJ can only hear CUE
    // by enabling Split Mode (L=CUE, R=Master) or by using a
    // multi-output audio interface (future feature).
    // this.levelGain is left disconnected until split mode is on.
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Set the CUE / MASTER mix knob.
   *
   * mix = 0 → all CUE, mix = 1 → all MASTER.
   * Uses equal-power cosine crossfade.
   */
  setMix(mix: number, masterBusOutput: AudioNode): void {
    const halfPi = Math.PI / 2;
    const cueLevel = Math.cos(mix * halfPi);
    const masterLevel = Math.sin(mix * halfPi);

    smoothParam(this.cueMixGain.gain, cueLevel, this.ctx);
    smoothParam(this.masterTapGain.gain, masterLevel, this.ctx);

    // Ensure master is connected to our tap.
    // Safe to call multiple times — Web Audio deduplicates connections.
    masterBusOutput.connect(this.masterTapInput);
  }

  /** Set headphone output level (0–1). */
  setLevel(value: number): void {
    smoothParam(this.levelGain.gain, value, this.ctx);
  }

  /**
   * Toggle Mono Split mode.
   *
   * #42: Both stereo and split routing paths are always wired.
   * Toggling only crossfades the two path gains over 10ms —
   * no node disconnects, no pops.
   *
   * When ON:
   *   Left ear  = Headphone (CUE mix)
   *   Right ear = Master
   *
   * When OFF:
   *   Both ears = Master (stereo)
   */
  setSplitMode(enabled: boolean, masterBusOutput: AudioNode): void {
    if (this._wired && enabled === this.splitMode) return;
    this._wired = true;
    this.splitMode = enabled;

    const FADE = 0.01; // 10ms crossfade
    const now = this.ctx.currentTime;

    // Ensure master is connected to both paths (idempotent in Web Audio).
    // Stereo path: master → stereoPathGain → destination
    masterBusOutput.connect(this.stereoPathGain);
    this.stereoPathGain.connect(this.ctx.destination);

    // Split path: master → splitter → mono → merger R; HP → splitter → mono → merger L
    masterBusOutput.connect(this.masterSplitter);
    this.masterSplitter.connect(this.masterMonoGain, 0);
    this.masterSplitter.connect(this.masterMonoGain, 1);
    this.masterMonoGain.connect(this.merger, 0, 1);

    this.levelGain.connect(this.hpSplitter);
    this.hpSplitter.connect(this.hpMonoGain, 0);
    this.hpSplitter.connect(this.hpMonoGain, 1);
    this.hpMonoGain.connect(this.merger, 0, 0);

    // Re-establish master tap (safe to call multiple times).
    masterBusOutput.connect(this.masterTapInput);

    if (enabled) {
      // Crossfade: stereo → split
      this.stereoPathGain.gain.setValueAtTime(this.stereoPathGain.gain.value, now);
      this.stereoPathGain.gain.linearRampToValueAtTime(0, now + FADE);
      this.splitPathGain.gain.setValueAtTime(this.splitPathGain.gain.value, now);
      this.splitPathGain.gain.linearRampToValueAtTime(1, now + FADE);
    } else {
      // Crossfade: split → stereo
      this.stereoPathGain.gain.setValueAtTime(this.stereoPathGain.gain.value, now);
      this.stereoPathGain.gain.linearRampToValueAtTime(1, now + FADE);
      this.splitPathGain.gain.setValueAtTime(this.splitPathGain.gain.value, now);
      this.splitPathGain.gain.linearRampToValueAtTime(0, now + FADE);
    }
  }

  destroy(): void {
    this.cueSumBus.disconnect();
    this.cueMixGain.disconnect();
    this.masterTapInput.disconnect();
    this.masterTapGain.disconnect();
    this.hpSumBus.disconnect();
    this.levelGain.disconnect();
    this.masterSplitter.disconnect();
    this.hpSplitter.disconnect();
    this.masterMonoGain.disconnect();
    this.hpMonoGain.disconnect();
    this.merger.disconnect();
    this.stereoPathGain.disconnect();
    this.splitPathGain.disconnect();
  }
}
