/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Groovebox Audio Bus
//
// Per-voice routing with volume, pan, mute & solo.
// Pure WebAudio node graph — zero latency.
//
//   Source → VoiceGain → VoicePan → MuteGain ──┐
//   Source → VoiceGain → VoicePan → MuteGain ──┤
//   Source → VoiceGain → VoicePan → MuteGain ──├─→ BusOutput
//   Source → VoiceGain → VoicePan → MuteGain ──┘
//
// BusOutput connects to DeckChannel.input so the groovebox
// flows through EQ → ColorFX → Fader → Crossfader → Master.
// ─────────────────────────────────────────────────────────────

import { VOICES, type VoiceId } from './types';

export class GrooveboxBus {
  /** Bus output node — connect this to DeckChannel.input. */
  readonly output: GainNode;

  // Per-voice nodes
  private readonly gains: Record<VoiceId, GainNode>;
  private readonly pans: Record<VoiceId, StereoPannerNode>;
  private readonly muteGains: Record<VoiceId, GainNode>;

  // Mute / solo state
  private readonly _mute: Record<VoiceId, boolean>;
  private readonly _solo: Record<VoiceId, boolean>;

  constructor(ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.gains = {} as Record<VoiceId, GainNode>;
    this.pans = {} as Record<VoiceId, StereoPannerNode>;
    this.muteGains = {} as Record<VoiceId, GainNode>;
    this._mute = {} as Record<VoiceId, boolean>;
    this._solo = {} as Record<VoiceId, boolean>;

    for (const v of VOICES) {
      // Volume
      const g = ctx.createGain();
      g.gain.value = 0.8;

      // Pan
      const p = ctx.createStereoPanner();
      p.pan.value = 0;

      // Mute / solo gate
      const m = ctx.createGain();
      m.gain.value = 1;

      // Wire: gain → pan → muteGain → busOutput
      g.connect(p);
      p.connect(m);
      m.connect(this.output);

      this.gains[v] = g;
      this.pans[v] = p;
      this.muteGains[v] = m;
      this._mute[v] = false;
      this._solo[v] = false;
    }
  }

  /** Node that AudioBufferSourceNodes should connect to. */
  getVoiceInput(voice: VoiceId): GainNode {
    return this.gains[voice];
  }

  // ── Volume ─────────────────────────────────────────────────

  setVoiceVolume(voice: VoiceId, vol: number): void {
    this.gains[voice].gain.value = vol;
  }

  getVoiceVolume(voice: VoiceId): number {
    return this.gains[voice].gain.value;
  }

  // ── Pan ────────────────────────────────────────────────────

  setVoicePan(voice: VoiceId, pan: number): void {
    this.pans[voice].pan.value = Math.max(-1, Math.min(1, pan));
  }

  getVoicePan(voice: VoiceId): number {
    return this.pans[voice].pan.value;
  }

  // ── Mute ───────────────────────────────────────────────────

  setVoiceMute(voice: VoiceId, mute: boolean): void {
    this._mute[voice] = mute;
    this.updateMuteState();
  }

  isVoiceMuted(voice: VoiceId): boolean {
    return this._mute[voice];
  }

  // ── Solo ───────────────────────────────────────────────────

  setVoiceSolo(voice: VoiceId, solo: boolean): void {
    this._solo[voice] = solo;
    this.updateMuteState();
  }

  isVoiceSoloed(voice: VoiceId): boolean {
    return this._solo[voice];
  }

  // ── Cleanup ────────────────────────────────────────────────

  destroy(): void {
    for (const v of VOICES) {
      try { this.gains[v].disconnect(); } catch { /* ok */ }
      try { this.pans[v].disconnect(); } catch { /* ok */ }
      try { this.muteGains[v].disconnect(); } catch { /* ok */ }
    }
    try { this.output.disconnect(); } catch { /* ok */ }
  }

  // ── Internal ───────────────────────────────────────────────

  /**
   * Recalculate every voice's mute gate.
   * When ANY voice has solo: only solo'd + non-muted voices pass audio.
   * When NO voice has solo:  only non-muted voices pass audio.
   */
  private updateMuteState(): void {
    const anySolo = VOICES.some((v) => this._solo[v]);
    for (const v of VOICES) {
      const audible = anySolo
        ? this._solo[v] && !this._mute[v]
        : !this._mute[v];
      const target = audible ? 1 : 0;
      const g = this.muteGains[v].gain;
      // 2ms ramp to avoid clicks on mute/solo toggle
      g.cancelScheduledValues(0);
      g.setTargetAtTime(target, 0, 0.002);
    }
  }
}
