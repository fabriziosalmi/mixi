/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

export const POINTS_PER_SECOND = 100;
export const BAR_WIDTH = 3;
export const BAR_GAP = 1;
export const BAR_STEP = BAR_WIDTH + BAR_GAP; // 4
export const PLAYHEAD_RATIO = 1 / 3;

/** Hot cue pad colors (Rekordbox standard, 8 slots). */
export const CUE_COLORS = [
  '#22c55e', // 1 green
  '#ef4444', // 2 red
  '#3b82f6', // 3 blue
  '#f59e0b', // 4 amber
  '#a855f7', // 5 purple
  '#ec4899', // 6 pink
  '#06b6d4', // 7 cyan
  '#ff6a00', // 8 orange
] as const;
