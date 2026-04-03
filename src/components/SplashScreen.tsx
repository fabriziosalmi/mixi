/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Splash Screen  (Technics Vinyl Edition)
//
// 30-point premium splash with:
//  - Spindle hole, anisotropic reflection, micro-grooves, lip
//  - Technics 1200 deceleration curve with lock snap
//  - Wow & flutter micro-oscillation
//  - LED ring: cyan→orange gradient, stroke-dashoffset draw,
//    dual glow layer, breathing pulse, background light spill
//  - 3D parallax hover, custom cursor, press feedback
//  - Zoom-into-spindle dive transition with flashbang
//  - Responsive max 40vh, vignettatura inversa
//  - Skip animation with Space/Enter during spin
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type FC, type MouseEvent as RME } from 'react';
import vinylImg from '../../assets/vinyl.png';

/* ── Constants ────────────────────────────────────────────── */

const FULL_SPEED  = 200;         // deg/s at 33⅓ RPM equivalent
const SPIN_MS     = 1600;        // full-speed phase
const DECEL_MS    = 2800;        // Technics 1200 motor-off coast
const LOCK_SNAP   = -0.5;        // degrees backward snap at stop
const FLUTTER_PX  = 0.5;         // wow & flutter amplitude
const RING_DRAW_MS = 800;        // LED ring stroke-dashoffset draw time
const RING_CIRCUM = 2 * Math.PI * 268; // SVG ring radius = 268

/* ── SVG micro-groove overlay ─────────────────────────────── */

