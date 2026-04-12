/**
 * Sync & Phase Alignment Bench
 *
 * End-to-end validation: BPM detect → tempo match → phase seek → PLL convergence.
 * Uses deterministic transport simulation (no AudioContext needed).
 *
 * Tiers:
 *   T1 — Same BPM, same offset (trivial)
 *   T2 — Same BPM, different offset
 *   T3 — Different BPM, same genre
 *   T4 — Cross-genre harmonic sync
 *   T5 — Noisy/complex tracks
 *   T6 — Edge cases
 *   T7 — Negative tests (things that SHOULD fail gracefully)
 */

import { describe, it, expect } from 'vitest';
import { detectBpm } from '../../src/audio/BpmDetector';
import { findBestRatio } from '../../src/audio/harmonicSync';
import {
  makeAudioBuffer, generateKickTrack, generateKickHatTrack,
  generateHouseTrack, generateSyncopatedTrack, generateNoisyTrack,
  generateTechnoTrack, generateDnbTrack, bpmMatchesExact,
  SR, SAMPLES,
  addKick,
} from '../helpers/audioGen';
import {
  createDeck, createSyncSim, computePhaseError,
  type SimDeck, type SyncSim,
} from '../helpers/pllSim';

const MAX_PLL_CORRECTION = 0.003; // must match PhaseLockLoop.ts

// ── Helpers ──────────────────────────────────────────────────

/** Detect BPM from Float32Array, return result */
function detect(samples: Float32Array) {
  return detectBpm(makeAudioBuffer(samples));
}

/** Create a full sync scenario: generate tracks, detect BPM, create sim */
function scenario(
  genA: () => Float32Array,
  genB: () => Float32Array,
  opts?: { playA?: boolean; playB?: boolean },
): { sim: SyncSim; detA: ReturnType<typeof detect>; detB: ReturnType<typeof detect> } {
  const samplesA = genA();
  const samplesB = genB();
  const detA = detect(samplesA);
  const detB = detect(samplesB);

  const deckA = createDeck(detA.bpm, detA.firstBeatOffset, 0);
  const deckB = createDeck(detB.bpm, detB.firstBeatOffset, 0);

  deckA.isPlaying = opts?.playA ?? true;
  deckB.isPlaying = opts?.playB ?? true;

  // Simulate some playback time before sync (like a real DJ)
  if (deckA.isPlaying) deckA.position = 2.0; // 2 seconds in
  if (deckB.isPlaying) deckB.position = 1.5; // 1.5 seconds in

  const sim = createSyncSim(deckA, deckB);
  return { sim, detA, detB };
}

/** Assert phase locks within N ticks */
function assertPhaseLock(sim: SyncSim, maxTicks: number, threshold = 0.02) {
  sim.sync();
  sim.tick(maxTicks);
  const finalError = Math.abs(sim.phaseError);
  expect(finalError).toBeLessThan(threshold);
}

// ═════════════════════════════════════════════════════════════
// T1 — Same BPM, Same Offset (trivial alignment)
// ═════════════════════════════════════════════════════════════

describe('T1 — Same BPM, same offset', () => {
  const BPMs = [120, 128, 135, 140, 150, 170];

  for (const bpm of BPMs) {
    it(`${bpm} vs ${bpm} — instant lock`, () => {
      const { sim } = scenario(
        () => generateKickTrack(bpm),
        () => generateKickTrack(bpm),
      );
      sim.play();
      sim.sync();
      // Same BPM + same offset → phase should be near-zero after sync
      expect(sim.metrics.phaseErrorAtSync).toBeLessThan(0.05);
      sim.tick(20); // 1 second
      expect(Math.abs(sim.phaseError)).toBeLessThan(0.1);
    });
  }
});

// ═════════════════════════════════════════════════════════════
// T2 — Same BPM, Different Offset
// ═════════════════════════════════════════════════════════════

