import { describe, it, expect, beforeEach } from 'vitest';
import { JitterEstimator } from '../../src/sync/jitter';
import { PhaseLock } from '../../src/sync/PhaseLock';

const SENDER = 42;
const PERIOD_MS = 20;

describe('JitterEstimator (RFC 3550 interarrival jitter)', () => {
  let je: JitterEstimator;

  beforeEach(() => {
    je = new JitterEstimator();
  });

  it('reads zero for perfectly regular packets, whatever the clock offset', () => {
    // Sender clock is ~1000 s ahead of ours: only differences matter.
    for (let i = 0; i < 200; i++) {
      je.onPacket(SENDER, 1000 + (i * PERIOD_MS) / 1000, 5 + i * PERIOD_MS);
    }
    expect(je.jitterMs).toBeCloseTo(0, 6);
  });

  it('converges to the mean |D| when arrivals alternate ±delay', () => {
    // Arrivals alternate +30 ms late / on time, so every |D| is 30 ms.
    for (let i = 0; i < 400; i++) {
      const late = i % 2 === 0 ? 30 : 0;
      je.onPacket(SENDER, (i * PERIOD_MS) / 1000, i * PERIOD_MS + late);
    }
    expect(je.jitterMs).toBeGreaterThan(29);
    expect(je.jitterMs).toBeLessThan(31);
  });

  it('restarts the estimate when the sender changes', () => {
    for (let i = 0; i < 400; i++) {
      je.onPacket(SENDER, (i * PERIOD_MS) / 1000, i * PERIOD_MS + (i % 2 ? 0 : 80));
    }
    expect(je.jitterMs).toBeGreaterThan(50);
    je.onPacket(SENDER + 1, 0, 100_000);
    expect(je.jitterMs).toBe(0);
  });

  it('does not count a sender clock jump as jitter', () => {
    // Sender's AudioContext has been running for 10 minutes...
    for (let i = 0; i < 50; i++) je.onPacket(SENDER, 600 + (i * PERIOD_MS) / 1000, i * PERIOD_MS);
    // ...then restarts it: the timestamp drops back near zero.
    je.onPacket(SENDER, 0.001, 50 * PERIOD_MS);
    expect(je.jitterMs).toBeCloseTo(0, 6);
  });

  it('drives PhaseLock into tempo-match on a sustained bad link, and only then', () => {
    const run = (lateMs: number) => {
      const est = new JitterEstimator();
      const pl = new PhaseLock();
      pl.start();
      for (let i = 0; i < 400; i++) {
        const late = i % 2 === 0 ? lateMs : 0;
        const j = est.onPacket(SENDER, (i * PERIOD_MS) / 1000, i * PERIOD_MS + late);
        pl.onHeartbeat(0.5, 128, 0.5, 128, 0.8, j);
      }
      return pl.mode;
    };
    expect(run(5)).toBe('phase-lock');
    expect(run(80)).toBe('tempo-match');
  });
});