function Grooves({ size }: { size: number }) {
  const r0 = size * 0.18;       // first groove at ~18%
  const r1 = size * 0.47;       // last groove at ~47%
  const count = 50;
  const step = (r1 - r0) / count;
  const cx = size / 2;
  return (
    <svg
      className="mixi-splash-grooves"
      viewBox={`0 0 ${size} ${size}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          cx={cx} cy={cx}
          r={r0 + i * step}
          fill="none"
          stroke="rgba(255,255,255,0.02)"
          strokeWidth="0.5"
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
      {/* Glow layer (blurred, behind) */}
      <svg className={cls('glow')} viewBox="0 0 540 540">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0.5" x2="1" y2="0.5">
            <stop offset="0%" stopColor="#00f0ff" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#ff6a00" />
          </linearGradient>
        </defs>
        <circle cx="270" cy="270" r="268"
          fill="none" stroke="url(#ringGrad)" strokeWidth="6"
          strokeDasharray={RING_CIRCUM}
          strokeDashoffset={drawing ? 0 : RING_CIRCUM}
          strokeLinecap="round"
        />
      </svg>
      {/* Core layer (sharp, on top) */}
      <svg className={cls('core')} viewBox="0 0 540 540">
        <circle cx="270" cy="270" r="268"
          fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5"
          strokeDasharray={RING_CIRCUM}
          strokeDashoffset={drawing ? 0 : RING_CIRCUM}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

/* ── Spindle hole overlay ─────────────────────────────────── */

function SpindleHole() {
  return (
    <div className="mixi-splash-spindle">
      <div className="mixi-splash-spindle-inner" />
    </div>
  );
}

/* ── Anisotropic reflection (stays still while disc spins) ── */

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
  const containerRef = useRef<HTMLDivElement>(null);
  const vinylRef = useRef<HTMLImageElement>(null);
  const discRef = useRef<HTMLButtonElement>(null);
  const rafRef = useRef(0);
  const skipRef = useRef(false);
  const angleRef = useRef(0);

  // ── Vinyl spin physics (Technics 1200 decel) ────────────────

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
        setTimeout(() => setPhase('ready'), RING_DRAW_MS + 200);
        return;
      }

      const dt = now - lastTime;
      lastTime = now;
      const elapsed = now - stageStart;

      // Wow & flutter
      flutterPhase += dt * 0.003;
      const flutter = Math.sin(flutterPhase) * FLUTTER_PX;

      if (stage === 'spin') {
        angle += FULL_SPEED * (dt / 1000);
        if (elapsed >= SPIN_MS) { stage = 'decel'; stageStart = now; }
      } else if (stage === 'decel') {
        // Technics 1200 motor-off: exponential decay
        const t = Math.min(elapsed / DECEL_MS, 1);
        const speed = FULL_SPEED * Math.max(0, 1 - Math.pow(t, 0.35));
        angle += speed * (dt / 1000);
        if (t >= 1) { stage = 'lock'; stageStart = now; }
      } else if (stage === 'lock') {
        // Magnetic lock snap: -0.5° + contrast flash
        angle += LOCK_SNAP;
        stage = 'done';
        if (vinylRef.current) {
          vinylRef.current.style.filter = 'contrast(1.1)';
          setTimeout(() => {
            if (vinylRef.current) vinylRef.current.style.filter = '';
          }, 200);
        }
        setPhase('ring-draw');
        setTimeout(() => setPhase('ready'), RING_DRAW_MS + 200);
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

  // ── Skip animation (Enter/Space during spin) (#29) ─────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Enter' || e.key === ' ') && phase === 'spin') {
        skipRef.current = true;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // ── 3D parallax hover (#16) ─────────────────────────────────

  const handleMouseMove = useCallback((e: RME<HTMLButtonElement>) => {
    if (phase !== 'ready' || !discRef.current) return;
    const rect = discRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    discRef.current.style.transform =
      `perspective(600px) rotateY(${dx * 4}deg) rotateX(${-dy * 4}deg)`;
  }, [phase]);

  const handleMouseLeave = useCallback(() => {
    if (discRef.current) {
      discRef.current.style.transform = '';
    }
  }, []);

  // ── Dive transition (#23-25) ─────────────────────────────

  const handleLaunch = useCallback(async () => {
    if (phase !== 'ready') return;
    setPhase('dive');

    await new Promise((r) => setTimeout(r, 60));

    // Strobe and spin dive
    if (discRef.current) {
      discRef.current.style.transition = 'transform 0.6s cubic-bezier(0.5, 0, 0, 1), filter 0.6s ease-in';
      discRef.current.style.transform = 'scale(1.3) translateY(-10px) rotateX(20deg)';
      discRef.current.style.filter = 'blur(16px) brightness(2)';
    }

    if (vinylRef.current) {
      vinylRef.current.style.transition = 'transform 0.6s cubic-bezier(0.8, 0, 0.2, 1)';
      vinylRef.current.style.transform = `rotate(${(angleRef.current || 0) + 720}deg)`;
    }

    // Hardware-accelerated strobe effect
    let st = true;
    const interval = setInterval(() => {
      if (containerRef.current) containerRef.current.style.backgroundColor = st ? '#fff' : '#0c0d12';
      st = !st;
    }, 40);

    await new Promise((r) => setTimeout(r, 600));
    clearInterval(interval);

    if (containerRef.current) {
      containerRef.current.style.transition = 'opacity 0.4s ease-out, background-color 0.2s';
      containerRef.current.style.backgroundColor = '#0c0d12';
      containerRef.current.style.opacity = '0';
    }

    await new Promise((r) => setTimeout(r, 450));
    await onStart();
  }, [phase, onStart]);

  const isDrawing = phase === 'ring-draw' || phase === 'ready' || phase === 'dive';
  const isReady = phase === 'ready';
  const isDive = phase === 'dive';

  return (
    <div
      ref={containerRef}
      className="mixi-splash"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && isReady) handleLaunch();
      }}
    >
      {/* #26: vignettatura inversa — subtle blue-gray glow behind disc */}
      <div className="mixi-splash-bg-glow" />

      <div className="mixi-splash-noise" />
      <div className="mixi-splash-scanlines" />
      <div className="mixi-splash-vignette" />
      <div className="mixi-splash-chromatic" />

      <div className="mixi-splash-center">
        <button
            ref={discRef}
            className={`mixi-splash-vinyl-btn${isReady ? ' is-ready' : ''}${isDive ? ' is-dive' : ''}`}
            onClick={handleLaunch}
            disabled={!isReady}
            type="button"
            aria-label="Launch Mixi"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* #14: background light spill from ring */}
            {isDrawing && <div className="mixi-splash-light-spill" />}

            {/* #11-13: LED ring */}
            <LedRing drawing={isDrawing} ready={isReady} />

            {/* #3: anisotropic reflection — stays fixed */}
            <AnisotropicReflection />

            {/* Vinyl PNG (rotated by JS) */}
            <img ref={vinylRef} src={vinylImg} alt="" className="mixi-splash-vinyl" draggable={false} />

            {/* #4: micro-grooves SVG overlay */}
            <Grooves size={520} />

            {/* #2: spindle hole */}
            <SpindleHole />
          </button>
      </div>
    </div>
  );
};
