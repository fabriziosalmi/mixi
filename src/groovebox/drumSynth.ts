/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Drum Synthesizer (pure WebAudio, no samples needed)
//
// Generates one-shot AudioBuffers for kick, snare, hi-hat,
// and perc using synthesis. Buffers are created once at init
// and reused for every trigger via AudioBufferSourceNode.
// ─────────────────────────────────────────────────────────────

import type { VoiceId } from './types';

const SAMPLE_RATE = 44_100;

/** Pre-rendered drum buffers, one per voice. */
export class DrumSynth {
  readonly buffers: Record<VoiceId, AudioBuffer>;

  constructor(ctx: AudioContext) {
    this.buffers = {
      kick:  renderKick(ctx),
      snare: renderSnare(ctx),
      hat:   renderHat(ctx),
      perc:  renderPerc(ctx),
    };
  }
}

// ── Kick: sine pitch-sweep 150→50 Hz, 200 ms ───────────────

function renderKick(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(SAMPLE_RATE * 0.25);
  const buf = ctx.createBuffer(1, len, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 12);
    const freq = 50 + 100 * Math.exp(-t * 30);
    data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.9;
  }
  return buf;
}

// ── Snare: noise burst + 200 Hz body, 150 ms ───────────────

function renderSnare(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(SAMPLE_RATE * 0.18);
  const buf = ctx.createBuffer(1, len, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const noiseEnv = Math.exp(-t * 20);
    const bodyEnv = Math.exp(-t * 30);
    const noise = (Math.random() * 2 - 1) * noiseEnv * 0.5;
    const body = Math.sin(2 * Math.PI * 200 * t) * bodyEnv * 0.4;
    data[i] = noise + body;
  }
  return buf;
}

// ── Hi-hat: high-pass noise, 80 ms ─────────────────────────

function renderHat(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(SAMPLE_RATE * 0.08);
  const buf = ctx.createBuffer(1, len, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  // Simple high-pass: first-order difference
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 50);
    const raw = (Math.random() * 2 - 1) * env * 0.35;
    data[i] = raw - prev;
    prev = raw;
  }
  return buf;
}

// ── Perc: metallic ping 800 Hz, 100 ms ─────────────────────

function renderPerc(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(SAMPLE_RATE * 0.1);
  const buf = ctx.createBuffer(1, len, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 35);
    // Two detuned oscillators for metallic character
    data[i] = (
      Math.sin(2 * Math.PI * 800 * t) * 0.3 +
      Math.sin(2 * Math.PI * 1127 * t) * 0.2
    ) * env;
  }
  return buf;
}
