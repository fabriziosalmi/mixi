import { describe, it, expect } from 'vitest';
import {
  DECK, DECK_A_BASE, DECK_B_BASE, MASTER, GLOBAL, PARAM_BUS_SIZE,
  deckParam,
} from '../../src/audio/dsp/ParamLayout';

describe('ParamLayout', () => {
  it('total bus size is 512 bytes', () => {
    expect(PARAM_BUS_SIZE).toBe(512);
  });

  it('deck A starts at 0', () => {
    expect(DECK_A_BASE).toBe(0);
  });

  it('deck B starts at 128', () => {
    expect(DECK_B_BASE).toBe(128);
  });

  it('master starts at 256', () => {
    expect(MASTER.GAIN).toBe(256);
  });

  it('global starts at 384', () => {
    expect(GLOBAL.CROSSFADER).toBe(384);
  });

  it('all deck offsets are 4-byte aligned', () => {
    for (const [, offset] of Object.entries(DECK)) {
      expect(offset % 4).toBe(0);
    }
  });

  it('all master offsets are 4-byte aligned', () => {
    for (const [, offset] of Object.entries(MASTER)) {
      expect(offset % 4).toBe(0);
    }
  });

  it('all global offsets are 4-byte aligned', () => {
    for (const [, offset] of Object.entries(GLOBAL)) {
      expect(offset % 4).toBe(0);
    }
  });

  it('deck params fit within 128 bytes', () => {
    const maxOffset = Math.max(...Object.values(DECK));
    expect(maxOffset + 4).toBeLessThanOrEqual(128);
  });

  it('master params fit between 256 and 384', () => {
    for (const [, offset] of Object.entries(MASTER)) {
      expect(offset).toBeGreaterThanOrEqual(256);
      expect(offset + 4).toBeLessThanOrEqual(384);
    }
  });

  it('global params fit between 384 and 512', () => {
    for (const [, offset] of Object.entries(GLOBAL)) {
      expect(offset).toBeGreaterThanOrEqual(384);
      expect(offset + 4).toBeLessThanOrEqual(512);
    }
  });

  it('deckParam resolves A offsets correctly', () => {
    expect(deckParam('A', DECK.TRIM)).toBe(0);
    expect(deckParam('A', DECK.EQ_LOW)).toBe(4);
  });

  it('deckParam resolves B offsets correctly', () => {
    expect(deckParam('B', DECK.TRIM)).toBe(128);
    expect(deckParam('B', DECK.EQ_LOW)).toBe(132);
  });

  // Verify Rust parity: these offsets MUST match engine.rs constants
  it('FX offsets match Rust engine expectations', () => {
    expect(DECK.FX_FLT_AMOUNT).toBe(40);
    expect(DECK.FX_FLT_ACTIVE).toBe(44);
    expect(DECK.FX_DLY_AMOUNT).toBe(48);
    expect(DECK.FX_DLY_ACTIVE).toBe(52);
    expect(DECK.FX_DLY_TIME).toBe(56);
    expect(DECK.FX_DLY_FEEDBACK).toBe(60);
    expect(DECK.FX_REV_AMOUNT).toBe(64);
    expect(DECK.FX_REV_ACTIVE).toBe(68);
    expect(DECK.FX_PHA_AMOUNT).toBe(72);
    expect(DECK.FX_PHA_ACTIVE).toBe(76);
    expect(DECK.FX_FLG_AMOUNT).toBe(80);
    expect(DECK.FX_FLG_ACTIVE).toBe(84);
    expect(DECK.FX_GATE_AMOUNT).toBe(88);
    expect(DECK.FX_GATE_ACTIVE).toBe(92);
  });

  it('no overlapping offsets within deck space', () => {
    const offsets = Object.values(DECK);
    const unique = new Set(offsets);
    expect(unique.size).toBe(offsets.length);
  });
});
