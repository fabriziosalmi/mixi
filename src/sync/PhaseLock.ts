/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// MIXI Sync — PID Phase Lock Controller
//
// Proportional-Integral-Derivative controller with:
//   - Gain scheduling (aggressive when silent, gentle when audible)
//   - Phase unwrapping (circular shortest-path correction)
//   - Hysteresis (10:1 lock/unlock ratio)
//   - Snap threshold (seek for large errors)
//   - Dead reckoning (extrapolate during packet loss)
//   - Flywheel mode (free-run when master lost)
//   - Tempo slew rate limit (max 1 BPM/second)
// ─────────────────────────────────────────────────────────────

export type SyncMode = 'phase-lock' | 'tempo-match' | 'flywheel' | 'off';

export interface PhaseLockState {
  mode: SyncMode;
  locked: boolean;
  phaseError: number;
  correction: number;
  masterBpm: number;
  localBpm: number;
}

// Gain presets indexed by volume bracket
const GAIN_TABLE = [
  // [volumeThreshold, Kp, Ki, Kd]
  [0.0,  1.0,  0.2,  0.0],   // silent: instant lock
  [0.3,  0.5,  0.1,  0.1],   // quiet
  [0.7,  0.15, 0.03, 0.2],   // audible
  [1.0,  0.05, 0.01, 0.3],   // full: minimal correction
] as const;

export class PhaseLock {
  // PID state
  private integral = 0;
  private prevError = 0;
  private _locked = false;
  private _correction = 0;

  // Timing
  private lastMasterPhase = 0;
  private lastHeartbeatTime = 0;
  private _masterBpm = 0;
  private _localBpm = 0;
  private _mode: SyncMode = 'off';

  private lastTickTime = 0;

  // Jitter filter (EMA)
  private filteredPhase = 0;
  private readonly alpha = 0.15;

  private currentRampBpm = 0;

  // Thresholds
  private readonly UNLOCK_THRESHOLD = 0.02;
  private readonly LOCK_THRESHOLD = 0.002;
  private readonly SNAP_THRESHOLD = 0.20;
  private readonly FLYWHEEL_TIMEOUT_MS = 150;
  private readonly DEGRADATION_JITTER_MS = 50;
  private readonly DEGRADATION_HOLD_MS = 3000;
  private degradationTimer = 0;

  /** Current sync mode. */
  get mode(): SyncMode { return this._mode; }

  /** Whether phase is locked (error < 0.2%). */
  get locked(): boolean { return this._locked; }

  /** Current playback rate correction (applied to slave's playbackRate). */
  get correction(): number { return this._correction; }

  /** Master's BPM (last known or extrapolated). */
  get masterBpm(): number { return this._masterBpm; }

  /** Get full state for UI display. */
  get state(): PhaseLockState {
    return {
      mode: this._mode,
      locked: this._locked,
      phaseError: this.prevError,
      correction: this._correction,
      masterBpm: this._masterBpm,
      localBpm: this._localBpm,
    };
  }

  /** Start phase lock. */
  start(): void {
    this._mode = 'phase-lock';
    this.integral = 0;
    this.prevError = 0;
    this._locked = false;

    this.degradationTimer = 0;
  }

  /** Stop phase lock. */
  stop(): void {
    this._mode = 'off';
    this._correction = 0;
    this._locked = false;
    this.integral = 0;
  }

  /**
   * Process a received heartbeat.
   * @param masterPhase — master's beat phase [0, 1)
   * @param masterBpm — master's BPM
   * @param localPhase — local beat phase [0, 1)
   * @param localBpm — local BPM
   * @param slaveVolume — slave deck volume [0, 1] for gain scheduling
   * @param jitterMs — estimated network jitter in ms
   */
  onHeartbeat(
    masterPhase: number,
    masterBpm: number,
    localPhase: number,
    localBpm: number,
    slaveVolume: number,
    jitterMs: number,
  ): void {
    if (this._mode === 'off') return;

    const now = performance.now();
    this.lastHeartbeatTime = now;

    this._masterBpm = masterBpm;
    this._localBpm = localBpm;

    // ── Jitter filter (EMA) ─────────────────────────────────
    this.filteredPhase = this.alpha * masterPhase + (1 - this.alpha) * this.filteredPhase;

    // ── Graceful degradation: if jitter too high, switch to tempo-match
    if (jitterMs > this.DEGRADATION_JITTER_MS) {
      this.degradationTimer += 20; // ~20ms per heartbeat
      if (this.degradationTimer > this.DEGRADATION_HOLD_MS) {
        this._mode = 'tempo-match';
      }
    } else {
      this.degradationTimer = Math.max(0, this.degradationTimer - 100);
      if (this._mode === 'tempo-match') {
        this._mode = 'phase-lock';
      }
    }

    // ── Tempo matching (BPM follow) ─────────────────────────
    this.updateTempoRamp(masterBpm, now);

    // ── Phase lock (only in phase-lock mode) ────────────────
    if (this._mode === 'phase-lock') {
      this.computePID(this.filteredPhase, localPhase, slaveVolume);
    } else {
      this._correction = 0; // tempo-match: no phase correction
    }
  }

