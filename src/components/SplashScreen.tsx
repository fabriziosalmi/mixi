/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Splash Screen  (Technics Vinyl Edition — v2)
//
// Optimised: 1.2s spin→ready, CSS-only fade out, no strobe,
// onStart() called immediately on click (runs in parallel
// with the fade transition — zero perceived latency).
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type FC, type MouseEvent as RME } from 'react';
import vinylImg from '../../assets/vinyl.png';

/* ── Constants ────────────────────────────────────────────── */

const FULL_SPEED  = 200;         // deg/s at 33⅓ RPM equivalent
const SPIN_MS     = 300;         // full-speed phase
const DECEL_MS    = 500;         // coast-down
const LOCK_SNAP   = -0.5;        // degrees backward snap at stop
const FLUTTER_PX  = 0.5;         // wow & flutter amplitude
const RING_DRAW_MS = 400;        // LED ring draw time (was 800)
const RING_CIRCUM = 2 * Math.PI * 268;

/* ── SVG micro-groove overlay ─────────────────────────────── */

function Grooves({ size }: { size: number }) {
  const r0 = size * 0.18;
  const r1 = size * 0.47;
  const count = 50;
  const step = (r1 - r0) / count;
  const cx = size / 2;
  return (
    <svg className="mixi-splash-grooves" viewBox={`0 0 ${size} ${size}`}>
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i} cx={cx} cy={cx} r={r0 + i * step}
          fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="0.5"
        />
      ))}
    </svg>
  );
}

/* ── LED ring (dual layer: core + glow) ───────────────────── */

