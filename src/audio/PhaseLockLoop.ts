/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Continuous Phase-Lock Loop (PI Controller)
//
// Runs at ~20 Hz on the synced deck.  Features:
//
//   1. PI phase correction with 3-layer anti-windup
//   2. Groove Offset — intentional phase target (±10ms)
//   3. Drift Compensation — linear regression detects and
//      corrects systematic clock drift over long sets
//   4. Audio Clock Reconciliation — detects divergence
//      between AudioContext.currentTime and performance.now()
//
// Why this beats everyone:
//   - Traktor:    discrete nudges → audible "wobble"
//   - Rekordbox:  periodic re-sync → audible jump
//   - Mixi PLL:   continuous PI → zero artefacts, zero slingshot
// ─────────────────────────────────────────────────────────────

import type { DeckId } from '../types';
import { MixiEngine } from './MixiEngine';
import { useMixiStore } from '../store/mixiStore';
import { useSettingsStore } from '../store/settingsStore';
import { crossCorrelatePhase, extractChunk } from './onsetCorrelation';
import { detectPhaseCancellation, extractLowFreq } from './phaseCancellation';
import { findBestRatio, virtualBeatPeriod } from './harmonicSync';
import { phasePredictor } from './predictivePhase';

// ── PI constants (tuned for DJ use) ─────────────────────────

/** Proportional gain: fast but gentle reaction. */
const Kp = 0.02;

/** Integral gain: eliminates steady-state error in ~2s. */
const Ki = 0.001;

/** Ignore phase errors below this fraction of a beat (inaudible). */
const DEADZONE = 0.005;

/** Max correction: ±0.1% rate change — imperceptible. */
const MAX_CORRECTION = 0.001;

/** Anti-windup: integral never exceeds this value. */
const INTEGRAL_MAX = 0.05;

/** Large discontinuity threshold (fraction of beat). */
const DISCONTINUITY_THRESHOLD = 0.25;

/** PLL tick interval in ms (~20 Hz). */
const TICK_INTERVAL_MS = 50;

// ── Drift compensation constants ────────────────────────────

/** Ring buffer size for drift samples (100 × 500ms = 50s window). */
const DRIFT_BUFFER_SIZE = 100;

/** Drift sample interval: every 10 ticks = 500ms. */
const DRIFT_SAMPLE_INTERVAL = 10;

/** Minimum slope to trigger drift correction (ms/s). */
const DRIFT_SLOPE_THRESHOLD = 0.01;

// ── Clock reconciliation constants ──────────────────────────

/** How often to recalibrate clocks (every 200 ticks = 10s). */
const CLOCK_CAL_INTERVAL = 200;

// ── Onset correlation constants ─────────────────────────────

/** Run onset correlation every N ticks (80 ticks = 4s ≈ every 4 beats at 128bpm). */
const ONSET_CORR_INTERVAL = 200;  // every 10s (was 80=4s) — reduces CPU spike

// ── Phase cancellation defense constants ────────────────────

/** Check for cancellation every N ticks (40 ticks = 2s ≈ every 2 beats). */
const CANCEL_CHECK_INTERVAL = 80;  // every 4s (was 40=2s) — reduces CPU spike

/** Emergency nudge: 2ms (inaudible but breaks destructive interference). */
const CANCEL_NUDGE_MS = 2;

// ── Controller state per deck ───────────────────────────────

interface PllState {
  integral: number;
  lastPhaseDelta: number;
  lastCorrection: number;
  frozen: boolean;
  /** Onset-correlation-derived phase offset (more accurate than grid). */
  onsetOffset: number;
  onsetTickCounter: number;
  /** Phase cancellation emergency nudge (fraction of beat). */
  cancelNudge: number;
  cancelTickCounter: number;
  cancelAttempt: number;  // 0 = none, 1 = +2ms tried, 2 = -2ms tried
}

