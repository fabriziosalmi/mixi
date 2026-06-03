/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Phase-Lock Loop Bridge
//
// Bridges low-frequency calculations (Drift compensation, Clock
// reconciliation, Onset correlation, and Phase cancellation defense)
// on the main thread to the real-time PI controller running on the
// AudioWorklet thread.
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../types';
import { MixiEngine } from './MixiEngine';
import { useMixiStore } from '../store/mixiStore';
import { telemetry } from '../utils/TelemetryService';
import { useSettingsStore } from '../store/settingsStore';
import { crossCorrelatePhase, extractChunk } from './onsetCorrelation';
import { detectPhaseCancellation, extractLowFreq } from './phaseCancellation';
import { findBestRatio, virtualBeatPeriod } from './harmonicSync';

// ── Constants (Bridge frequency tuned to 2 Hz / 500 ms) ──────

/** PLL tick interval in ms (2 Hz). */
const TICK_INTERVAL_MS = 500;

// ── Drift compensation constants ────────────────────────────

/** Ring buffer size for drift samples (100 × 500ms = 50s window). */
const DRIFT_BUFFER_SIZE = 100;

/** Drift sample interval: every tick = 500ms. */
const DRIFT_SAMPLE_INTERVAL = 1;

/** Minimum slope to trigger drift correction (ms/s). */
const DRIFT_SLOPE_THRESHOLD = 0.01;

// ── Clock reconciliation constants ──────────────────────────

/** How often to recalibrate clocks (every 20 ticks = 10s). */
const CLOCK_CAL_INTERVAL = 20;

// ── Onset correlation constants ─────────────────────────────

/** Run onset correlation every N ticks (20 ticks = 10s). */
const ONSET_CORR_INTERVAL = 20;

// ── Phase cancellation defense constants ────────────────────

/** Check for cancellation every N ticks (8 ticks = 4s). */
const CANCEL_CHECK_INTERVAL = 8;

/** Emergency nudge: 2ms (inaudible but breaks destructive interference). */
const CANCEL_NUDGE_MS = 2;

// ── Controller state per deck ───────────────────────────────

interface PllState {
  frozen: boolean;
  workletSynced: boolean;
  /** Onset-correlation-derived phase offset (more accurate than grid). */
  onsetOffset: number;
  onsetTickCounter: number;
  /** Phase cancellation emergency nudge (fraction of beat). */
  cancelNudge: number;
  cancelTickCounter: number;
  cancelAttempt: number;  // 0 = none, 1 = +2ms tried, 2 = -2ms tried
  consecutiveErrorTicks: number;
  hasLostLock: boolean;
}

function createPllState(): PllState {
  return {
    frozen: false,
    workletSynced: false,
    onsetOffset: 0, onsetTickCounter: 0,
    cancelNudge: 0, cancelTickCounter: 0, cancelAttempt: 0,
    consecutiveErrorTicks: 0,
    hasLostLock: false,
  };
}

// ── Drift tracker ───────────────────────────────────────────

interface DriftTracker {
  samples: number[];  // ring buffer of phaseDelta values
  writeIdx: number;
  tickCounter: number;
  rateCorrection: number;  // accumulated base rate correction
}

function createDriftTracker(): DriftTracker {
  return { samples: [], writeIdx: 0, tickCounter: 0, rateCorrection: 0 };
}

