/**
 * Deterministic PLL (Phase Lock Loop) simulator.
 *
 * Replicates the PI controller from src/audio/PhaseLockLoop.ts
 * without requiring AudioContext or MixiEngine. Pure math.
 *
 * Usage:
 *   const sim = createSyncSim(deckA, deckB);
 *   sim.sync();         // initial tempo match + phase seek
 *   sim.tick(100);       // advance 100 PLL ticks (5 seconds)
 *   sim.phaseError;      // current beat-fraction error
 *   sim.convergenceTick; // tick at which error < threshold
 */

import { findBestRatio } from '../../src/audio/harmonicSync';

// ── PI Constants (must match PhaseLockLoop.ts) ───────────────

const Kp = 0.04;
const Ki = 0.002;
const DEADZONE = 0.003;
const MAX_CORRECTION = 0.003;
const INTEGRAL_MAX = 0.05;
const DISCONTINUITY_THRESHOLD = 0.25;
const TICK_MS = 50; // 20 Hz

// ── Transport Simulator ──────────────────────────────────────

export interface SimDeck {
  position: number;     // current position in seconds
  rate: number;         // playback rate (1.0 = normal)
  bpm: number;          // detected BPM (after rate change)
  originalBpm: number;  // native BPM
  offset: number;       // firstBeatOffset in seconds
  isPlaying: boolean;
  isSynced: boolean;
}

export function createDeck(bpm: number, offset = 0, position = 0): SimDeck {
  return {
    position,
    rate: 1.0,
    bpm,
    originalBpm: bpm,
    offset,
    isPlaying: false,
    isSynced: false,
  };
}

// ── PLL State ────────────────────────────────────────────────

interface PllState {
  integral: number;
  lastPhaseDelta: number;
  lastCorrection: number;
  frozen: boolean;
}

function createPllState(): PllState {
  return { integral: 0, lastPhaseDelta: 0, lastCorrection: 0, frozen: false };
}

// ── Phase computation (same as PhaseLockLoop.computePhaseDelta) ──

export function computePhaseError(master: SimDeck, slave: SimDeck): number {
  const masterPeriod = 60 / master.bpm;
  const ratio = findBestRatio(master.bpm, slave.originalBpm);
  const slavePeriod = ratio !== 1 ? (60 / slave.bpm) / ratio : 60 / slave.bpm;

  if (slavePeriod <= 0 || masterPeriod <= 0) return 0;

  const masterFrac = (((master.position - master.offset) / masterPeriod) % 1 + 1) % 1;
  const slaveFrac = (((slave.position - slave.offset) / slavePeriod) % 1 + 1) % 1;

  let delta = masterFrac - slaveFrac;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

// ── PI controller (same as PhaseLockLoop.computePI) ──────────

function computePI(phaseDelta: number, state: PllState): number {
  if (state.frozen) return 0;

  if (Math.abs(phaseDelta - state.lastPhaseDelta) > DISCONTINUITY_THRESHOLD) {
    state.integral = 0;
    state.lastPhaseDelta = phaseDelta;
    state.lastCorrection = 0;
    return 0;
  }

  state.lastPhaseDelta = phaseDelta;

  const error = phaseDelta;

  if (Math.abs(error) < DEADZONE) {
    state.integral *= 0.95;
    return 0;
  }

  const P = Kp * error;
  state.integral += error * (TICK_MS / 1000);
  state.integral = Math.max(-INTEGRAL_MAX, Math.min(INTEGRAL_MAX, state.integral));
  const I = Ki * state.integral;

  const raw = P + I;
  const correction = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, raw));
  state.lastCorrection = correction;
  return correction;
}

// ── Sync Simulator ───────────────────────────────────────────

export interface SyncMetrics {
  phaseErrorAtSync: number;
  phaseErrorAfter1s: number;
  phaseErrorAfter5s: number;
  phaseErrorAfter10s: number;
  convergenceTick: number;    // tick at which |error| < 0.01
  maxPhaseError: number;
  pllCorrections: number[];   // correction at each tick
  phaseHistory: number[];     // phase error at each tick
}

export interface SyncSim {
  master: SimDeck;
  slave: SimDeck;
  pllState: PllState;
  metrics: SyncMetrics;
  tickCount: number;

  play(): void;
  sync(): void;
  tick(n?: number): void;
  advanceTime(seconds: number): void;
  readonly phaseError: number;
}

