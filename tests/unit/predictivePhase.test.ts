import { describe, it, expect, beforeEach } from 'vitest';
import { PhasePredictor } from '../../src/audio/predictivePhase';

describe('Predictive Phase — Linear Regression Extrapolation', () => {
  let predictor: PhasePredictor;

  beforeEach(() => {
    predictor = new PhasePredictor();
  });

  it('returns 0 with insufficient data (< 5 samples)', () => {
    expect(predictor.update('A', 0.01)).toBe(0);
    expect(predictor.update('A', 0.02)).toBe(0);
    expect(predictor.update('A', 0.03)).toBe(0);
    expect(predictor.update('A', 0.04)).toBe(0);
    // 5th sample → now has enough data, returns non-zero for trending input
    const fifth = predictor.update('A', 0.05);
    expect(fifth).not.toBe(0);
  });

  it('returns non-zero correction after 5+ samples with a trend', () => {
    // Feed an upward drift: 0.00, 0.01, 0.02, 0.03, 0.04, 0.05
    for (let i = 0; i < 5; i++) predictor.update('A', i * 0.01);
    const correction = predictor.update('A', 0.05);
    expect(correction).not.toBe(0);
  });

  it('predicts positive drift → returns negative correction (counteract)', () => {
    // Increasing delta = slave drifting behind → need to speed up
    // Correction should be negative (counteracts predicted positive drift)
    for (let i = 0; i < 8; i++) predictor.update('A', i * 0.01);
    const correction = predictor.update('A', 0.08);
    expect(correction).toBeLessThan(0);
  });

  it('predicts negative drift → returns positive correction', () => {
    // Decreasing delta = slave drifting ahead
    for (let i = 0; i < 8; i++) predictor.update('A', -i * 0.01);
    const correction = predictor.update('A', -0.08);
    expect(correction).toBeGreaterThan(0);
  });

  it('returns ~0 correction for constant (zero-slope) data', () => {
    // No drift: all deltas are the same → slope ≈ 0
    for (let i = 0; i < 10; i++) predictor.update('A', 0.0);
    const correction = predictor.update('A', 0.0);
    expect(Math.abs(correction)).toBeLessThan(0.001);
  });

  it('applies 50% damping (correction < predicted drift)', () => {
    // Strong positive trend
    for (let i = 0; i < 10; i++) predictor.update('A', i * 0.02);
    const correction = predictor.update('A', 0.20);
    // Without damping the magnitude would be larger
    // With 50% damping, the correction magnitude should be moderate
    expect(Math.abs(correction)).toBeLessThan(0.2);
  });

  it('maintains independent state per deck', () => {
    // Deck A: positive drift
    for (let i = 0; i < 8; i++) predictor.update('A', i * 0.01);
    const corrA = predictor.update('A', 0.08);

    // Deck B: no drift
    for (let i = 0; i < 8; i++) predictor.update('B', 0.0);
    const corrB = predictor.update('B', 0.0);

    expect(Math.abs(corrA)).toBeGreaterThan(Math.abs(corrB));
  });

  it('reset(deckId) clears only that deck', () => {
    for (let i = 0; i < 8; i++) predictor.update('A', i * 0.01);
    for (let i = 0; i < 8; i++) predictor.update('B', i * 0.01);

    predictor.reset('A');

    // Deck A starts fresh → returns 0 (insufficient data)
    expect(predictor.update('A', 0.01)).toBe(0);

    // Deck B still has data → returns non-zero
    const corrB = predictor.update('B', 0.09);
    expect(corrB).not.toBe(0);
  });

  it('resetAll() clears all decks', () => {
    for (let i = 0; i < 8; i++) predictor.update('A', i * 0.01);
    for (let i = 0; i < 8; i++) predictor.update('B', i * 0.01);

    predictor.resetAll();

    expect(predictor.update('A', 0.01)).toBe(0);
    expect(predictor.update('B', 0.01)).toBe(0);
  });

  it('sliding window discards old samples (max 20)', () => {
    // Feed 30 samples with positive drift
    for (let i = 0; i < 30; i++) predictor.update('A', i * 0.001);

    // Then feed 30 samples with opposite drift
    for (let i = 0; i < 30; i++) predictor.update('A', 0.03 - i * 0.001);

    const correction = predictor.update('A', 0.0);
    // Should reflect recent negative trend, not old positive trend
    expect(correction).toBeGreaterThan(0); // counteracts negative drift
  });
});