/** Simple linear regression slope on a ring buffer. */
function linearRegressionSlope(samples: number[]): number {
  const n = samples.length;
  if (n < 10) return 0;  // need minimum data

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += samples[i];
    sumXY += i * samples[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// ── Clock calibration ───────────────────────────────────────

interface ClockCal {
  audioTimeAtSync: number;
  perfTimeAtSync: number;
  clockRatio: number;
  tickCounter: number;
}

function createClockCal(): ClockCal {
  return { audioTimeAtSync: 0, perfTimeAtSync: 0, clockRatio: 1.0, tickCounter: 0 };
}

// ── PLL singleton ───────────────────────────────────────────

class PhaseLockLoop {
  private states: Record<DeckId, PllState> = {
    A: createPllState(),
    B: createPllState(),
  };

  private drift: Record<DeckId, DriftTracker> = {
    A: createDriftTracker(),
    B: createDriftTracker(),
  };

  private clockCal: ClockCal = createClockCal();

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Start the PLL tick loop. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Initialize clock calibration
    const engine = MixiEngine.getInstance();
    if (engine.isInitialized) {
      this.clockCal.audioTimeAtSync = engine.getAudioContextTime();
      this.clockCal.perfTimeAtSync = performance.now();
      this.clockCal.clockRatio = 1.0;
    }

    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  /** Stop the PLL tick loop. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const engine = MixiEngine.getInstance();
    for (const deck of ['A', 'B'] as DeckId[]) {
      if (engine.isInitialized) {
        engine.postWorkletMessage(deck, { type: 'unsync' });
      }
    }
    this.states.A = createPllState();
    this.states.B = createPllState();
    this.drift.A = createDriftTracker();
    this.drift.B = createDriftTracker();
    this.clockCal = createClockCal();
  }

  /** Freeze the PLL for a deck (during human nudge/jog). */
  freeze(deck: DeckId): void {
    const s = this.states[deck];
    s.frozen = true;
    s.workletSynced = false;

    // Direct notification to worklet to stop corrections immediately
    const engine = MixiEngine.getInstance();
    if (engine.isInitialized) {
      engine.postWorkletMessage(deck, { type: 'unsync' });
    }
  }

  /** Unfreeze the PLL for a deck. */
  private markWorkletSynced(deck: DeckId, masterBpm: number, slaveBpm: number, phaseDelta: number): void {
    const s = this.states[deck];
    if (!s.workletSynced) {
      s.workletSynced = true;
      s.consecutiveErrorTicks = 0;
      s.hasLostLock = false;
      telemetry.reportEvent({
        type: 'LOCK_ACQUIRED',
        deck,
        details: { masterBpm, slaveBpm, phaseDelta },
      });
    }
  }

  unfreeze(deck: DeckId): void {
    const s = this.states[deck];
    s.frozen = false;

    // Instantly sync the worklet phase if deck is synced and playing
    const store = useMixiStore.getState();
    const d = store.decks[deck];
    if (d && d.isSynced && d.isPlaying) {
      const masterDeck: DeckId = deck === 'A' ? 'B' : 'A';
      const master = store.decks[masterDeck];
      const engine = MixiEngine.getInstance();
      if (master.isPlaying && master.bpm > 0 && d.bpm > 0 && !master.isSynced && engine.isInitialized) {
        const grooveMs = useSettingsStore.getState().grooveOffsetMs;
        const beatPeriodMs = master.bpm > 0 ? (60 / master.bpm) * 1000 : 500;
        const grooveTarget = grooveMs / beatPeriodMs;
        const target = grooveTarget + s.cancelNudge;

        engine.postWorkletMessage(deck, {
          type: 'sync',
          masterBpm: master.bpm,
          masterOriginalBpm: master.originalBpm,
          masterFirstBeatOffset: master.firstBeatOffset,
          masterTime: engine.getCurrentTime(masterDeck),
          slaveBpm: d.bpm,
          slaveOriginalBpm: d.originalBpm,
          slaveFirstBeatOffset: d.firstBeatOffset,
          slaveTime: engine.getCurrentTime(deck),
          pllTarget: target,
          onsetOffset: s.onsetOffset
        });
        this.markWorkletSynced(deck, master.bpm, d.bpm, 0);
      }
    }
  }

  /** Reset on discontinuity (seek, hot cue, loop exit). */
  reset(deck: DeckId): void {
    this.states[deck] = createPllState();
    this.drift[deck] = createDriftTracker();

    const engine = MixiEngine.getInstance();
    if (engine.isInitialized) {
      engine.postWorkletMessage(deck, { type: 'unsync' });
    }
  }

  /** Audio clock ratio (for external consumers). */
  get audioClockRatio(): number {
    return this.clockCal.clockRatio;
  }

  // ── Core tick ─────────────────────────────────────────────

  private tick(): void {
    const store = useMixiStore.getState();
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    // Clock reconciliation (every ~10s)
    this.tickClockCal(engine);

    for (const deck of ['A', 'B'] as DeckId[]) {
      const d = store.decks[deck];
      const s = this.states[deck];

      // If not synced, not playing, or frozen, keep the worklet unsynced
      if (!d || !d.isSynced || !d.isPlaying || s.frozen) {
        if (s.workletSynced) {
          engine.postWorkletMessage(deck, { type: 'unsync' });
          s.workletSynced = false;
        }
        continue;
      }

      const masterDeck: DeckId = deck === 'A' ? 'B' : 'A';
      const master = store.decks[masterDeck];
      if (!master.isPlaying || master.bpm <= 0 || d.bpm <= 0) {
        if (s.workletSynced) {
          engine.postWorkletMessage(deck, { type: 'unsync' });
          s.workletSynced = false;
        }
        continue;
      }

      // Guard: if master is ALSO synced, skip to prevent circular dependency.
      if (master.isSynced) {
        if (s.workletSynced) {
          engine.postWorkletMessage(deck, { type: 'unsync' });
          s.workletSynced = false;
        }
        continue;
      }

      const phaseDelta = this.computePhaseDelta(deck, masterDeck, engine, store);
      if (phaseDelta === null) continue;

      // If the worklet is not yet synchronized, send the initial sync payload
      if (!s.workletSynced) {
        const grooveMs = useSettingsStore.getState().grooveOffsetMs;
        const beatPeriodMs = master.bpm > 0 ? (60 / master.bpm) * 1000 : 500;
        const grooveTarget = grooveMs / beatPeriodMs;
        const target = grooveTarget + s.cancelNudge;

        engine.postWorkletMessage(deck, {
          type: 'sync',
          masterBpm: master.bpm,
          masterOriginalBpm: master.originalBpm,
          masterFirstBeatOffset: master.firstBeatOffset,
          masterTime: engine.getCurrentTime(masterDeck),
          slaveBpm: d.bpm,
          slaveOriginalBpm: d.originalBpm,
          slaveFirstBeatOffset: d.firstBeatOffset,
          slaveTime: engine.getCurrentTime(deck),
          pllTarget: target,
          onsetOffset: s.onsetOffset
        });
        this.markWorkletSynced(deck, master.bpm, d.bpm, phaseDelta);
      }

      // Observability: detect synchronization lock loss
      const beatPeriod = 60 / master.bpm;
      const errorMs = Math.abs(phaseDelta) * beatPeriod * 1000;
      if (errorMs > 40) { // 40ms phase error is a standard audible limit for beatmatching
        s.consecutiveErrorTicks++;
        if (s.consecutiveErrorTicks >= 4 && !s.hasLostLock) { // 4 consecutive ticks = 2 seconds
          s.hasLostLock = true;
          telemetry.reportEvent({
            type: 'LOCK_LOSS',
            deck,
            details: {
              phaseErrorMs: errorMs,
              phaseErrorBeats: phaseDelta,
              masterBpm: master.bpm,
              slaveBpm: d.bpm,
            },
          });
        }
      } else {
        s.consecutiveErrorTicks = 0;
      }

      // Drift compensation (sample + correct)
      this.tickDrift(deck, phaseDelta, master.bpm);

      // Onset flux cross-correlation (every ~10s, refines grid-based phase)
      this.tickOnsetCorrelation(deck, masterDeck, engine, master.bpm);

      // Phase cancellation defense (every ~4s)
      this.tickCancellationDefense(deck, masterDeck, engine, master.bpm);

      // Push updated drift corrections and target values to the worklet
      const grooveMs = useSettingsStore.getState().grooveOffsetMs;
      const beatPeriodMs = master.bpm > 0 ? (60 / master.bpm) * 1000 : 500;
      const grooveTarget = grooveMs / beatPeriodMs;
      const target = grooveTarget + s.cancelNudge;

      engine.postWorkletMessage(deck, { type: 'setDriftCorrection', value: this.drift[deck].rateCorrection });
      engine.postWorkletMessage(deck, { type: 'updatePllTarget', value: target });
      engine.postWorkletMessage(deck, { type: 'updateOnsetOffset', value: s.onsetOffset });

      // Periodically sync the playheads to reconcile any integration drift
      engine.postWorkletMessage(deck, {
        type: 'updatePlayheads',
        masterTime: engine.getCurrentTime(masterDeck),
        slaveTime: engine.getCurrentTime(deck)
      });
    }
  }

  // ── Phase computation ─────────────────────────────────────

  private computePhaseDelta(
    slaveDeck: DeckId,
    masterDeck: DeckId,
    engine: MixiEngine,
    store: ReturnType<typeof useMixiStore.getState>,
  ): number | null {
    const master = store.decks[masterDeck];
    const slave = store.decks[slaveDeck];

    const masterTime = engine.getCurrentTime(masterDeck);
    const slaveTime = engine.getCurrentTime(slaveDeck);

    const masterPeriod = 60 / master.originalBpm;
    // Guard a missing/zero master BPM (un-analyzed track): masterPeriod would
    // be Infinity/NaN and propagate a NaN delta into the PID controller.
    if (masterPeriod <= 0 || !isFinite(masterPeriod)) return null;

    // Harmonic sync: use virtual beat period if ratio != 1
    const ratio = findBestRatio(master.bpm, slave.originalBpm);
    const slavePeriod = ratio !== 1
      ? virtualBeatPeriod(slave.originalBpm, ratio)
      : 60 / slave.originalBpm;
    if (slavePeriod <= 0 || !isFinite(slavePeriod)) return null;

    const masterFrac = (((masterTime - master.firstBeatOffset) / masterPeriod) % 1 + 1) % 1;
    const slaveFrac = (((slaveTime - slave.firstBeatOffset) / slavePeriod) % 1 + 1) % 1;

    let delta = masterFrac - slaveFrac;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;

    return delta;
  }

  // ── Drift compensation ────────────────────────────────────

  private tickDrift(deck: DeckId, phaseDelta: number, masterBpm: number): void {
    const d = this.drift[deck];
    d.tickCounter++;

    // Sample every tick (since we tick at 500ms)
    if (d.tickCounter % DRIFT_SAMPLE_INTERVAL !== 0) return;

    // Convert phase delta to ms for the ring buffer
    const beatPeriod = 60 / masterBpm;
    const deltaMs = phaseDelta * beatPeriod * 1000;

    if (d.samples.length < DRIFT_BUFFER_SIZE) {
      d.samples.push(deltaMs);
    } else {
      d.samples[d.writeIdx] = deltaMs;
    }
    d.writeIdx = (d.writeIdx + 1) % DRIFT_BUFFER_SIZE;

    // Need at least 20 samples (~10s) for reliable regression
    if (d.samples.length < 20) return;

    // Linear regression: slope = ms drift per sample interval
    // Each sample interval = 500ms
    const slope = linearRegressionSlope(d.samples);
    const slopePerSecond = slope * (1000 / (DRIFT_SAMPLE_INTERVAL * TICK_INTERVAL_MS));

    if (Math.abs(slopePerSecond) > DRIFT_SLOPE_THRESHOLD) {
      // Apply 10% of correction per iteration (smooth convergence)
      const rateCorrectionDelta = -slopePerSecond / (beatPeriod * 1000) * 0.1;
      d.rateCorrection += rateCorrectionDelta;
      // Clamp total drift correction to ±0.05% (safety)
      d.rateCorrection = Math.max(-0.0005, Math.min(0.0005, d.rateCorrection));
    }
  }

  // ── Onset flux cross-correlation ───────────────────────────

  private tickOnsetCorrelation(
    slaveDeck: DeckId,
    masterDeck: DeckId,
    engine: MixiEngine,
    masterBpm: number,
  ): void {
    const s = this.states[slaveDeck];
    s.onsetTickCounter++;
    if (s.onsetTickCounter % ONSET_CORR_INTERVAL !== 0) return;

    const masterBuf = engine.getBuffer(masterDeck);
    const slaveBuf = engine.getBuffer(slaveDeck);
    if (!masterBuf || !slaveBuf) return;

    const beatPeriod = 60 / masterBpm;
    const chunkDuration = beatPeriod * 2;  // 2 beats

    const masterTime = engine.getCurrentTime(masterDeck);
    const slaveTime = engine.getCurrentTime(slaveDeck);

    const masterChunk = extractChunk(masterBuf, masterTime - chunkDuration, chunkDuration);
    const slaveChunk = extractChunk(slaveBuf, slaveTime - chunkDuration, chunkDuration);

    if (masterChunk.length === 0 || slaveChunk.length === 0) return;

    const offset = crossCorrelatePhase(masterChunk, slaveChunk, masterBuf.sampleRate);
    if (offset === null) return;

    // Only use if offset is meaningful (> 5ms)
    if (Math.abs(offset * 1000) > 5) {
      // Store as beat fraction for the PI controller to use
      s.onsetOffset = offset / beatPeriod;
    } else {
      s.onsetOffset = 0;
    }
  }

  // ── Phase cancellation defense ────────────────────────────

  private tickCancellationDefense(
    slaveDeck: DeckId,
    masterDeck: DeckId,
    engine: MixiEngine,
    masterBpm: number,
  ): void {
    const s = this.states[slaveDeck];
    s.cancelTickCounter++;
    if (s.cancelTickCounter % CANCEL_CHECK_INTERVAL !== 0) return;

    // Only check when both EQ lows are open
    const store = useMixiStore.getState();
    const masterEq = store.decks[masterDeck].eq.low;
    const slaveEq = store.decks[slaveDeck].eq.low;
    if (masterEq < -10 || slaveEq < -10) {
      // Bass is killed on at least one deck — no cancellation possible
      s.cancelNudge = 0;
      s.cancelAttempt = 0;
      return;
    }

    const masterBuf = engine.getBuffer(masterDeck);
    const slaveBuf = engine.getBuffer(slaveDeck);
    if (!masterBuf || !slaveBuf) return;

    const beatPeriod = 60 / masterBpm;
    const chunkDuration = beatPeriod * 2;

    const masterTime = engine.getCurrentTime(masterDeck);
    const slaveTime = engine.getCurrentTime(slaveDeck);

    const masterChunk = extractChunk(masterBuf, masterTime - chunkDuration, chunkDuration);
    const slaveChunk = extractChunk(slaveBuf, slaveTime - chunkDuration, chunkDuration);

    if (masterChunk.length === 0 || slaveChunk.length === 0) return;

    const sr = masterBuf.sampleRate;
    const masterLow = extractLowFreq(masterChunk, sr);
    const slaveLow = extractLowFreq(slaveChunk, sr);

    const cancelling = detectPhaseCancellation(masterLow, slaveLow);

    if (cancelling) {
      if (s.cancelAttempt === 0) {
        // First attempt: +2ms nudge
        s.cancelNudge = CANCEL_NUDGE_MS / (beatPeriod * 1000);
        s.cancelAttempt = 1;
      } else if (s.cancelAttempt === 1) {
        // +2ms didn't work, try -2ms
        s.cancelNudge = -CANCEL_NUDGE_MS / (beatPeriod * 1000);
        s.cancelAttempt = 2;
      }
      // If attempt 2 also fails, keep the -2ms nudge (usually resolves)
    } else {
      // No cancellation — clear the emergency nudge
      if (s.cancelAttempt > 0) {
        // Keep the successful nudge, but stop escalating
      } else {
        s.cancelNudge = 0;
      }
    }
  }

  // ── Clock reconciliation ──────────────────────────────────

  private tickClockCal(engine: MixiEngine): void {
    const cal = this.clockCal;
    cal.tickCounter++;

    if (cal.tickCounter % CLOCK_CAL_INTERVAL !== 0) return;
    if (cal.perfTimeAtSync === 0) return;

    const nowAudio = engine.getAudioContextTime();
    const nowPerf = performance.now();

    const expectedAudioElapsed = (nowPerf - cal.perfTimeAtSync) / 1000;
    const actualAudioElapsed = nowAudio - cal.audioTimeAtSync;

    if (expectedAudioElapsed < 1) return;  // too early

    const newRatio = actualAudioElapsed / expectedAudioElapsed;
    // Exponential moving average (α = 0.1)
    cal.clockRatio = cal.clockRatio * 0.9 + newRatio * 0.1;
  }
}

/** Singleton PLL instance. */
export const phaseLockLoop = new PhaseLockLoop();
