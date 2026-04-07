/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Master Stereo VU Meter
//
// Two LED columns (L/R) reading the master bus level.
// Uses direct DOM manipulation (zero React re-renders during
// playback). Segments are ref'd once, then colored in a rAF.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { MeterService } from '../../audio/MeterService';
import { themeVar } from '../../theme';

const SEGMENT_COUNT = 12;

/** Applies level to a column of segment divs (direct DOM). */
function applyLevel(
  segs: HTMLDivElement[],
  level: number,
  colors: string[],
  glows: string[],
  offColor: string,
) {
  const lit = Math.round(level * SEGMENT_COUNT);
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const el = segs[i];
    if (!el) continue;
    const isLit = i < lit;
    el.style.backgroundColor = isLit ? colors[i] : offColor;
    el.style.opacity = isLit ? '1' : '0.3';
    el.style.boxShadow = isLit ? glows[i] : 'none';
  }
}

export const MasterVuMeter: FC = () => {
  const colLRef = useRef<HTMLDivElement>(null);
  const colRRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Grab segment children once.
    const segsL = colLRef.current
      ? (Array.from(colLRef.current.children) as HTMLDivElement[])
      : [];
    const segsR = colRRef.current
      ? (Array.from(colRRef.current.children) as HTMLDivElement[])
      : [];

    // Read theme tokens once per effect cycle
    const vuGreen = themeVar('vu-green', '#22c55e');
    const vuAmber = themeVar('vu-amber', '#f59e0b');
    const vuRed = themeVar('vu-red', '#ef4444');
    const ledOff = themeVar('led-off', '#1a1a1a');
    const segColors = Array.from({ length: SEGMENT_COUNT }, (_, i) =>
      i >= 10 ? vuRed : i >= 8 ? vuAmber : vuGreen,
    );
    const segGlows = segColors.map((c) => `0 0 6px ${c}66`);

    // Subscribe to shared MeterService (single RAF loop for all meters)
    return MeterService.subscribe((levels) => {
      applyLevel(segsL, levels.masterL, segColors, segGlows, ledOff);
      applyLevel(segsR, levels.masterR, segColors, segGlows, ledOff);
    });
  }, []);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex gap-[2px]">
        {/* Column L */}
        <div ref={colLRef} className="flex flex-col-reverse gap-[3px]" style={{ height: 160 }}>
          {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
            <div
              key={i}
              className="w-[8px] flex-1 rounded-[2px]"
              style={{ backgroundColor: 'var(--led-off)', opacity: 0.3, boxShadow: 'none' }}
            />
          ))}
        </div>
        {/* Column R */}
        <div ref={colRRef} className="flex flex-col-reverse gap-[3px]" style={{ height: 160 }}>
          {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
            <div
              key={i}
              className="w-[8px] flex-1 rounded-[2px]"
              style={{ backgroundColor: 'var(--led-off)', opacity: 0.3, boxShadow: 'none' }}
            />
          ))}
        </div>
      </div>
      <span className="text-[7px] text-zinc-400 uppercase tracking-wider">MST</span>
    </div>
  );
};