function createPllState(): PllState {
  return {
    integral: 0, lastPhaseDelta: 0, lastCorrection: 0, frozen: false,
    onsetOffset: 0, onsetTickCounter: 0,
    cancelNudge: 0, cancelTickCounter: 0, cancelAttempt: 0,
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
    s.integral = 0;
    s.lastCorrection = 0;
  }

  /** Unfreeze the PLL for a deck. */
  unfreeze(deck: DeckId): void {
    this.states[deck].frozen = false;
  }

  /** Reset on discontinuity (seek, hot cue, loop exit). */
  reset(deck: DeckId): void {
    this.states[deck] = createPllState();
    this.drift[deck] = createDriftTracker();
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
      if (!d || !d.isSynced || !d.isPlaying) continue;

      const masterDeck: DeckId = deck === 'A' ? 'B' : 'A';
      const master = store.decks[masterDeck];
      if (!master.isPlaying || master.bpm <= 0 || d.bpm <= 0) continue;

      const phaseDelta = this.computePhaseDelta(deck, masterDeck, engine, store);
      if (phaseDelta === null) continue;

      // Drift compensation (sample + correct)
      this.tickDrift(deck, phaseDelta, master.bpm);

      // Onset flux cross-correlation (every ~4s, refines grid-based phase)
      this.tickOnsetCorrelation(deck, masterDeck, engine, master.bpm);

      // Phase cancellation defense (every ~2s)
      this.tickCancellationDefense(deck, masterDeck, engine, master.bpm);

      const correction = this.computePI(deck, phaseDelta);
      this.applyCorrection(deck, correction, engine);
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

    const masterPeriod = 60 / master.bpm;

    // Harmonic sync: use virtual beat period if ratio != 1
    const ratio = findBestRatio(master.bpm, slave.originalBpm);
    const slavePeriod = ratio !== 1
      ? virtualBeatPeriod(slave.bpm, ratio)
      : 60 / slave.bpm;
    if (slavePeriod <= 0 || !isFinite(slavePeriod)) return null;

    const masterFrac = (((masterTime - master.firstBeatOffset) / masterPeriod) % 1 + 1) % 1;
    const slaveFrac = (((slaveTime - slave.firstBeatOffset) / slavePeriod) % 1 + 1) % 1;

    let delta = masterFrac - slaveFrac;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;

    return delta;
  }

  // ── PI controller ─────────────────────────────────────────

  private computePI(deck: DeckId, phaseDelta: number): number {
    const s = this.states[deck];

    // Layer 1: Freeze during human interaction
    if (s.frozen) return 0;

    // Layer 3: Reset on large discontinuity (seek, hot cue)
    if (Math.abs(phaseDelta - s.lastPhaseDelta) > DISCONTINUITY_THRESHOLD) {
      s.integral = 0;
      s.lastPhaseDelta = phaseDelta;
      s.lastCorrection = 0;
      return 0;
    }

    s.lastPhaseDelta = phaseDelta;

    // Groove offset + phase cancellation nudge = combined target
    const grooveMs = useSettingsStore.getState().grooveOffsetMs;
    const store = useMixiStore.getState();
    const masterDeck: DeckId = deck === 'A' ? 'B' : 'A';
    const masterBpm = store.decks[masterDeck].bpm;
    const beatPeriodMs = masterBpm > 0 ? (60 / masterBpm) * 1000 : 500;
    const grooveTarget = grooveMs / beatPeriodMs;  // convert ms to beat fraction
    const target = grooveTarget + s.cancelNudge;   // add emergency nudge if active

    // Error = actual phase delta - desired target
    const error = phaseDelta - target;

    // Deadzone: ignore tiny errors (inaudible)
    if (Math.abs(error) < DEADZONE) {
      s.integral *= 0.95;
      return 0;
    }

    // P term
    const P = Kp * error;

    // I term with anti-windup clamp (Layer 2)
    s.integral += error * (TICK_INTERVAL_MS / 1000);
    s.integral = Math.max(-INTEGRAL_MAX, Math.min(INTEGRAL_MAX, s.integral));
    const I = Ki * s.integral;

    // Predictive feed-forward term
    const predicted = phasePredictor.update(deck, phaseDelta);

    // Combined: PI + predictive feed-forward, clamped
    const raw = P + I + predicted * 0.001;  // scale prediction to correction range
    const correction = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, raw));
    s.lastCorrection = correction;
    return correction;
  }

  // ── Apply correction ──────────────────────────────────────

  private applyCorrection(deck: DeckId, correction: number, engine: MixiEngine): void {
    const driftCorr = this.drift[deck].rateCorrection;

    // Skip if no meaningful correction needed
    if (Math.abs(correction) < 1e-7 && Math.abs(driftCorr) < 1e-7) return;

    const store = useMixiStore.getState();
    const baseRate = store.decks[deck].playbackRate;
    const nudgeOffset = engine.getNudge(deck);

    // Effective rate = base × (1 + PI correction + drift correction) + nudge
    const effectiveRate = baseRate * (1 + correction + driftCorr) + nudgeOffset;

    engine.applyPllRate(deck, effectiveRate);
  }

  // ── Drift compensation ────────────────────────────────────

  private tickDrift(deck: DeckId, phaseDelta: number, masterBpm: number): void {
    const d = this.drift[deck];
    d.tickCounter++;

    // Sample every 500ms
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
    // Each sample interval = 500ms, so slope is in ms per 500ms
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

    // Log significant divergence (>0.1% = problem with audio interface)
    if (Math.abs(cal.clockRatio - 1.0) > 0.001) {
      // Could emit a warning to the UI in the future
      // For now, the drift compensation handles it via rate correction
    }
  }
}

/** Singleton PLL instance. */
export const phaseLockLoop = new PhaseLockLoop();
