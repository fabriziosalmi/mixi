/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Phase Meter (Dual-Disc Convergence)
//
// Two discs (A = cyan, B = orange) converge toward center.
// As they approach:
//   - They grow from small (edges) to full size (center)
//   - Colors transition through green when overlapping
//   - At perfect sync (< 2ms), both glow bright white
//
// Edge cases handled:
//   - Wrap-around: beat phase normalized to ±0.5 range
//   - Sudden jumps: no CSS transitions on position (instant)
//   - Idle: discs dim and shrink when not both playing
//
// Updates via rAF + direct DOM mutation (zero React re-renders).
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';

// ── Constants ────────────────────────────────────────────────

const METER_W = 240;          // wider track for more resolution
const DISC_MAX = 16;          // disc diameter at center
const DISC_MIN = 6;           // disc diameter at edges
const MAX_DELTA_MS = 50;      // ±50ms display range
const HALF_TRACK = METER_W / 2;

// Colors
const CLR_A = '#06b6d4';      // cyan
const CLR_B = '#f97316';      // orange
const CLR_GREEN = '#22c55e';  // approaching
const CLR_WHITE = '#ffffff';  // locked

// ── Component ────────────────────────────────────────────────

export const PhaseMeter: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffBarRef = useRef<HTMLDivElement>(null);
  const discARef = useRef<HTMLDivElement>(null);
  const discBRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    // Cached store fields (use native originalBpm for buffer-time beatgrid accuracy)
    let cachedPlayingA = false, cachedPlayingB = false;
    let cachedBpmA = 0, cachedBpmB = 0;
    let cachedNativeBpmA = 0, cachedNativeBpmB = 0;
    let cachedOffsetA = 0, cachedOffsetB = 0;
    const syncCache = () => {
      const s = useMixiStore.getState();
      cachedPlayingA = s.decks.A.isPlaying; cachedPlayingB = s.decks.B.isPlaying;
      cachedBpmA = s.decks.A.bpm; cachedBpmB = s.decks.B.bpm;
      cachedNativeBpmA = s.decks.A.originalBpm > 0 ? s.decks.A.originalBpm : s.decks.A.bpm;
      cachedNativeBpmB = s.decks.B.originalBpm > 0 ? s.decks.B.originalBpm : s.decks.B.bpm;
      cachedOffsetA = s.decks.A.firstBeatOffset; cachedOffsetB = s.decks.B.firstBeatOffset;
    };
    syncCache();
    const unsub = useMixiStore.subscribe((s) => s.decks, syncCache);

    let prevZone = -1;
    let prevDiscALeft = '';
    let prevDiscBLeft = '';
    let prevLabelText = '';

    function tick() {
      const discA = discARef.current;
      const discB = discBRef.current;
      const diffBar = diffBarRef.current;
      const label = labelRef.current;
      const container = containerRef.current;
      if (!discA || !discB || !diffBar || !label || !container) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const bothPlaying = cachedPlayingA && cachedPlayingB && cachedBpmA > 0 && cachedBpmB > 0;

      // ── Idle state (grid & 0° center line remain crisp and legible) ──
      if (!bothPlaying) {
        if (prevZone !== 0) {
          prevZone = 0;
          container.style.opacity = '0.75';
          diffBar.style.width = '0px';
          discA.style.left = '14px';
          discA.style.width = discA.style.height = '8px';
          discA.style.background = CLR_A;
          discA.style.opacity = '0.65';
          discA.style.boxShadow = `0 0 4px ${CLR_A}55`;
          discB.style.left = `${METER_W - 22}px`;
          discB.style.width = discB.style.height = '8px';
          discB.style.background = CLR_B;
          discB.style.opacity = '0.65';
          discB.style.boxShadow = `0 0 4px ${CLR_B}55`;
          label.textContent = '0° READY';
          label.style.color = 'rgba(255,255,255,0.48)';
          prevDiscALeft = ''; prevDiscBLeft = ''; prevLabelText = '0° READY';
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // ── Compute phase delta ─────────────────────────────
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) { rafRef.current = requestAnimationFrame(tick); return; }

      const timeA = engine.getCurrentTime('A');
      const timeB = engine.getCurrentTime('B');
      const nativePeriodA = 60 / cachedNativeBpmA;
      const nativePeriodB = 60 / cachedNativeBpmB;
      const wallPeriodA = 60 / cachedBpmA;
      const beatA = (timeA - cachedOffsetA) / nativePeriodA;
      const beatB = (timeB - cachedOffsetB) / nativePeriodB;
      const fracA = ((beatA % 1) + 1) % 1;
      const fracB = ((beatB % 1) + 1) % 1;
      let delta = fracA - fracB;
      if (delta > 0.5) delta -= 1;
      if (delta < -0.5) delta += 1;
      const deltaMs = delta * wallPeriodA * 1000;

      container.style.opacity = '1';

      const clampedDelta = Math.max(-MAX_DELTA_MS, Math.min(MAX_DELTA_MS, deltaMs));
      const normDelta = clampedDelta / MAX_DELTA_MS; // -1 to +1

      // Differential bar expanding from 0° center line
      const barPx = Math.abs(normDelta) * (HALF_TRACK - 14);
      const barColor = Math.abs(clampedDelta) < 3 ? CLR_WHITE : Math.abs(clampedDelta) < 10 ? CLR_GREEN : normDelta > 0 ? CLR_A : CLR_B;
      diffBar.style.width = `${Math.max(2, barPx | 0)}px`;
      diffBar.style.left = normDelta >= 0 ? `${HALF_TRACK}px` : `${(HALF_TRACK - barPx) | 0}px`;
      diffBar.style.background = barColor;
      diffBar.style.boxShadow = `0 0 8px ${barColor}88`;

      const aOffset = normDelta * (HALF_TRACK - DISC_MAX);
      const aLeft = HALF_TRACK + aOffset - DISC_MAX / 2;
      const bLeft = HALF_TRACK - aOffset - DISC_MAX / 2;

      const absDelta = Math.abs(clampedDelta);
      const proximity = 1 - (absDelta / MAX_DELTA_MS);
      const discSize = DISC_MIN + proximity * (DISC_MAX - DISC_MIN);
      const sizeStr = `${discSize | 0}px`;

      const zone = absDelta < 2 ? 1 : absDelta < 10 ? 2 : absDelta < 30 ? 3 : 4;

      let colorA: string, colorB: string;
      let glowA = 'none', glowB = 'none';

      if (zone === 1) {
        colorA = colorB = CLR_WHITE;
        glowA = glowB = `0 0 14px rgba(255,255,255,0.7), 0 0 6px rgba(255,255,255,0.4)`;
      } else if (zone === 2) {
        colorA = CLR_GREEN;
        colorB = CLR_GREEN;
        glowA = glowB = `0 0 8px rgba(34,197,94,0.5)`;
      } else if (zone === 3) {
        const t = 1 - (absDelta - 10) / 20;
        colorA = t > 0.5 ? CLR_GREEN : CLR_A;
        colorB = t > 0.5 ? CLR_GREEN : CLR_B;
        glowA = `0 0 4px ${colorA}66`;
        glowB = `0 0 4px ${colorB}66`;
      } else {
        colorA = CLR_A;
        colorB = CLR_B;
      }

      const newALeft = `${aLeft | 0}px`;
      if (newALeft !== prevDiscALeft) { discA.style.left = newALeft; prevDiscALeft = newALeft; }
      discA.style.width = discA.style.height = sizeStr;
      discA.style.background = colorA;
      discA.style.boxShadow = glowA;
      discA.style.opacity = '1';

      const newBLeft = `${bLeft | 0}px`;
      if (newBLeft !== prevDiscBLeft) { discB.style.left = newBLeft; prevDiscBLeft = newBLeft; }
      discB.style.width = discB.style.height = sizeStr;
      discB.style.background = colorB;
      discB.style.boxShadow = glowB;
      discB.style.opacity = '1';

      if (zone === 1) {
        if (prevLabelText !== 'LOCKED') {
          label.textContent = 'LOCKED';
          label.style.color = CLR_WHITE;
          prevLabelText = 'LOCKED';
        }
      } else {
        const ms = Math.round(deltaMs);
        const txt = `${ms > 0 ? '+' : ''}${ms}ms`;
        if (txt !== prevLabelText) {
          label.textContent = txt;
          label.style.color = zone === 2 ? CLR_GREEN : zone === 3 ? '#f59e0b' : '#ef4444';
          prevLabelText = txt;
        }
      }

      prevZone = zone;
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); unsub(); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center shrink-0"
      style={{ width: METER_W, height: 48, opacity: 0.75 }}
    >
      {/* Beat alignment grid ticks (-50, -25, 0, +25, +50 ms) */}
      {[0.08, 0.29, 0.5, 0.71, 0.92].map((pos) => {
        const isCenter = pos === 0.5;
        return (
          <div
            key={pos}
            className="absolute pointer-events-none"
            style={{
              width: isCenter ? 1.5 : 1,
              height: isCenter ? 28 : 14,
              left: `${pos * 100}%`,
              top: '44%',
              transform: 'translate(-50%, -50%)',
              background: isCenter
                ? 'var(--phase-center-line, rgba(255,255,255,0.88))'
                : 'var(--knob-tick, rgba(255,255,255,0.22))',
            }}
          />
        );
      })}

      {/* Track rail */}
      <div
        className="absolute"
        style={{
          width: METER_W - 20,
          height: 4,
          left: 10,
          top: '44%',
          transform: 'translateY(-50%)',
          borderRadius: 2,
          background: 'var(--vu-off-segment, rgba(255,255,255,0.075))',
        }}
      />

      {/* Differential phase bar from 0° center */}
      <div
        ref={diffBarRef}
        className="absolute rounded-full pointer-events-none"
        style={{
          height: 4,
          width: 0,
          left: HALF_TRACK,
          top: '44%',
          transform: 'translateY(-50%)',
          background: CLR_A,
        }}
      />

      {/* Disc A (cyan) */}
      <div
        ref={discARef}
        className="absolute rounded-full"
        style={{
          width: 8,
          height: 8,
          left: 14,
          top: '44%',
          transform: 'translateY(-50%)',
          background: CLR_A,
          opacity: 0.65,
        }}
      />

      {/* Disc B (orange) */}
      <div
        ref={discBRef}
        className="absolute rounded-full"
        style={{
          width: 8,
          height: 8,
          left: METER_W - 22,
          top: '44%',
          transform: 'translateY(-50%)',
          background: CLR_B,
          opacity: 0.65,
        }}
      />

      {/* Deck labels */}
      <span
        className="absolute text-[7px] font-mono font-bold"
        style={{ left: 2, bottom: 1, color: CLR_A, opacity: 0.85 }}
      >
        A
      </span>
      <span
        className="absolute text-[7px] font-mono font-bold"
        style={{ right: 2, bottom: 1, color: CLR_B, opacity: 0.85 }}
      >
        B
      </span>

      {/* Delta / LOCK label */}
      <span
        ref={labelRef}
        className="absolute text-[7.5px] font-mono font-bold tracking-wider tabular-nums"
        style={{
          bottom: 1,
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'rgba(255,255,255,0.48)',
          whiteSpace: 'nowrap',
        }}
      >
        0° READY
      </span>
    </div>
  );
};
