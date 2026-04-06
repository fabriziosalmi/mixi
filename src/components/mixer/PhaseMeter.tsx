/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Phase Meter (Dual-Box Overlap)
//
// Displays real-time beat phase alignment between deck A and B.
// Uses the "dual-box overlap" pattern: a fixed master outline
// and a moving slave fill box. When perfectly aligned (< 2ms),
// both fuse into a bright white "LOCKED" block.
//
// Updates via rAF + direct DOM mutation (zero React re-renders).
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { COLOR_DECK_A, COLOR_DECK_B } from '../../theme';

// ── Constants ────────────────────────────────────────────────

const METER_W = 200;  // total meter width in px
const BOX_W = 28;     // width of each phase box
const BOX_H = 14;     // height of each phase box
const CENTER = (METER_W - BOX_W) / 2;

/** Max displayable delta in ms — beyond this, box is at edge. */
const MAX_DELTA_MS = 50;

// ── Component ────────────────────────────────────────────────

export const PhaseMeter: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const slaveBoxRef = useRef<HTMLDivElement>(null);
  const masterBoxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    // ── Cached store fields via subscription (avoid getState per frame) ──
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

    // ── Change guard: track previous DOM values to skip redundant writes ──
    let prevZone = -1;     // 0=idle, 1=locked, 2=near, 3=warn, 4=crit
    let prevSlaveLeft = '';
    let prevLabelText = '';
    let prevSlaveAnim = '';

    function tick() {
      const slave = slaveBoxRef.current;
      const master = masterBoxRef.current;
      const label = labelRef.current;
      const container = containerRef.current;
      if (!slave || !master || !label || !container) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const bothPlaying = cachedPlayingA && cachedPlayingB && cachedBpmA > 0 && cachedBpmB > 0;

      if (!bothPlaying) {
        if (prevZone !== 0) {
          prevZone = 0;
          container.style.opacity = '0.3';
          slave.style.left = `${CENTER}px`;
          slave.style.background = 'rgba(255,255,255,0.05)';
          slave.style.borderColor = 'rgba(255,255,255,0.1)';
          slave.style.boxShadow = 'none';
          slave.style.animation = '';
          master.style.borderColor = 'rgba(255,255,255,0.1)';
          master.style.boxShadow = 'none';
          label.textContent = '';
          prevSlaveLeft = ''; prevLabelText = ''; prevSlaveAnim = '';
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // ── Compute phase delta using cached values ──
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

      // Map deltaMs to pixel offset
      const clampedDelta = Math.max(-MAX_DELTA_MS, Math.min(MAX_DELTA_MS, deltaMs));
      const pxOffset = (clampedDelta / MAX_DELTA_MS) * (METER_W / 2 - BOX_W / 2);
      const newLeft = `${(CENTER + pxOffset) | 0}px`;
      if (newLeft !== prevSlaveLeft) { slave.style.left = newLeft; prevSlaveLeft = newLeft; }

      const absDelta = Math.abs(deltaMs);
      const zone = absDelta < 2 ? 1 : absDelta < 10 ? 2 : absDelta < 30 ? 3 : 4;

      // ── Color/style changes on zone transition only ──
      if (zone !== prevZone) {
        prevZone = zone;
        if (zone === 1) {
          slave.style.background = 'rgba(255,255,255,0.35)';
          slave.style.borderColor = 'rgba(255,255,255,0.9)';
          slave.style.boxShadow = '0 0 12px rgba(255,255,255,0.5), inset 0 0 4px rgba(255,255,255,0.3)';
          master.style.borderColor = 'rgba(255,255,255,0.9)';
          master.style.boxShadow = '0 0 12px rgba(255,255,255,0.5)';
        } else if (zone === 2) {
          slave.style.background = 'rgba(34,197,94,0.2)';
          slave.style.borderColor = 'rgba(34,197,94,0.7)';
          slave.style.boxShadow = '0 0 6px rgba(34,197,94,0.3)';
          master.style.borderColor = 'rgba(255,255,255,0.3)';
          master.style.boxShadow = 'none';
          label.style.color = 'rgba(34,197,94,0.8)';
        } else if (zone === 3) {
          slave.style.background = 'rgba(245,158,11,0.2)';
          slave.style.borderColor = 'rgba(245,158,11,0.7)';
          slave.style.boxShadow = '0 0 6px rgba(245,158,11,0.3)';
          master.style.borderColor = 'rgba(255,255,255,0.2)';
          master.style.boxShadow = 'none';
          label.style.color = 'rgba(245,158,11,0.8)';
        } else {
          slave.style.background = 'rgba(239,68,68,0.25)';
          slave.style.borderColor = 'rgba(239,68,68,0.8)';
          slave.style.boxShadow = '0 0 8px rgba(239,68,68,0.4)';
          master.style.borderColor = 'rgba(255,255,255,0.15)';
          master.style.boxShadow = 'none';
          label.style.color = 'rgba(239,68,68,0.9)';
        }
      }

      // ── Shake on SLAVE BOX only (evaluated every frame, not just on zone change) ──
      const newAnim = zone === 4
        ? 'phase-shake 0.08s ease-in-out infinite'
        : zone === 3 && absDelta > 15
          ? 'phase-shake 0.1s ease-in-out infinite'
          : '';
      if (newAnim !== prevSlaveAnim) {
        slave.style.animation = newAnim;
        prevSlaveAnim = newAnim;
      }

      // Label text — only write when changed
      if (zone === 1) {
        if (prevLabelText !== '') { label.textContent = ''; prevLabelText = ''; }
      } else {
        const ms = Math.round(deltaMs);
        const txt = `${ms > 0 ? '+' : ''}${ms}ms`;
        if (txt !== prevLabelText) { label.textContent = txt; prevLabelText = txt; }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); unsub(); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center shrink-0"
      style={{ width: METER_W, height: BOX_H + 8, opacity: 0.3 }}
    >
      {/* Track line (background) */}
      <div
        className="absolute"
        style={{
          width: METER_W - 16,
          height: 1,
          left: 8,
          top: '50%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 30%, rgba(255,255,255,0.08) 70%, transparent)',
        }}
      />

      {/* Center tick */}
      <div
        className="absolute"
        style={{
          width: 1,
          height: BOX_H + 4,
          left: METER_W / 2,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'rgba(255,255,255,0.1)',
        }}
      />

      {/* Master box (fixed, outline only) */}
      <div
        ref={masterBoxRef}
        className="absolute"
        style={{
          width: BOX_W,
          height: BOX_H,
          left: CENTER,
          top: '50%',
          transform: 'translateY(-50%)',
          border: '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 3,
          background: 'transparent',
        }}
      />

      {/* Slave box (moving, filled) */}
      <div
        ref={slaveBoxRef}
        className="absolute transition-none"
        style={{
          width: BOX_W,
          height: BOX_H,
          left: CENTER,
          top: '50%',
          transform: 'translateY(-50%)',
          border: '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 3,
          background: 'rgba(255,255,255,0.05)',
        }}
      />

      {/* Deck labels */}
      <span
        className="absolute text-[6px] font-mono font-bold"
        style={{ left: 0, top: '50%', transform: 'translateY(-50%)', color: COLOR_DECK_A, opacity: 0.5 }}
      >
        A
      </span>
      <span
        className="absolute text-[6px] font-mono font-bold"
        style={{ right: 0, top: '50%', transform: 'translateY(-50%)', color: COLOR_DECK_B, opacity: 0.5 }}
      >
        B
      </span>

      {/* Delta label (below) */}
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