export function createSyncSim(master: SimDeck, slave: SimDeck): SyncSim {
  const pllState = createPllState();
  const metrics: SyncMetrics = {
    phaseErrorAtSync: 0,
    phaseErrorAfter1s: 0,
    phaseErrorAfter5s: 0,
    phaseErrorAfter10s: 0,
    convergenceTick: -1,
    maxPhaseError: 0,
    pllCorrections: [],
    phaseHistory: [],
  };

  const sim: SyncSim = {
    master,
    slave,
    pllState,
    metrics,
    tickCount: 0,

    get phaseError() {
      return computePhaseError(master, slave);
    },

    play() {
      master.isPlaying = true;
      slave.isPlaying = true;
    },

    sync() {
      // 1. Harmonic ratio
      const masterBpm = master.bpm;
      const ratio = findBestRatio(masterBpm, slave.originalBpm);
      const targetBpm = masterBpm / ratio;
      const newRate = targetBpm / slave.originalBpm;
      const effectiveBpm = Math.round(slave.originalBpm * newRate * 10) / 10;

      // 2. Apply rate
      slave.rate = newRate;
      slave.bpm = effectiveBpm;

      // 3. Phase align (seek)
      const masterPeriod = 60 / masterBpm;
      const slavePeriod = 60 / effectiveBpm;

      if (masterPeriod > 0 && slavePeriod > 0) {
        const masterFrac = (((master.position - master.offset) / masterPeriod) % 1 + 1) % 1;
        const slaveFrac = (((slave.position - slave.offset) / slavePeriod) % 1 + 1) % 1;

        let phaseDelta = masterFrac - slaveFrac;
        if (phaseDelta > 0.5) phaseDelta -= 1;
        if (phaseDelta < -0.5) phaseDelta += 1;

        const seekOffset = phaseDelta * slavePeriod;
        if (Math.abs(seekOffset) > 0.005) {
          slave.position = Math.max(0, slave.position + seekOffset);
        }
      }

      slave.isSynced = true;
      metrics.phaseErrorAtSync = Math.abs(computePhaseError(master, slave));

      // 4. Reset PLL with 4-tick freeze (200ms)
      Object.assign(pllState, createPllState());
      pllState.frozen = true;
      // Freeze is released after 4 ticks in tick()
    },

    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        sim.tickCount++;

        // Unfreeze after 4 ticks (200ms)
        if (sim.tickCount === 5) {
          pllState.frozen = false;
        }

        // Advance both decks
        if (master.isPlaying) master.position += (TICK_MS / 1000) * master.rate;
        if (slave.isPlaying) slave.position += (TICK_MS / 1000) * slave.rate;

        // PLL correction: compute phase error and apply position nudge.
        // In the real engine, this happens via applyPllRate() which
        // micro-adjusts the playback rate. Here we model the net effect
        // as a position correction (equivalent over one tick).
        if (slave.isSynced && slave.isPlaying && master.isPlaying) {
          const delta = computePhaseError(master, slave);
          const correction = computePI(delta, pllState);

          // Apply as position nudge: correction * rate * tick duration
          // This models the "effective rate = rate * (1 + correction)"
          // for one tick: extra distance = rate * correction * dt
          const nudge = slave.rate * correction * (TICK_MS / 1000);
          slave.position += nudge;

          metrics.pllCorrections.push(correction);
          metrics.phaseHistory.push(Math.abs(delta));
          metrics.maxPhaseError = Math.max(metrics.maxPhaseError, Math.abs(delta));

          if (metrics.convergenceTick < 0 && Math.abs(delta) < 0.01) {
            metrics.convergenceTick = sim.tickCount;
          }
        }

        // Record metrics at checkpoints
        if (sim.tickCount === 20) metrics.phaseErrorAfter1s = Math.abs(sim.phaseError);
        if (sim.tickCount === 100) metrics.phaseErrorAfter5s = Math.abs(sim.phaseError);
        if (sim.tickCount === 200) metrics.phaseErrorAfter10s = Math.abs(sim.phaseError);
      }
    },

    advanceTime(seconds: number) {
      const ticks = Math.round(seconds / (TICK_MS / 1000));
      sim.tick(ticks);
    },
  };

  return sim;
}

// ── Bench result type ────────────────────────────────────────

export interface BenchResult {
  name: string;
  tier: string;
  bpmA: { expected: number; detected: number; error: number };
  bpmB: { expected: number; detected: number; error: number };
  syncRatio: { expected: number; actual: number };
  phaseErrorAtSync: number;
  phaseErrorAfter1s: number;
  phaseErrorAfter5s: number;
  convergenceTick: number;
  passed: boolean;
  durationMs: number;
}

// Global results collector
export const benchResults: BenchResult[] = [];

export function recordResult(result: BenchResult) {
  benchResults.push(result);
}
