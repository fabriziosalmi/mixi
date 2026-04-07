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
  const discARef = useRef<HTMLDivElement>(null);
  const discBRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    // Cached store fields
    let cachedPlayingA = false, cachedPlayingB = false;
    let cachedBpmA = 0, cachedBpmB = 0;
    let cachedOffsetA = 0, cachedOffsetB = 0;
    const syncCache = () => {
      const s = useMixiStore.getState();
      cachedPlayingA = s.decks.A.isPlaying; cachedPlayingB = s.decks.B.isPlaying;
      cachedBpmA = s.decks.A.bpm; cachedBpmB = s.decks.B.bpm;
      cachedOffsetA = s.decks.A.firstBeatOffset; cachedOffsetB = s.decks.B.firstBeatOffset;
    };
    syncCache();
    const unsub = useMixiStore.subscribe(syncCache);

    // Change guards
    let prevZone = -1;
    let prevDiscALeft = '';
    let prevDiscBLeft = '';
    let prevLabelText = '';

    function tick() {
      const discA = discARef.current;
      const discB = discBRef.current;
      const label = labelRef.current;
      const container = containerRef.current;
      if (!discA || !discB || !label || !container) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const bothPlaying = cachedPlayingA && cachedPlayingB && cachedBpmA > 0 && cachedBpmB > 0;

      // ── Idle state ──────────────────────────────────────
      if (!bothPlaying) {
        if (prevZone !== 0) {
          prevZone = 0;
          container.style.opacity = '0.3';
          // A disc: left edge, small, dim cyan
          discA.style.left = '8px';
          discA.style.width = discA.style.height = `${DISC_MIN}px`;
          discA.style.background = CLR_A;
          discA.style.opacity = '0.3';
          discA.style.boxShadow = 'none';
          // B disc: right edge, small, dim orange
          discB.style.left = `${METER_W - DISC_MIN - 8}px`;
          discB.style.width = discB.style.height = `${DISC_MIN}px`;
          discB.style.background = CLR_B;
          discB.style.opacity = '0.3';
          discB.style.boxShadow = 'none';
          label.textContent = '';
          prevDiscALeft = ''; prevDiscBLeft = ''; prevLabelText = '';
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // ── Compute phase delta ─────────────────────────────
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized) { rafRef.current = requestAnimationFrame(tick); return; }

      const timeA = engine.getCurrentTime('A');
      const timeB = engine.getCurrentTime('B');
      const periodA = 60 / cachedBpmA;
      const beatA = (timeA - cachedOffsetA) / periodA;
      const beatB = (timeB - cachedOffsetB) / (60 / cachedBpmB);
      const fracA = ((beatA % 1) + 1) % 1;
      const fracB = ((beatB % 1) + 1) % 1;
      let delta = fracA - fracB;
      if (delta > 0.5) delta -= 1;
      if (delta < -0.5) delta += 1;
      const deltaMs = delta * periodA * 1000;

      container.style.opacity = '1';

      // Clamp and normalize
      const clampedDelta = Math.max(-MAX_DELTA_MS, Math.min(MAX_DELTA_MS, deltaMs));
      const normDelta = clampedDelta / MAX_DELTA_MS; // -1 to +1

      // ── Disc positions ──────────────────────────────────
      // A starts from left, B from right. Both converge to center.
      // normDelta > 0: A is ahead (B needs to catch up)
      // At sync: both at center (HALF_TRACK)

      // A disc: center - offset (moves based on where A's phase is relative to center)
      const aOffset = normDelta * (HALF_TRACK - DISC_MAX);
      const aLeft = HALF_TRACK + aOffset - DISC_MAX / 2;

      // B disc: mirrors A (opposite side)
      const bLeft = HALF_TRACK - aOffset - DISC_MAX / 2;

      // ── Disc size: bigger when closer to center ─────────
      const absDelta = Math.abs(clampedDelta);
      const proximity = 1 - (absDelta / MAX_DELTA_MS); // 0=edge, 1=center
      const discSize = DISC_MIN + proximity * (DISC_MAX - DISC_MIN);
      const sizeStr = `${discSize | 0}px`;

      // ── Zone system ─────────────────────────────────────
      const zone = absDelta < 2 ? 1 : absDelta < 10 ? 2 : absDelta < 30 ? 3 : 4;

      // ── Color blending ──────────────────────────────────
      // Far apart: A=cyan, B=orange
      // Approaching (< 30ms): both shift toward green
      // Locked (< 2ms): both white with glow
      let colorA: string, colorB: string;
      let glowA = 'none', glowB = 'none';

      if (zone === 1) {
        // LOCKED — bright white, strong glow
        colorA = colorB = CLR_WHITE;
        glowA = glowB = `0 0 14px rgba(255,255,255,0.7), 0 0 6px rgba(255,255,255,0.4)`;
      } else if (zone === 2) {
        // NEAR — green tint, soft glow
        colorA = CLR_GREEN;
        colorB = CLR_GREEN;
        glowA = glowB = `0 0 8px rgba(34,197,94,0.5)`;
      } else if (zone === 3) {
        // WARN — blending from native color toward green
        // t: 0 at 30ms (pure native), 1 at 10ms (pure green)
        const t = 1 - (absDelta - 10) / 20; // 0..1
        colorA = t > 0.5 ? CLR_GREEN : CLR_A;
        colorB = t > 0.5 ? CLR_GREEN : CLR_B;
        glowA = `0 0 4px ${colorA}66`;
        glowB = `0 0 4px ${colorB}66`;
      } else {
        // CRIT — native colors, no glow
        colorA = CLR_A;
        colorB = CLR_B;
      }

      // ── Apply to DOM ────────────────────────────────────
      // Disc A
      const newALeft = `${aLeft | 0}px`;
      if (newALeft !== prevDiscALeft) { discA.style.left = newALeft; prevDiscALeft = newALeft; }
      discA.style.width = discA.style.height = sizeStr;
      discA.style.background = colorA;
      discA.style.boxShadow = glowA;
      discA.style.opacity = '1';

      // Disc B
      const newBLeft = `${bLeft | 0}px`;
      if (newBLeft !== prevDiscBLeft) { discB.style.left = newBLeft; prevDiscBLeft = newBLeft; }
      discB.style.width = discB.style.height = sizeStr;
      discB.style.background = colorB;
      discB.style.boxShadow = glowB;
      discB.style.opacity = '1';

      // Label
      if (zone === 1) {
        if (prevLabelText !== '') { label.textContent = ''; label.style.color = CLR_WHITE; prevLabelText = ''; }
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
      style={{ width: METER_W, height: DISC_MAX + 8, opacity: 0.3 }}
    >
      {/* Track line */}
      <div
        className="absolute"
        style={{
          width: METER_W - 16,
          height: 1,
          left: 8,
          top: '50%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 20%, rgba(255,255,255,0.06) 80%, transparent)',
        }}
      />

      {/* Center tick */}
      <div
        className="absolute"
        style={{
          width: 1,
          height: DISC_MAX + 4,
          left: HALF_TRACK,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'rgba(255,255,255,0.08)',
        }}
      />

      {/* Disc A (cyan, comes from left) */}
      <div
        ref={discARef}
        className="absolute rounded-full"
        style={{
          width: DISC_MIN,
          height: DISC_MIN,
          left: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          background: CLR_A,
          opacity: 0.3,
        }}
      />

      {/* Disc B (orange, comes from right) */}
      <div
        ref={discBRef}
        className="absolute rounded-full"
        style={{
          width: DISC_MIN,
          height: DISC_MIN,
          left: METER_W - DISC_MIN - 8,
          top: '50%',
          transform: 'translateY(-50%)',
          background: CLR_B,
          opacity: 0.3,
        }}
      />

      {/* Deck labels */}
      <span
        className="absolute text-[6px] font-mono font-bold"
        style={{ left: 0, bottom: -1, color: CLR_A, opacity: 0.4 }}
      >
        A
      </span>
      <span
        className="absolute text-[6px] font-mono font-bold"
        style={{ right: 0, bottom: -1, color: CLR_B, opacity: 0.4 }}
      >
        B
      </span>

      {/* Delta label */}
      <span
        ref={labelRef}
        className="absolute text-[7px] font-mono font-bold tabular-nums"
        style={{
          bottom: -2,
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'transparent',
          whiteSpace: 'nowrap',
        }}
      />
    </div>
  );
};