function LedRing({ drawing, ready }: { drawing: boolean; ready: boolean }) {
  const cls = (layer: string) =>
    `mixi-splash-ring mixi-splash-ring--${layer}${drawing ? ' is-visible' : ''}${ready ? ' is-breathing' : ''}`;
  return (
    <div className="mixi-splash-ring-wrap">
      {/* Glow layer — wide, soft, colorful */}
      <svg className={cls('glow')} viewBox="0 0 540 540">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00f0ff" />
            <stop offset="35%" stopColor="#a855f7" />
            <stop offset="65%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#ff6a00" />
          </linearGradient>
        </defs>
        <circle cx="270" cy="270" r="268"
          fill="none" stroke="url(#ringGrad)" strokeWidth="10"
          strokeDasharray={RING_CIRCUM}
          strokeDashoffset={drawing ? 0 : RING_CIRCUM}
          strokeLinecap="round"
        />
      </svg>
      {/* Core layer — thin, sharp white */}
      <svg className={cls('core')} viewBox="0 0 540 540">
        <circle cx="270" cy="270" r="268"
          fill="none" stroke="#fff" strokeWidth="1"
          strokeDasharray={RING_CIRCUM}
          strokeDashoffset={drawing ? 0 : RING_CIRCUM}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function SpindleHole() {
  return (
    <div className="mixi-splash-spindle">
      <div className="mixi-splash-spindle-inner" />
    </div>
  );
}

function AnisotropicReflection() {
  return <div className="mixi-splash-aniso" />;
}

/* ═══════════════════════════════════════════════════════════ */
/*  Main Component                                             */
/* ═══════════════════════════════════════════════════════════ */

interface SplashScreenProps {
  onStart: () => Promise<void>;
}

export const SplashScreen: FC<SplashScreenProps> = ({ onStart }) => {
  const [phase, setPhase] = useState<'spin' | 'ring-draw' | 'ready' | 'dive'>('spin');
  const [fadeIn, setFadeIn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const vinylRef = useRef<HTMLImageElement>(null);
  const discRef = useRef<HTMLButtonElement>(null);
  const rafRef = useRef(0);
  const skipRef = useRef(false);
  const angleRef = useRef(0);

  // ── Fade in from black on mount ─────────────────────────────
  useEffect(() => {
    requestAnimationFrame(() => setFadeIn(true));
  }, []);

  // ── Vinyl spin physics (faster Technics 1200 decel) ─────────

  useEffect(() => {
    let angle = 0;
    let lastTime = performance.now();
    let stage: 'spin' | 'decel' | 'lock' | 'done' = 'spin';
    let stageStart = lastTime;
    let flutterPhase = 0;

    function tick(now: number) {
      if (skipRef.current && stage !== 'done') {
        stage = 'done';
        if (vinylRef.current) {
          vinylRef.current.style.transform = `rotate(${angle % 360}deg)`;
          vinylRef.current.style.filter = 'contrast(1.1)';
        }
        setPhase('ring-draw');
        setTimeout(() => setPhase('ready'), RING_DRAW_MS + 100);
        return;
      }

      const dt = now - lastTime;
      lastTime = now;
      const elapsed = now - stageStart;

      flutterPhase += dt * 0.003;
      const flutter = Math.sin(flutterPhase) * FLUTTER_PX;

      if (stage === 'spin') {
        angle += FULL_SPEED * (dt / 1000);
        if (elapsed >= SPIN_MS) { stage = 'decel'; stageStart = now; }
      } else if (stage === 'decel') {
        const t = Math.min(elapsed / DECEL_MS, 1);
        const speed = FULL_SPEED * Math.max(0, 1 - Math.pow(t, 0.35));
        angle += speed * (dt / 1000);
        if (t >= 1) { stage = 'lock'; stageStart = now; }
      } else if (stage === 'lock') {
        angle += LOCK_SNAP;
        stage = 'done';
        if (vinylRef.current) {
          vinylRef.current.style.filter = 'contrast(1.1)';
          setTimeout(() => {
            if (vinylRef.current) vinylRef.current.style.filter = '';
          }, 150);
        }
        setPhase('ring-draw');
        setTimeout(() => setPhase('ready'), RING_DRAW_MS + 100);
      }

      if (vinylRef.current && stage !== 'done') {
        vinylRef.current.style.transform =
          `rotate(${angle % 360}deg) translateY(${flutter}px)`;
      } else if (vinylRef.current && stage === 'done') {
        vinylRef.current.style.transform = `rotate(${angle % 360}deg)`;
      }

      angleRef.current = angle;
      if (stage !== 'done') {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Skip animation (Enter/Space during spin) ──────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Enter' || e.key === ' ') && phase === 'spin') {
        skipRef.current = true;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // ── 3D parallax hover ─────────────────────────────────────

  const handleMouseMove = useCallback((e: RME<HTMLDivElement>) => {
    if (phase !== 'ready' || !discRef.current) return;
    const rect = discRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    discRef.current.style.transform =
      `perspective(600px) rotateY(${dx * 33}deg) rotateX(${-dy * 33}deg)`;
  }, [phase]);

  const handleMouseLeave = useCallback(() => {
    if (discRef.current) discRef.current.style.transform = '';
  }, []);

  // ── Launch: CSS fade + onStart() in parallel ──────────────

  const handleLaunch = useCallback(async () => {
    if (phase !== 'ready') return;
    setPhase('dive');

    // Fade to black
    setFadeIn(false);

    // Call onStart() in parallel with fade — zero perceived latency
    await onStart();
  }, [phase, onStart]);

  const isDrawing = phase === 'ring-draw' || phase === 'ready' || phase === 'dive';
  const isReady = phase === 'ready';
  const isDive = phase === 'dive';

  return (
    <div
      ref={containerRef}
      className="mixi-splash"
      style={{ opacity: fadeIn ? 1 : 0, transition: 'opacity 0.6s ease-in-out', cursor: isReady ? 'pointer' : 'default' }}
      role="button"
      tabIndex={0}
      onClick={handleLaunch}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && isReady) handleLaunch();
      }}
    >
      <div className="mixi-splash-bg-glow" />
      <div className="mixi-splash-noise" />
      <div className="mixi-splash-scanlines" />
      <div className="mixi-splash-vignette" />
      <div className="mixi-splash-chromatic" />

      <div className="mixi-splash-center">
        <button
            ref={discRef}
            className={`mixi-splash-vinyl-btn${isReady ? ' is-ready' : ''}${isDive ? ' is-dive' : ''}`}
            disabled={!isReady}
            type="button"
            aria-label="Launch Mixi"
          >
            {isDrawing && <div className="mixi-splash-light-spill" />}
            <LedRing drawing={isDrawing} ready={isReady} />
            <AnisotropicReflection />
            <img ref={vinylRef} src={vinylImg} alt="" className="mixi-splash-vinyl" draggable={false} />
            <Grooves size={520} />
            <SpindleHole />
          </button>
      </div>
    </div>
  );
};
