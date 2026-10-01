/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// MIXI Sync — Interarrival Jitter Estimator
//
// RFC 3550 §6.4.1: for consecutive packets i, j from one sender,
//   D = (Rj − Ri) − (Sj − Si)     R = local arrival, S = sender timestamp
//   J += (|D| − J) / 16
// Only differences are used, so the offset between the two clocks
// cancels: the sender's AudioContext time and our performance.now()
// never need to agree.
// ─────────────────────────────────────────────────────────────

/** A transit change this large is a sender restart or a clock jump, not jitter. */
const MAX_PLAUSIBLE_D_MS = 1000;

export class JitterEstimator {
  private _jitterMs = 0;
  private senderId: number | null = null;
  private lastArrivalMs = 0;
  private lastSenderMs = 0;

  /** Current estimate in ms (0 until two packets from the same sender). */
  get jitterMs(): number { return this._jitterMs; }

  /**
   * @param senderId — packet sender; a new sender restarts the estimate
   * @param senderTimeSec — sender's timestamp, in seconds
   * @param arrivalMs — local arrival time, in ms (performance.now())
   */
  onPacket(senderId: number, senderTimeSec: number, arrivalMs: number): number {
    const senderMs = senderTimeSec * 1000;

    if (senderId !== this.senderId) {
      this.senderId = senderId;
      this._jitterMs = 0;
    } else {
      const d = (arrivalMs - this.lastArrivalMs) - (senderMs - this.lastSenderMs);
      // Skip the sample, keep the estimate: one restart must not read as
      // seconds of jitter and push the phase lock into tempo-match.
      if (Math.abs(d) <= MAX_PLAUSIBLE_D_MS) {
        this._jitterMs += (Math.abs(d) - this._jitterMs) / 16;
      }
    }

    this.lastArrivalMs = arrivalMs;
    this.lastSenderMs = senderMs;
    return this._jitterMs;
  }

  reset(): void {
    this._jitterMs = 0;
    this.senderId = null;
  }
}
