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
import { MixiEngine } from '../../audio/MixiEngine';
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
  const rafRef = useRef(0);
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
      seg.style.width = '6px';
      seg.style.borderRadius = '1px';
      seg.style.backgroundColor = ledOff;
      seg.style.opacity = '0.5';
      seg.style.marginBottom = '3px';
      container.appendChild(seg);
      segments.unshift(seg); // segments[0] = bottom, segments[11] = top
    }

    let lastUpdate = 0;
    let prevLitCount = -1;
    let prevPeakSeg = -1;

    function tick() {
      const now = performance.now();
      if (now - lastUpdate > 33) { // ~30 FPS
        lastUpdate = now;

        const engine = MixiEngine.getInstance();
        const rawLevel = engine.isInitialized ? engine.getLevel(deckId) : 0;

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
          // Peak expired — let it fall.
          peakLevel.current *= RELEASE_DECAY;
          if (peakLevel.current < 0.01) peakLevel.current = 0;
        }

        const litCount = Math.round(displayLevel.current * SEGMENT_COUNT);
        const peakSeg = Math.min(SEGMENT_COUNT - 1, Math.round(peakLevel.current * SEGMENT_COUNT) - 1);

        // ── Skip DOM writes if nothing changed ───────────────
        if (litCount === prevLitCount && peakSeg === prevPeakSeg) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        prevLitCount = litCount;
        prevPeakSeg = peakSeg;

        // ── Update DOM directly (no setState) ────────────────
        for (let i = 0; i < SEGMENT_COUNT; i++) {
          const seg = segments[i];
          const isLit = i < litCount;
          const isPeak = i === peakSeg && peakSeg >= 0;
          const color = segColors[i];

          if (isLit || isPeak) {
            seg.style.backgroundColor = color;
            seg.style.opacity = '1';
            seg.style.boxShadow = `0 0 4px ${color}44`;
          } else {
            seg.style.backgroundColor = ledOff;
            seg.style.opacity = '0.5';
            seg.style.boxShadow = 'none';
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [deckId]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        ref={containerRef}
        className="flex flex-col"
        style={{ height: 140 }}
      />
      <span className="text-[7px] font-bold" style={{ color: deckId === 'A' ? 'var(--clr-a)' : 'var(--clr-b)' }}>
        {deckId}
      </span>
    </div>
  );
};