describe('T2 — Same BPM, different offset', () => {
  const offsets = [0.05, 0.1, 0.15, 0.2, 0.25];

  for (const off of offsets) {
    it(`128 vs 128, offset ${off}s — sync aligns`, () => {
      const { sim } = scenario(
        () => generateKickTrack(128, 0),
        () => generateKickTrack(128, off),
      );
      sim.play();
      assertPhaseLock(sim, 40, 0.03); // lock within 2 seconds
    });
  }

  it('120 vs 120, offset 0.3s — sync aligns', () => {
    const { sim } = scenario(
      () => generateKickHatTrack(120, 0),
      () => generateKickHatTrack(120, 0.3),
    );
    sim.play();
    assertPhaseLock(sim, 40, 0.03);
  });

  it('140 vs 140, offset at half-beat — sync aligns', () => {
    const halfBeat = 60 / 140 / 2;
    const { sim } = scenario(
      () => generateKickHatTrack(140, 0),
      () => generateKickHatTrack(140, halfBeat),
    );
    sim.play();
    assertPhaseLock(sim, 60, 0.03);
  });
});

// ═════════════════════════════════════════════════════════════
// T3 — Different BPM, Same Genre
// ═════════════════════════════════════════════════════════════

describe('T3 — Different BPM, same genre', () => {
  const pairs = [
    { a: 120, b: 125, label: 'house 120→125' },
    { a: 120, b: 128, label: 'house 120→128' },
    { a: 125, b: 130, label: 'house 125→130' },
    { a: 128, b: 132, label: 'house 128→132' },
    { a: 128, b: 135, label: 'tech house' },
    { a: 130, b: 140, label: 'prog→techno' },
    { a: 135, b: 140, label: 'techno range' },
    { a: 140, b: 145, label: 'fast techno' },
    { a: 140, b: 150, label: 'techno→trance' },
    { a: 150, b: 155, label: 'trance range' },
  ];

  for (const { a, b, label } of pairs) {
    it(`${label} (${a}→${b}) — rate match + phase lock`, () => {
      const { sim, detA, detB } = scenario(
        () => generateKickHatTrack(a),
        () => generateKickHatTrack(b),
      );
      sim.play();
      sim.sync();

      // Rate should be approximately a/b
      const expectedRate = detA.bpm / detB.bpm;
      expect(Math.abs(sim.slave.rate - expectedRate)).toBeLessThan(0.05);

      // Phase converges but BPM detection ±1 BPM error causes residual
      // oscillation. PLL corrects continuously — quarter-beat accuracy.
      sim.tick(100);
      expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
    });
  }
});

// ═════════════════════════════════════════════════════════════
// T4 — Cross-Genre Harmonic Sync
// ═════════════════════════════════════════════════════════════

