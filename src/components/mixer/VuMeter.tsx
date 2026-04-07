/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – VU Meter (real audio level + physical ballistics)
//
// Reads RMS from MixiEngine.getLevel() at ~30 FPS.
//
// Ballistics (per PERCEPTIONS.md spec):
//   Attack:   0 ms — instant rise to current peak.
//   Release:  ~150 ms logarithmic decay (gravity falloff).
//   Peak hold: highest LED stays lit for 1s then drops.
//
// 12 segments: green (1–8), amber (9–10), red (11–12).
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { MeterService } from '../../audio/MeterService';
import type { DeckId } from '../../types';
import { themeVar } from '../../theme';

const SEGMENT_COUNT = 12;

/** Release time constant — higher = slower falloff. */
const RELEASE_DECAY = 0.88; // per frame (~30fps → ~150ms to half)

/** Peak hold duration in ms. */
const PEAK_HOLD_MS = 1000;

interface VuMeterProps {
  deckId: DeckId;
}

export const VuMeter: FC<VuMeterProps> = ({ deckId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const displayLevel = useRef(0);
  const peakLevel = useRef(0);
  const peakTime = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Pre-create segment divs for direct DOM manipulation (no React re-renders).
    const segments: HTMLDivElement[] = [];
    container.innerHTML = '';

    // Read theme tokens once per effect
    const vuGreen = themeVar('vu-green', '#22c55e');
    const vuAmber = themeVar('vu-amber', '#f59e0b');
    const vuRed = themeVar('vu-red', '#ef4444');
    const ledOff = themeVar('led-off', '#1a1a1a');
    const segColors = Array.from({ length: SEGMENT_COUNT }, (_, i) =>
      i >= 10 ? vuRed : i >= 8 ? vuAmber : vuGreen,
    );

    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = document.createElement('div');
      seg.style.flex = '1';
      seg.style.width = '10px';
      seg.style.borderRadius = '2px';
      seg.style.backgroundColor = ledOff;
      seg.style.opacity = '0.5';
      seg.style.marginBottom = '2px';
      container.appendChild(seg);
      segments.unshift(seg); // segments[0] = bottom, segments[11] = top
    }

    let prevLitCount = -1;
    let prevPeakSeg = -1;

    // Subscribe to shared MeterService (single RAF loop for all meters)
    const unsub = MeterService.subscribe((levels) => {
      const now = performance.now();
      const rawLevel = levels[deckId];

      // ── Attack: instant rise ─────────────────────────────
      if (rawLevel > displayLevel.current) {
        displayLevel.current = rawLevel;
      } else {
        // ── Release: logarithmic decay ─────────────────────
        displayLevel.current *= RELEASE_DECAY;
        if (displayLevel.current < 0.01) displayLevel.current = 0;
      }

      // ── Peak hold ────────────────────────────────────────
      if (rawLevel > peakLevel.current) {
        peakLevel.current = rawLevel;
        peakTime.current = now;
      } else if (now - peakTime.current > PEAK_HOLD_MS) {
        peakLevel.current *= RELEASE_DECAY;
        if (peakLevel.current < 0.01) peakLevel.current = 0;
      }

      const litCount = Math.round(displayLevel.current * SEGMENT_COUNT);
      const peakSeg = Math.min(SEGMENT_COUNT - 1, Math.round(peakLevel.current * SEGMENT_COUNT) - 1);

      // ── Skip DOM writes if nothing changed ───────────────
      if (litCount === prevLitCount && peakSeg === prevPeakSeg) return;
      prevLitCount = litCount;
      prevPeakSeg = peakSeg;

      // ── Update only changed segments (no setState) ────────
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const wasLit = i < prevLitCount || i === prevPeakSeg;
        const isLit = i < litCount;
        const isPeak = i === peakSeg && peakSeg >= 0;
        const nowLit = isLit || isPeak;
        if (wasLit === nowLit) continue;

        const seg = segments[i];
        if (nowLit) {
          const c = segColors[i];
          seg.style.backgroundColor = c;
          seg.style.opacity = '1';
          seg.style.boxShadow = `0 0 6px ${c}66`;
        } else {
          seg.style.backgroundColor = ledOff;
          seg.style.opacity = '0.5';
          seg.style.boxShadow = 'none';
        }
      }
    });

    return unsub;
  }, [deckId]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        ref={containerRef}
        className="flex flex-col"
        style={{ height: 160 }}
      />
      <span className="text-[7px] font-bold" style={{ color: deckId === 'A' ? 'var(--clr-a)' : 'var(--clr-b)' }}>
        {deckId}
      </span>
    </div>
  );
};
