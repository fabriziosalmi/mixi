import { describe, it, expect, beforeEach } from 'vitest';
import { PhaseLock } from '../../src/sync/PhaseLock';

describe('PhaseLock PID Controller', () => {
  let pl: PhaseLock;

  beforeEach(() => {
    pl = new PhaseLock();
  });

  it('starts in off mode with zero correction', () => {
    expect(pl.mode).toBe('off');
    expect(pl.correction).toBe(0);
    expect(pl.locked).toBe(false);
  });

  it('transitions to phase-lock mode on start()', () => {
    pl.start();
    expect(pl.mode).toBe('phase-lock');
  });

  it('returns to off mode on stop()', () => {
    pl.start();
    pl.stop();
    expect(pl.mode).toBe('off');
    expect(pl.correction).toBe(0);
  });

  it('produces zero correction when master and local are in phase', () => {
    pl.start();
    pl.onHeartbeat(0.5, 128, 0.5, 128, 0.8, 0);
    expect(Math.abs(pl.correction)).toBeLessThan(0.001);
  });

  it('produces positive correction when local is behind master', () => {
    pl.start();
    // Large error (0.15) + many iterations to warm up EMA filter
    for (let i = 0; i < 30; i++) pl.onHeartbeat(0.6, 128, 0.4, 128, 0.8, 0);
    expect(pl.correction).toBeGreaterThan(0);
  });

  it('produces negative correction when local is ahead of master', () => {
    pl.start();
    // Error of -0.15 (below snap threshold of 0.20)
    for (let i = 0; i < 30; i++) pl.onHeartbeat(0.3, 128, 0.45, 128, 0.8, 0);
    expect(pl.correction).toBeLessThan(0);
  });

  it('correction is clamped to +/-2%', () => {
    pl.start();
    // Large error: master at 0.0, local at 0.15
    pl.onHeartbeat(0.0, 128, 0.15, 128, 0.8, 0);
    expect(Math.abs(pl.correction)).toBeLessThanOrEqual(0.02);
  });

  it('locks when error falls below 0.2%', () => {
    pl.start();
    // Feed many heartbeats at near-zero error to warm up filter and converge
    for (let i = 0; i < 50; i++) {
      pl.onHeartbeat(0.5, 128, 0.5 + 0.0001, 128, 0.8, 0);
    }
    expect(pl.locked).toBe(true);
    expect(pl.correction).toBe(0);
  });

  it('phase unwrapping: 0.98 error becomes -0.02 (shortest path)', () => {
    pl.start();
    // Master at 0.99, local at 0.01 → error should be -0.02, not +0.98
    // Warm up filter so it tracks the master phase
    for (let i = 0; i < 20; i++) pl.onHeartbeat(0.99, 128, 0.01, 128, 0.8, 0);
    // Correction should be negative (slow down — local is ahead by wrapping)
    expect(pl.correction).toBeLessThan(0);
  });

  it('gain scheduling: silent deck gets higher Kp', () => {
    pl.start();
    const error = 0.05;

    // Silent (vol=0): aggressive correction — warm up filter
    for (let i = 0; i < 30; i++) pl.onHeartbeat(0.5, 128, 0.5 - error, 128, 0.0, 0);
    const silentCorrection = Math.abs(pl.correction);

    // Reset
    pl.stop();
    pl = new PhaseLock();
    pl.start();

    // Loud (vol=1): gentle correction
    for (let i = 0; i < 30; i++) pl.onHeartbeat(0.5, 128, 0.5 - error, 128, 1.0, 0);
    const loudCorrection = Math.abs(pl.correction);

    expect(silentCorrection).toBeGreaterThan(loudCorrection);
  });

  it('does nothing in off mode', () => {
    // Don't start
    pl.onHeartbeat(0.5, 128, 0.0, 128, 0.8, 0);
    expect(pl.correction).toBe(0);
  });

  it('getTargetBpm returns master BPM after heartbeat', () => {
    pl.start();
    pl.onHeartbeat(0.5, 140, 0.5, 128, 0.8, 0);
    expect(pl.getTargetBpm()).toBeCloseTo(140, 0);
  });

  it('tempo slew: small BPM change ramps gradually', () => {
    pl.start();
    pl.onHeartbeat(0.5, 128, 0.5, 128, 0.8, 0);
    // Change by 3 BPM — should ramp, not jump
    pl.onHeartbeat(0.5, 131, 0.5, 128, 0.8, 0);
    const target = pl.getTargetBpm();
    // Should be between 128 and 131 (ramping)
    expect(target).toBeGreaterThanOrEqual(128);
    expect(target).toBeLessThanOrEqual(131);
  });

  it('tempo slew: large BPM change (>5) is instant', () => {
    pl.start();
    pl.onHeartbeat(0.5, 128, 0.5, 128, 0.8, 0);
    // Jump by 20 BPM — instant
    pl.onHeartbeat(0.5, 148, 0.5, 128, 0.8, 0);
    expect(pl.getTargetBpm()).toBeCloseTo(148, 0);
  });

  it('state snapshot contains all fields', () => {
    pl.start();
    pl.onHeartbeat(0.5, 128, 0.45, 128, 0.8, 0);
    const state = pl.state;
    expect(state.mode).toBe('phase-lock');
    expect(typeof state.locked).toBe('boolean');
    expect(typeof state.phaseError).toBe('number');
    expect(typeof state.correction).toBe('number');
    expect(state.masterBpm).toBe(128);
  });

  it('degrades to tempo-match when jitter > 50ms sustained', () => {
    pl.start();
    // Simulate high jitter for 3+ seconds (150+ heartbeats at 20ms)
    for (let i = 0; i < 160; i++) {
      pl.onHeartbeat(0.5, 128, 0.5, 128, 0.8, 60); // 60ms jitter
    }
    expect(pl.mode).toBe('tempo-match');
    expect(pl.correction).toBe(0); // no phase correction in tempo-match
  });

  it('recovers from tempo-match when jitter drops', () => {
    pl.start();
    // High jitter → tempo-match
    for (let i = 0; i < 160; i++) {
      pl.onHeartbeat(0.5, 128, 0.5, 128, 0.8, 60);
    }
    expect(pl.mode).toBe('tempo-match');

    // Low jitter → back to phase-lock
    for (let i = 0; i < 10; i++) {
      pl.onHeartbeat(0.5, 128, 0.5, 128, 0.8, 2);
    }
    expect(pl.mode).toBe('phase-lock');
  });
});