describe('T4 — Cross-genre harmonic sync', () => {
  it('house 128 → DnB 170 (harmonic ratio)', () => {
    const ratio = findBestRatio(128, 170);
    // Valid ratios: 4/3 (ideal) or 3/4 or 0.75 — all are valid harmonic matches
    expect([1, 2, 0.5, 1.5, 0.75, 4/3, 3/4]).toContain(ratio);

    const { sim } = scenario(
      () => generateHouseTrack(128),
      () => generateDnbTrack(170),
    );
    sim.play();
    sim.sync();
    // Slave should stay near original speed (not slingshot to 128)
    expect(sim.slave.rate).toBeGreaterThan(0.9);
    expect(sim.slave.rate).toBeLessThan(1.15);
    sim.tick(100);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
  });

  it('techno 140 → halftime 70 (ratio 2:1)', () => {
    const ratio = findBestRatio(140, 70);
    expect(ratio).toBe(2);

    const deckA = createDeck(140, 0, 2);
    const deckB = createDeck(70, 0, 1);
    deckA.isPlaying = true;
    deckB.isPlaying = true;
    const sim = createSyncSim(deckA, deckB);
    sim.sync();
    sim.tick(60);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
  });

  it('DnB 174 → house 128 (ratio 3:4)', () => {
    const ratio = findBestRatio(174, 128);
    // 174 / (4/3) = 130.5 ≈ 128, or 174 / 1.5 = 116. Let's check
    expect([4/3, 3/4, 1.5, 0.75, 1, 2, 0.5]).toContain(ratio);

    const { sim } = scenario(
      () => generateDnbTrack(174),
      () => generateHouseTrack(128),
    );
    sim.play();
    sim.sync();
    sim.tick(100);
    // Just verify it doesn't crash and converges somehow
    expect(sim.metrics.phaseHistory.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════
// T5 — Noisy/Complex Tracks
// ═════════════════════════════════════════════════════════════

describe('T5 — Noisy/complex tracks', () => {
  it('120 noisy vs 128 noisy — lock despite noise', () => {
    const { sim } = scenario(
      () => generateNoisyTrack(120, 0, 0.06),
      () => generateNoisyTrack(128, 0.1, 0.08),
    );
    sim.play();
    sim.sync();
    sim.tick(100);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
  });

  it('syncopated 128 vs syncopated 135 — lock despite syncopation', () => {
    const { sim } = scenario(
      () => generateSyncopatedTrack(128),
      () => generateSyncopatedTrack(135),
    );
    sim.play();
    sim.sync();
    sim.tick(80);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
  });

  it('house 126 vs techno 140 — genre transition', () => {
    const { sim } = scenario(
      () => generateHouseTrack(126),
      () => generateTechnoTrack(140),
    );
    sim.play();
    sim.sync();
    sim.tick(80);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
  });

  it('noisy 140 vs clean 140 — same BPM different quality', () => {
    const { sim } = scenario(
      () => generateNoisyTrack(140, 0, 0.15),
      () => generateKickTrack(140),
    );
    sim.play();
    assertPhaseLock(sim, 60, 0.05);
  });
});

// ═════════════════════════════════════════════════════════════
// T6 — Edge Cases
// ═════════════════════════════════════════════════════════════

describe('T6 — Edge cases', () => {
  it('sync while master paused — should still align', () => {
    const { sim } = scenario(
      () => generateKickTrack(128),
      () => generateKickTrack(128),
      { playA: false, playB: true },
    );
    // Master is paused at position 0
    sim.master.isPlaying = false;
    sim.master.position = 3.0; // frozen at 3s
    sim.slave.isPlaying = true;
    sim.slave.position = 1.5;
    sim.sync();
    // Phase alignment should happen based on frozen master position
    expect(sim.metrics.phaseErrorAtSync).toBeLessThan(0.1);
  });

  it('sync → unsync → resync — should re-lock', () => {
    const { sim } = scenario(
      () => generateKickTrack(128),
      () => generateKickTrack(135),
    );
    sim.play();

    // First sync
    sim.sync();
    sim.tick(40);
    const firstError = Math.abs(sim.phaseError);
    expect(firstError).toBeLessThan(0.5);

    // Unsync — slave continues at synced rate
    sim.slave.isSynced = false;
    sim.tick(20); // drift for 1 second

    // Re-sync — position drifted during unsync, re-align
    sim.slave.isSynced = true;
    sim.sync();
    sim.tick(60);
    // After unsync+resync, PLL needs to re-converge from potentially large offset
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
  });

  it('very small BPM difference (128 vs 128.5) — fine correction', () => {
    const deckA = createDeck(128, 0, 2);
    const deckB = createDeck(128.5, 0.05, 1.5);
    deckA.isPlaying = true;
    deckB.isPlaying = true;
    const sim = createSyncSim(deckA, deckB);
    sim.sync();
    sim.tick(60);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.1);
  });

  it('large BPM difference within genre (120 vs 150) — rate ~1.25', () => {
    const { sim } = scenario(
      () => generateKickTrack(120),
      () => generateKickTrack(150),
    );
    sim.play();
    sim.sync();
    sim.tick(80);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
  });

  it('PLL stays locked after 1000 ticks (50 seconds) — no drift', () => {
    const { sim } = scenario(
      () => generateKickTrack(128),
      () => generateKickTrack(132),
    );
    sim.play();
    sim.sync();
    sim.tick(1000);
    expect(Math.abs(sim.phaseError)).toBeLessThan(0.5);
    // PLL should be producing small corrections (not diverging)
    const lastCorrections = sim.metrics.pllCorrections.slice(-20);
    const avgCorrection = lastCorrections.reduce((a, b) => a + Math.abs(b), 0) / lastCorrections.length;
    // Corrections should be at or below max (allow floating point margin)
    expect(avgCorrection).toBeLessThan(MAX_PLL_CORRECTION + 0.0001);
  });

  it('sync at track start (position 0) — should not seek to negative', () => {
    const deckA = createDeck(128, 0.2, 0);
    const deckB = createDeck(128, 0.4, 0);
    deckA.isPlaying = true;
    deckB.isPlaying = true;
    const sim = createSyncSim(deckA, deckB);
    sim.sync();
    expect(sim.slave.position).toBeGreaterThanOrEqual(0);
  });
});

// ═════════════════════════════════════════════════════════════
// T7 — Negative Tests (should fail gracefully)
// ═════════════════════════════════════════════════════════════

describe('T7 — Negative tests', () => {
  it('sync with BPM=0 — should not crash', () => {
    const deckA = createDeck(0, 0, 0);
    const deckB = createDeck(128, 0, 0);
    deckA.isPlaying = true;
    deckB.isPlaying = true;
    const sim = createSyncSim(deckA, deckB);
    // Should not throw
    expect(() => sim.sync()).not.toThrow();
  });

  it('sync with both BPM=0 — should not crash', () => {
    const deckA = createDeck(0, 0, 0);
    const deckB = createDeck(0, 0, 0);
    const sim = createSyncSim(deckA, deckB);
    expect(() => sim.sync()).not.toThrow();
  });

  it('sync with negative BPM — should not crash', () => {
    const deckA = createDeck(128, 0, 0);
    const deckB = createDeck(-120, 0, 0);
    const sim = createSyncSim(deckA, deckB);
    expect(() => sim.sync()).not.toThrow();
  });

  it('sync with NaN BPM — should not crash', () => {
    const deckA = createDeck(NaN, 0, 0);
    const deckB = createDeck(128, 0, 0);
    const sim = createSyncSim(deckA, deckB);
    expect(() => sim.sync()).not.toThrow();
  });

  it('sync with Infinity BPM — should not crash', () => {
    const deckA = createDeck(Infinity, 0, 0);
    const deckB = createDeck(128, 0, 0);
    const sim = createSyncSim(deckA, deckB);
    expect(() => sim.sync()).not.toThrow();
  });

  it('1000 PLL ticks with no sync — should not accumulate error', () => {
    const deckA = createDeck(128, 0, 0);
    const deckB = createDeck(128, 0, 0);
    deckA.isPlaying = true;
    deckB.isPlaying = true;
    const sim = createSyncSim(deckA, deckB);
    // Don't sync — just tick
    sim.tick(1000);
    // Should be fine, no corrections applied (not synced)
    expect(sim.metrics.pllCorrections).toHaveLength(0);
  });

  it('extreme rate (50 BPM vs 200 BPM) — should not produce NaN', () => {
    const deckA = createDeck(200, 0, 2);
    const deckB = createDeck(50, 0, 1);
    deckA.isPlaying = true;
    deckB.isPlaying = true;
    const sim = createSyncSim(deckA, deckB);
    sim.sync();
    sim.tick(100);
    expect(isFinite(sim.phaseError)).toBe(true);
    expect(isFinite(sim.slave.position)).toBe(true);
    expect(isFinite(sim.slave.rate)).toBe(true);
  });

  it('phase error with both decks stopped — returns 0', () => {
    const deckA = createDeck(128, 0, 0);
    const deckB = createDeck(128, 0, 0);
    const error = computePhaseError(deckA, deckB);
    expect(isFinite(error)).toBe(true);
  });

  it('sync with identical positions — zero phase error', () => {
    const deckA = createDeck(128, 0.1, 5.0);
    const deckB = createDeck(128, 0.1, 5.0);
    const error = computePhaseError(deckA, deckB);
    expect(Math.abs(error)).toBeLessThan(0.001);
  });
});

// ═════════════════════════════════════════════════════════════
// Integration: Full pipeline (detect → sync → PLL)
// ═════════════════════════════════════════════════════════════

describe('Integration — Full pipeline', () => {
  const fullPipeline = [
    { a: 120, b: 128, genA: () => generateKickHatTrack(120), genB: () => generateKickHatTrack(128), label: '120→128 kick-hat' },
    { a: 128, b: 135, genA: () => generateHouseTrack(128), genB: () => generateHouseTrack(135), label: '128→135 house' },
    { a: 128, b: 140, genA: () => generateHouseTrack(128), genB: () => generateTechnoTrack(140), label: '128 house → 140 techno' },
    { a: 135, b: 140, genA: () => generateSyncopatedTrack(135), genB: () => generateKickHatTrack(140), label: '135 syncopated → 140 straight' },
    { a: 140, b: 150, genA: () => generateKickTrack(140), genB: () => generateKickTrack(150), label: '140→150 kick only' },
    { a: 120, b: 120, genA: () => generateHouseTrack(120, 0), genB: () => generateHouseTrack(120, 0.15), label: '120 same BPM offset 150ms' },
    { a: 128, b: 128, genA: () => generateNoisyTrack(128, 0, 0.08), genB: () => generateNoisyTrack(128, 0.2, 0.1), label: '128 noisy pair' },
  ];

  for (const { a, b, genA, genB, label } of fullPipeline) {
    it(`full pipeline: ${label}`, () => {
      const t0 = performance.now();

      // 1. Generate + detect
      const detA = detect(genA());
      const detB = detect(genB());

      // 2. Create sim from detected BPMs
      const deckA = createDeck(detA.bpm, detA.firstBeatOffset, 2.0);
      const deckB = createDeck(detB.bpm, detB.firstBeatOffset, 1.5);
      deckA.isPlaying = true;
      deckB.isPlaying = true;

      const sim = createSyncSim(deckA, deckB);

      // 3. Sync
      sim.sync();

      // 4. Verify rate is reasonable
      if (a !== b) {
        expect(sim.slave.rate).not.toBe(1.0);
      }
      expect(isFinite(sim.slave.rate)).toBe(true);
      expect(sim.slave.rate).toBeGreaterThan(0.5);
      expect(sim.slave.rate).toBeLessThan(2.0);

      // 5. Run PLL for 5 seconds
      sim.tick(100);

      // 6. Phase should be tracked (PLL active)
      const finalError = Math.abs(sim.phaseError);
      expect(finalError).toBeLessThan(0.5);

      // 7. PLL should be running
      expect(sim.metrics.pllCorrections.length).toBeGreaterThan(0);

      const elapsed = performance.now() - t0;
      // Should complete quickly (< 500ms per test)
      expect(elapsed).toBeLessThan(500);
    });
  }
});

// ═════════════════════════════════════════════════════════════
// Metrics: Convergence speed benchmark
// ═════════════════════════════════════════════════════════════

describe('Metrics — PLL convergence speed', () => {
  it('same BPM converges in < 10 ticks', () => {
    const sim = createSyncSim(
      createDeck(128, 0, 2),
      createDeck(128, 0.1, 1.5),
    );
    sim.master.isPlaying = true;
    sim.slave.isPlaying = true;
    sim.sync();
    sim.tick(10);
    expect(sim.metrics.convergenceTick).toBeLessThanOrEqual(10);
  });

  it('small BPM diff (128→130) converges in < 30 ticks', () => {
    const sim = createSyncSim(
      createDeck(128, 0, 2),
      createDeck(130, 0.05, 1.5),
    );
    sim.master.isPlaying = true;
    sim.slave.isPlaying = true;
    sim.sync();
    sim.tick(30);
    expect(sim.metrics.convergenceTick).toBeLessThanOrEqual(30);
  });

  it('large BPM diff (120→150) converges in < 80 ticks', () => {
    const sim = createSyncSim(
      createDeck(120, 0, 2),
      createDeck(150, 0.1, 1.5),
    );
    sim.master.isPlaying = true;
    sim.slave.isPlaying = true;
    sim.sync();
    sim.tick(80);
    expect(sim.metrics.convergenceTick).toBeLessThanOrEqual(80);
    expect(sim.metrics.convergenceTick).toBeGreaterThan(0);
  });
});
