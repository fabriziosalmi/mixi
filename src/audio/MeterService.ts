/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// MeterService — Single RAF loop for all VU / level meters
//
// Problem: 5+ components (VuMeter ×2, MasterVuMeter, MasterHud,
// PremiumJogWheel ×2) each register their own requestAnimationFrame
// loop and call engine.getLevel() / getMasterLevel() independently.
//
// Solution: One RAF loop at 30 FPS reads all meters once per frame
// and stores results. Components subscribe and read cached values.
// Eliminates N separate RAF registrations + redundant engine calls.
// ─────────────────────────────────────────────────────────────

import { MixiEngine } from './MixiEngine';

export interface MeterLevels {
  A: number;
  B: number;
  master: number;
  frame: number;
}

type MeterCallback = (levels: MeterLevels) => void;

class MeterServiceImpl {
  private rafId = 0;
  private lastUpdate = 0;
  private running = false;
  private callbacks = new Set<MeterCallback>();

  readonly levels: MeterLevels = { A: 0, B: 0, master: 0, frame: 0 };

  subscribe(cb: MeterCallback): () => void {
    this.callbacks.add(cb);
    if (!this.running) this.start();
    return () => {
      this.callbacks.delete(cb);
      if (this.callbacks.size === 0) this.stop();
    };
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick(now: number): void {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this.tick(t));

    // Throttle to ~30 FPS
    if (now - this.lastUpdate < 33) return;
    this.lastUpdate = now;

    const engine = MixiEngine.getInstance();
    if (engine.isInitialized) {
      this.levels.A = engine.getLevel('A');
      this.levels.B = engine.getLevel('B');
      this.levels.master = engine.getMasterLevel();
    } else {
      this.levels.A = 0;
      this.levels.B = 0;
      this.levels.master = 0;
    }
    this.levels.frame++;

    // Notify all subscribers
    for (const cb of this.callbacks) cb(this.levels);
  }
}

export const MeterService = new MeterServiceImpl();
