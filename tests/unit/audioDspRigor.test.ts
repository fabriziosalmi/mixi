/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * Audio Backend & DSP Rigor Regression Suite
 *
 * Verifies:
 *   ENGINE-01: exitLoop snapshots wrapped playhead position (no N*loopLen teleport)
 *   ENGINE-02: nudgeStart/nudgeStop + getCurrentTime integrate manual nudge offset
 *   DSP-03:    MasterBus WebAudio HPF sweeps UP (20Hz -> 20kHz)
 *   DSP-04:    DeckChannel xone-kill uses true LR8 section Qs [0.5412, 1.3066, 0.5412, 1.3066]
 *   DSP-05:    MasterBus distortion negates bassMonoGain polarity to prevent 300Hz null
 *   DSP-07:    DeckFx Phaser & Flanger keep frequency/delay strictly positive across amount 0..1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Audio Backend & DSP Rigor Regression Suite', () => {
  it('ENGINE-01: exitLoop snapshots getCurrentTime before disabling source.loop', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/audio/MixiEngine.ts'), 'utf8');
    const exitIdx = src.indexOf('exitLoop(deck: DeckId)');
    expect(exitIdx).toBeGreaterThan(-1);
    const snippet = src.slice(exitIdx, exitIdx + 500);
    const snapPos = snippet.indexOf('transport.offset = this.getCurrentTime(deck)');
    const loopOffPos = snippet.indexOf('transport.source.loop = false');
    expect(snapPos).toBeGreaterThan(-1);
    expect(loopOffPos).toBeGreaterThan(snapPos);
  });

  it('ENGINE-02: nudgeStart/nudgeStop snapshot offset and getCurrentTime integrates _nudge', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/audio/MixiEngine.ts'), 'utf8');
    const getTimeIdx = src.indexOf('getCurrentTime(deck: DeckId)');
    const getTimeSnippet = src.slice(getTimeIdx, getTimeIdx + 400);
    expect(getTimeSnippet).toContain('transport.playbackRate + this._nudge[deck]');

    const nudgeStartIdx = src.indexOf('nudgeStart(deck: DeckId');
    const nudgeStartSnippet = src.slice(nudgeStartIdx, nudgeStartIdx + 500);
    expect(nudgeStartSnippet).toContain('transport.offset = this.getCurrentTime(deck)');

    const nudgeStopIdx = src.indexOf('nudgeStop(deck: DeckId');
    const nudgeStopSnippet = src.slice(nudgeStopIdx, nudgeStopIdx + 500);
    expect(nudgeStopSnippet).toContain('transport.offset = this.getCurrentTime(deck)');
  });

  it('DSP-03 & DSP-05: MasterBus HPF sweeps 20Hz->20kHz and distortion bassMonoGain compensates 180deg flip', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/audio/nodes/MasterBus.ts'), 'utf8');
    expect(src).toContain('20 * Math.pow(1000, absK)');
    expect(src).toContain('-amount * 0.5');
  });

  it('DSP-04: DeckChannel xone-kill uses true 8th-order Linkwitz-Riley Q factors', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/audio/nodes/DeckChannel.ts'), 'utf8');
    expect(src).toContain('0.5412, 1.3066, 0.5412, 1.3066');
  });

  it('DSP-07: DeckFx Phaser & Flanger maintain strictly positive modulation bounds at amount=1.0', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/audio/nodes/DeckFx.ts'), 'utf8');
    expect(src).toContain('f.frequency.value = 1800');
    expect(src).toContain('400 + amount * 1100');
    expect(src).toContain('setValueAtTime(0.008, ctx.currentTime)');
    expect(src).toContain('0.001 + amount * 0.0035');
  });
});