  /**
   * Call every ~20ms even without heartbeat (dead reckoning + flywheel).
   */
  tick(localPhase: number, localBpm: number): void {
    if (this._mode === 'off') return;

    const now = performance.now();
    const elapsed = now - this.lastHeartbeatTime;

    this._localBpm = localBpm;

    // ── Flywheel detection ──────────────────────────────────
    if (this.lastHeartbeatTime > 0 && elapsed > this.FLYWHEEL_TIMEOUT_MS) {
      if (this._mode !== 'flywheel') {
        this._mode = 'flywheel';
        this._correction = 0; // free-run at last known BPM
      }
      return;
    }

    // ── Dead reckoning: extrapolate master phase during gaps
    if (this._mode === 'phase-lock' && elapsed > 30 && this._masterBpm > 0) {
      const beatsElapsed = (elapsed / 1000) * (this._masterBpm / 60);
      const extrapolatedPhase = (this.lastMasterPhase + beatsElapsed) % 1;
      this.computePID(extrapolatedPhase, localPhase, 0.5); // medium aggressiveness
    }
  }

  /** Get the BPM the slave should use (ramped). */
  getTargetBpm(): number {
    return this.currentRampBpm || this._masterBpm;
  }

  // ── Internal ──────────────────────────────────────────────

  private computePID(masterPhase: number, localPhase: number, volume: number): void {
    // Phase unwrapping: shortest path on circular phase
    let error = masterPhase - localPhase;
    if (error > 0.5) error -= 1.0;
    if (error < -0.5) error += 1.0;

    // Snap: if error > 20%, don't PID — signal a seek
    if (Math.abs(error) > this.SNAP_THRESHOLD) {
      this._correction = 0; // caller should seek, not nudge
      return;
    }

    // Hysteresis
    if (this._locked && Math.abs(error) > this.UNLOCK_THRESHOLD) {
      this._locked = false;
    }
    if (!this._locked && Math.abs(error) < this.LOCK_THRESHOLD) {
      this._locked = true;
      this.integral = 0;
    }

    if (this._locked) {
      this._correction = 0;
      this.prevError = error;
      return;
    }

    // Gain scheduling by volume
    const [, kp, ki, kd] = this.getGains(volume);

    // PID
    const derivative = error - this.prevError;
    this.integral += error;
    this.integral = Math.max(-1, Math.min(1, this.integral)); // anti-windup

    let correction = kp * error + ki * this.integral + kd * derivative;

    // Clamp to ±2% (audibility limit)
    correction = Math.max(-0.02, Math.min(0.02, correction));

    this._correction = correction;
    this.prevError = error;
    this.lastMasterPhase = masterPhase;
  }

  private getGains(volume: number): readonly [number, number, number, number] {
    for (let i = GAIN_TABLE.length - 1; i >= 0; i--) {
      if (volume >= GAIN_TABLE[i][0]) return GAIN_TABLE[i];
    }
    return GAIN_TABLE[0];
  }

  private updateTempoRamp(targetBpm: number, now: number): void {
    if (this.currentRampBpm === 0) {
      this.currentRampBpm = targetBpm;
      // targetBpm tracked via currentRampBpm
      this.lastTickTime = now;
      return;
    }

    const deltaBpm = Math.abs(targetBpm - this.currentRampBpm);

    if (deltaBpm > 5) {
      // Large jump (track change): instant
      this.currentRampBpm = targetBpm;
    } else if (deltaBpm > 0.5) {
      // Gradual: max 1 BPM/second slew rate
      const dt = (now - this.lastTickTime) / 1000;
      const maxDelta = dt * 1.0; // 1 BPM/sec
      const step = Math.min(maxDelta, deltaBpm);
      this.currentRampBpm += targetBpm > this.currentRampBpm ? step : -step;
    } else {
      this.currentRampBpm = targetBpm;
    }

    // targetBpm tracked via currentRampBpm
    this.lastTickTime = now;
  }
}
