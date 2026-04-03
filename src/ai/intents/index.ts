/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi AI – Intent Registry
//
// Central registry of all DJ intents across 5 domains.
// To add a new intent: create the file, import it here,
// add it to ALL_INTENTS.  No other file needs to change.
// ─────────────────────────────────────────────────────────────

export type { BaseIntent, IntentDomain } from './BaseIntent';

// ── Safety domain (score 0.85–1.0) ──────────────────────────
export { SafetyLoopIntent } from './SafetyLoopIntent';
export { PhaseDriftCorrectionIntent } from './PhaseDriftCorrectionIntent';
export { RedLineLimiterIntent } from './RedLineLimiterIntent';
export { EqAmnesiaIntent } from './EqAmnesiaIntent';

// ── Spectral domain (score 0.35–0.9) ────────────────────────
export { DropSwapIntent } from './DropSwapIntent';
export { SubRumbleControlIntent } from './SubRumbleControlIntent';
export { HiHatLayeringIntent } from './HiHatLayeringIntent';
export { VocalSpaceCarvingIntent } from './VocalSpaceCarvingIntent';
export { IsolatorSweepIntent } from './IsolatorSweepIntent';

// ── Dynamics domain (score 0.05–0.95) ────────────────────────
export { FilterWashoutIntent } from './FilterWashoutIntent';
export { LpfMudDiveIntent } from './LpfMudDiveIntent';
export { PreDropSilenceIntent } from './PreDropSilenceIntent';
export { FilterWobbleIntent } from './FilterWobbleIntent';

// ── Rhythm domain (score 0.45–0.75) ─────────────────────────
export { LoopRollBuildupIntent } from './LoopRollBuildupIntent';
export { TeaserStabIntent } from './TeaserStabIntent';

// ── Structure domain (score 0.3–0.8) ─────────────────────────
export { OutroRidingIntent } from './OutroRidingIntent';
export { DoubleDropAlignIntent } from './DoubleDropAlignIntent';
export { KeyClashDefenseIntent } from './KeyClashDefenseIntent';

// ── ALL_INTENTS: the master array ────────────────────────────

import { SafetyLoopIntent } from './SafetyLoopIntent';
import { PhaseDriftCorrectionIntent } from './PhaseDriftCorrectionIntent';
import { RedLineLimiterIntent } from './RedLineLimiterIntent';
import { EqAmnesiaIntent } from './EqAmnesiaIntent';
import { DropSwapIntent } from './DropSwapIntent';
import { SubRumbleControlIntent } from './SubRumbleControlIntent';
import { HiHatLayeringIntent } from './HiHatLayeringIntent';
import { VocalSpaceCarvingIntent } from './VocalSpaceCarvingIntent';
import { IsolatorSweepIntent } from './IsolatorSweepIntent';
import { FilterWashoutIntent } from './FilterWashoutIntent';
import { LpfMudDiveIntent } from './LpfMudDiveIntent';
import { PreDropSilenceIntent } from './PreDropSilenceIntent';
import { FilterWobbleIntent } from './FilterWobbleIntent';
import { LoopRollBuildupIntent } from './LoopRollBuildupIntent';
import { TeaserStabIntent } from './TeaserStabIntent';
import { OutroRidingIntent } from './OutroRidingIntent';
import { DoubleDropAlignIntent } from './DoubleDropAlignIntent';
import { KeyClashDefenseIntent } from './KeyClashDefenseIntent';
import type { BaseIntent } from './BaseIntent';

export const ALL_INTENTS: BaseIntent[] = [
  // Safety (highest priority)
  SafetyLoopIntent,
  PhaseDriftCorrectionIntent,
  RedLineLimiterIntent,
  EqAmnesiaIntent,

  // Spectral
  DropSwapIntent,
  SubRumbleControlIntent,
  HiHatLayeringIntent,
  VocalSpaceCarvingIntent,
  IsolatorSweepIntent,

  // Dynamics
  FilterWashoutIntent,
  LpfMudDiveIntent,
  PreDropSilenceIntent,
  FilterWobbleIntent,

  // Rhythm
  LoopRollBuildupIntent,
  TeaserStabIntent,

  // Structure
  OutroRidingIntent,
  DoubleDropAlignIntent,
  KeyClashDefenseIntent,
];
