/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Premium Jog Wheel (SVG + rAF)
//
// Ultra-premium CDJ-style platter with:
//   - Archimedean spiral (replaces concentric grooves)
//   - Triband audio-reactive spiral glow (bass/mid/high)
//   - Metallic Apple-style finish with 3D depth
//   - LED ring with gradient + bass-reactive pulse
//   - Comet-trail rotation marker
//
// Performance: all animation via direct DOM refs in rAF — zero
// React re-renders during playback.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useMemo, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import type { DeckId } from '../../types';

// ── SVG Geometry ────────────────────────────────────────────

const VB = 200;
const CX = VB / 2;
const CY = VB / 2;

const R_BEZEL = 96;
const R_PLATTER = 90;
const R_LED = 82;
const R_LABEL = 20;
const R_LABEL_BEZEL = 21;
const R_MARKER = 76;
const R_TICK = 98;

// Spiral config
const SPIRAL_R_MIN = 26;      // inner radius (just outside label)
const SPIRAL_R_MAX = 74;      // outer radius (just inside LED ring)
const SPIRAL_TURNS = 6;       // fewer turns = visible spiral shape
const SPIRAL_POINTS = 200;    // points per zone for smoothness

// Band boundaries (normalized 0-1 of spiral radius range)
const BAND_BASS = 0.38;       // inner 38% = bass
const BAND_MID = 0.72;        // next 34% = mid
                               // remaining 28% = high

// LED ring config — round dots (strokeLinecap round + dash 0)
const LED_DOT_GAP = 7.2;          // gap between dot centers
const LED_DASH = `0.01 ${LED_DOT_GAP}`;
const LED_WIDTH = 3.5;             // dot diameter
const LED_WIDTH_CORE = 2;

interface PremiumJogWheelProps {
  deckId: DeckId;
  color: string;
  size?: number;
}

// ── Spiral path generator ──────────────────────────────────

function spiralPath(
  cx: number, cy: number,
  rMin: number, rMax: number,
  turns: number, points: number,
  startNorm: number, endNorm: number,
): string {
  const totalAngle = turns * 2 * Math.PI;
  const rRange = rMax - rMin;
  const startAngle = startNorm * totalAngle;
  const endAngle = endNorm * totalAngle;
  const stepAngle = (endAngle - startAngle) / points;

  const parts: string[] = [];
  for (let i = 0; i <= points; i++) {
    const angle = startAngle + i * stepAngle;
    const norm = angle / totalAngle;
    const r = rMin + norm * rRange;
    const x = cx + r * Math.cos(angle - Math.PI / 2);
    const y = cy + r * Math.sin(angle - Math.PI / 2);
    parts.push(i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return parts.join(' ');
}

// ── Component ──────────────────────────────────────────────

export const PremiumJogWheel: FC<PremiumJogWheelProps> = ({
  deckId,
  color,
  size = 200,
}) => {
  const wheelRef = useRef<SVGGElement>(null);
  const beatRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const [booted, setBooted] = useState(false);

  // Audio-reactive refs (direct DOM manipulation — no re-renders)
  const ledRingRef = useRef<SVGCircleElement>(null);
  const ledCoreRef = useRef<SVGCircleElement>(null);
  const coronaRef = useRef<SVGCircleElement>(null);
  const spiralBassRef = useRef<SVGPathElement>(null);
  const spiralMidRef = useRef<SVGPathElement>(null);
  const spiralHighRef = useRef<SVGPathElement>(null);
  const bezelGlowRef = useRef<SVGCircleElement>(null);

  // Smoothed band levels for gentle transitions
  const smoothBass = useRef(0);
  const smoothMid = useRef(0);
  const smoothHigh = useRef(0);

  // Pre-compute spiral paths (static — only computed once)
  const spiralPaths = useMemo(() => ({
    bass: spiralPath(CX, CY, SPIRAL_R_MIN, SPIRAL_R_MAX, SPIRAL_TURNS, SPIRAL_POINTS, 0, BAND_BASS),
    mid: spiralPath(CX, CY, SPIRAL_R_MIN, SPIRAL_R_MAX, SPIRAL_TURNS, SPIRAL_POINTS, BAND_BASS, BAND_MID),
    high: spiralPath(CX, CY, SPIRAL_R_MIN, SPIRAL_R_MAX, SPIRAL_TURNS, SPIRAL_POINTS, BAND_MID, 1),
    full: spiralPath(CX, CY, SPIRAL_R_MIN, SPIRAL_R_MAX, SPIRAL_TURNS, SPIRAL_POINTS * 3, 0, 1),
  }), []);

  // Boot-up animation
  const isLoaded = useMixiStore((s) => s.decks[deckId].isTrackLoaded);
  useEffect(() => {
    if (isLoaded && !booted) setBooted(true);
  }, [isLoaded, booted]);

  // Touch-down press effect
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const down = () => { el.style.transform = 'translateY(1px)'; el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)'; };
    const up = () => { el.style.transform = ''; el.style.boxShadow = ''; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); el.removeEventListener('pointerleave', up); };
  }, []);

  // rAF loop: rotation + beat counter + triband spiral + LED pulse
  useEffect(() => {
    const engine = MixiEngine.getInstance();
    let lastBeatUpdate = 0;
    // Reusable buffer for frequency data
    let freqBuf: Uint8Array<ArrayBuffer> | null = null;
    let frameSkip = 0;

    function tick() {
      const deck = useMixiStore.getState().decks[deckId];
      const g = wheelRef.current;
      const beatEl = beatRef.current;

      if (engine.isInitialized && deck.isPlaying && g) {
        const t = engine.getCurrentTime(deckId);
        const rpm = 33.333 * deck.playbackRate;
        const deg = (t * rpm * 6) % 360;
        g.style.transform = `rotate(${deg}deg)`;

        const now = performance.now();
        if (beatEl && deck.bpm > 0 && now - lastBeatUpdate > 80) {
          lastBeatUpdate = now;
          const beatPeriod = 60 / deck.bpm;
          const beat = (t - deck.firstBeatOffset) / beatPeriod;
          beatEl.textContent = String((((Math.floor(beat) % 4) + 4) % 4) + 1);
        }

        // ── Triband frequency analysis (throttled to ~30fps) ──
        const analyser = (frameSkip = (frameSkip + 1) % 2) === 0
          ? engine.getDeckAnalyser(deckId) : null;
        if (analyser) {
          if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
            freqBuf = new Uint8Array(analyser.frequencyBinCount);
          }
          analyser.getByteFrequencyData(freqBuf);

          const binCount = freqBuf.length;
          // Bass: 0-250 Hz → bins 0-~6% of spectrum
          // Mid: 250-4000 Hz → bins ~6%-~45%
          // High: 4000+ Hz → bins ~45%+
          const bassBins = Math.floor(binCount * 0.06);
          const midBins = Math.floor(binCount * 0.45);

          let bassSum = 0, midSum = 0, highSum = 0;
          for (let i = 0; i < bassBins; i++) bassSum += freqBuf[i];
          for (let i = bassBins; i < midBins; i++) midSum += freqBuf[i];
          for (let i = midBins; i < binCount; i++) highSum += freqBuf[i];

          const bassLevel = Math.min(1, (bassSum / (bassBins * 255)) * 2.5);
          const midLevel = Math.min(1, (midSum / ((midBins - bassBins) * 255)) * 3);
          const highLevel = Math.min(1, (highSum / ((binCount - midBins) * 255)) * 4);

          // Smooth with EMA (attack fast, release slow)
          const attack = 0.6;
          const release = 0.85;
          smoothBass.current = bassLevel > smoothBass.current
            ? smoothBass.current * (1 - attack) + bassLevel * attack
            : smoothBass.current * release;
          smoothMid.current = midLevel > smoothMid.current
            ? smoothMid.current * (1 - attack) + midLevel * attack
            : smoothMid.current * release;
          smoothHigh.current = highLevel > smoothHigh.current
            ? smoothHigh.current * (1 - attack) + highLevel * attack
            : smoothHigh.current * release;

          // Apply to spiral zone refs — 0 at rest, glow on activity
          if (spiralBassRef.current) spiralBassRef.current.style.opacity = String(smoothBass.current * 0.4);
          if (spiralMidRef.current) spiralMidRef.current.style.opacity = String(smoothMid.current * 0.3);
          if (spiralHighRef.current) spiralHighRef.current.style.opacity = String(smoothHigh.current * 0.2);

          // Bezel kick pulse — soft glow on bass hits
          if (bezelGlowRef.current) {
            bezelGlowRef.current.style.opacity = String(smoothBass.current * 0.2);
          }
        }

        // LED pulse from overall level
        const level = engine.getLevel(deckId);
        const pulse = 0.55 + level * 0.45;
        if (ledRingRef.current) ledRingRef.current.style.opacity = String(pulse);
        if (ledCoreRef.current) ledCoreRef.current.style.opacity = String(0.15 + level * 0.25);
        if (coronaRef.current) coronaRef.current.style.opacity = String(0.04 + level * 0.12);
      } else {
        if (beatEl) beatEl.textContent = '';
        // Fade spiral when stopped
        if (spiralBassRef.current) spiralBassRef.current.style.opacity = '0';
        if (spiralMidRef.current) spiralMidRef.current.style.opacity = '0';
        if (spiralHighRef.current) spiralHighRef.current.style.opacity = '0';
        if (bezelGlowRef.current) bezelGlowRef.current.style.opacity = '0';
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [deckId]);

  // SVG IDs
  const glow = `jog-glow-${deckId}`;
  const coronaId = `jog-corona-${deckId}`;
  const platterId = `jog-platter-${deckId}`;
  const metalId = `jog-metal-${deckId}`;
  const centerId = `jog-center-${deckId}`;
  const bezelGrad = `jog-bezel-${deckId}`;
  const glassId = `jog-glass-${deckId}`;
  const ledGradId = `jog-led-grad-${deckId}`;

  return (
    <div
      ref={containerRef}
      className="relative select-none touch-none"
      style={{
        width: size,
        height: size,
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
        borderRadius: '50%',
        transition: 'transform 0.08s ease-out, box-shadow 0.08s ease-out',
        WebkitUserDrag: 'none',
      } as React.CSSProperties}
    >
      <svg
        width={size}
        height={size}
        viewBox={`-10 -10 ${VB + 20} ${VB + 20}`}
        className="block overflow-visible"
      >
        <defs>
          {/* Neon glow for LED ring */}
          <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Corona blur */}
          <filter id={coronaId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
          </filter>

          {/* Bezel — 3D bevel gradient */}
          <linearGradient id={bezelGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#444" />
            <stop offset="15%" stopColor="#333" />
            <stop offset="50%" stopColor="#181818" />
            <stop offset="85%" stopColor="#0a0a0a" />
            <stop offset="100%" stopColor="#151515" />
          </linearGradient>

          {/* Platter — metallic radial with off-center hotspot */}
          <radialGradient id={platterId} cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor="#2a2a2c" />
            <stop offset="35%" stopColor="#1c1c1e" />
            <stop offset="100%" stopColor="#0c0c0d" />
          </radialGradient>

          {/* Metallic sheen overlay — simulates brushed aluminum reflection */}
          <radialGradient id={metalId} cx="30%" cy="25%" r="80%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.01)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>

          {/* Centre OLED display */}
          <radialGradient id={centerId} cx="45%" cy="38%" r="75%">
            <stop offset="0%" stopColor="#0a0e18" />
            <stop offset="100%" stopColor="#050810" />
          </radialGradient>

          {/* Glass reflection */}
          <radialGradient id={glassId} cx="50%" cy="25%" r="60%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>

          {/* LED ring gradient */}
          <linearGradient id={ledGradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="30%" stopColor={color} stopOpacity="1" />
            <stop offset="70%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.7" />
          </linearGradient>

          {/* Spiral taper mask — fades at outer edge */}
          <mask id={`${deckId}-spiral-mask`}>
            <radialGradient id={`${deckId}-spiral-fade`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" />
              <stop offset="72%" stopColor="white" />
              <stop offset="95%" stopColor="white" stopOpacity="0.3" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <rect x="0" y="0" width={VB} height={VB} fill={`url(#${deckId}-spiral-fade)`} />
          </mask>
        </defs>

        {/* ── L1: Bezel — 3D beveled ring ──────────────────────── */}
        <circle
          cx={CX} cy={CY} r={R_BEZEL}
          fill="#0e0e0e"
          stroke={`url(#${bezelGrad})`}
          strokeWidth="2.5"
        />
        {/* Bezel inner shadow */}
        <circle
          cx={CX} cy={CY} r={R_BEZEL - 1.5}
          fill="none"
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="1"
        />
        {/* Bezel kick glow — bass-reactive, ref-driven */}
        <circle
          ref={bezelGlowRef}
          cx={CX} cy={CY} r={R_BEZEL + 1}
          fill="none"
          stroke={color}
          strokeWidth="5"
          opacity="0"
          filter={`url(#${coronaId})`}
        />

        {/* ── L2: Platter surface — metallic finish ────────────── */}
        <circle
          cx={CX} cy={CY} r={R_PLATTER}
          fill={`url(#${platterId})`}
          stroke="#1a1a1a"
          strokeWidth="0.5"
        />
        {/* Metallic sheen overlay */}
        <circle
          cx={CX} cy={CY} r={R_PLATTER}
          fill={`url(#${metalId})`}
        />

        {/* ── L3: Ghost LED ring (unlit dots — always visible) ─── */}
        <circle
          cx={CX} cy={CY} r={R_LED}
          fill="none"
          stroke="var(--srf-mid)"
          strokeWidth={LED_WIDTH}
          strokeDasharray={LED_DASH}
          strokeLinecap="round"
          opacity="0.5"
        />

        {/* ── L4: LED corona ───────────────────────────────────── */}
        <LedCorona deckId={deckId} color={color} coronaId={coronaId} booted={booted} coronaRef={coronaRef} />

        {/* ── L5: LED ring — gradient + reactive ───────────────── */}
        <LedRing deckId={deckId} color={color} glowId={glow} booted={booted} ledGradId={ledGradId} ledRingRef={ledRingRef} ledCoreRef={ledCoreRef} />

        {/* ── L6: Rotating elements ────────────────────────────── */}
        <g
          ref={wheelRef}
          style={{ transformOrigin: `${CX}px ${CY}px`, willChange: 'transform' }}
        >
          {/* ── Spiral groove (dark, always visible) ────────────── */}
          <g mask={`url(#${deckId}-spiral-mask)`}>
          <path
            d={spiralPaths.full}
            fill="none"
            stroke="rgba(255,255,255,0.018)"
            strokeWidth="0.4"
          />
          {/* ── Spiral 3D shadow (offset) ─────────────────── */}
          <g transform="translate(0, 0.3)">
            <path
              d={spiralPaths.full}
              fill="none"
              stroke="rgba(0,0,0,0.12)"
              strokeWidth="0.5"
            />
          </g>
          </g>

          {/* ── Reactive spiral zones (masked for taper) ──────── */}
          <g mask={`url(#${deckId}-spiral-mask)`}>
          {/* Bass zone (inner) — deck color */}
          <path
            ref={spiralBassRef}
            d={spiralPaths.bass}
            fill="none"
            stroke={color}
            strokeWidth="0.8"
            opacity="0"
            strokeLinecap="round"
          />
          {/* Mid zone (middle) — deck color, thinner */}
          <path
            ref={spiralMidRef}
            d={spiralPaths.mid}
            fill="none"
            stroke={color}
            strokeWidth="0.6"
            opacity="0"
            strokeLinecap="round"
          />
          {/* High zone (outer) — white, finest */}
          <path
            ref={spiralHighRef}
            d={spiralPaths.high}
            fill="none"
            stroke="#fff"
            strokeWidth="0.4"
            opacity="0"
            strokeLinecap="round"
          />
          </g>  {/* end masked reactive spiral */}

          {/* Rotation marker */}
          <RotationMarker color={color} deckId={deckId} />
        </g>

        {/* ── L8: Tick marks (12/3/6/9) ────────────────────────── */}
        {[0, 90, 180, 270].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const x1 = CX + Math.sin(rad) * (R_TICK - 2);
          const y1 = CY - Math.cos(rad) * (R_TICK - 2);
          const x2 = CX + Math.sin(rad) * (R_TICK + 1);
          const y2 = CY - Math.cos(rad) * (R_TICK + 1);
          return (
            <line
              key={angle}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="var(--brd-default)"
              strokeWidth="1"
              strokeLinecap="round"
            />
          );
        })}

        {/* ── L9: Centre display ───────────────────────────────── */}
        <circle cx={CX} cy={CY} r={R_LABEL_BEZEL} fill="none" stroke="var(--brd-strong)" strokeWidth="0.7" />
        <circle cx={CX} cy={CY} r={R_LABEL} fill={`url(#${centerId})`} stroke={`${color}15`} strokeWidth="0.5" />
        <circle cx={CX} cy={CY} r={R_LABEL} fill={`url(#${glassId})`} />        {/* Spindle reflex — micro arc highlight inside hole */}
        <path
          d={`M${CX - R_LABEL * 0.6},${CY - R_LABEL * 0.75} A${R_LABEL * 0.85},${R_LABEL * 0.85} 0 0,1 ${CX + R_LABEL * 0.6},${CY - R_LABEL * 0.75}`}
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="0.8"
          strokeLinecap="round"
          style={{ filter: 'blur(0.5px)' }}
        />
        {/* Outer rim light catch */}
        <circle cx={CX} cy={CY} r={R_BEZEL} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
      </svg>

      {/* ── HTML Centre Overlay ─────────────────────────────────── */}
      <CentreDisplay deckId={deckId} color={color} beatRef={beatRef} />
    </div>
  );
};

// ── LED Corona ─────────────────────────────────────────────

const LedCorona: FC<{ deckId: DeckId; color: string; coronaId: string; booted: boolean; coronaRef: React.RefObject<SVGCircleElement | null> }> = ({ deckId, color, coronaId, booted, coronaRef }) => {
  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  if (!booted) return null;
  return (
    <circle
      ref={coronaRef}
      cx={CX} cy={CY} r={R_LED}
      fill="none" stroke={color} strokeWidth="10"
      strokeDasharray={LED_DASH} strokeLinecap="round"
      opacity={isPlaying ? 0.08 : 0}
      filter={`url(#${coronaId})`}
    />
  );
};

// ── LED Ring ───────────────────────────────────────────────

const LedRing: FC<{
  deckId: DeckId; color: string; glowId: string; booted: boolean;
  ledGradId: string; ledRingRef: React.RefObject<SVGCircleElement | null>;
  ledCoreRef: React.RefObject<SVGCircleElement | null>;
}> = ({ deckId, color, glowId, booted, ledGradId, ledRingRef, ledCoreRef }) => {
  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  const isLoaded = useMixiStore((s) => s.decks[deckId].isTrackLoaded);

  const [sweepDone, setSweepDone] = useState(!booted);
  useEffect(() => {
    if (booted && !sweepDone) {
      const t = setTimeout(() => setSweepDone(true), 600);
      return () => clearTimeout(t);
    }
  }, [booted, sweepDone]);

  const cssClass = isPlaying ? 'transition-opacity duration-300' : isLoaded ? 'mixi-breathe' : 'transition-opacity duration-300';
  const showBoot = booted && !sweepDone;
  const circumference = 2 * Math.PI * R_LED;

  return (
    <>
      {showBoot && (
        <circle
          cx={CX} cy={CY} r={R_LED}
          fill="none" stroke={color} strokeWidth={LED_WIDTH}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference}
          strokeLinecap="round"
          filter={`url(#${glowId})`}
          opacity="0.9"
          style={{
            animation: 'jog-boot-sweep 0.5s ease-out forwards',
            transformOrigin: `${CX}px ${CY}px`,
            transform: 'rotate(-90deg)',
          }}
        />
      )}

      <circle
        ref={ledRingRef}
        cx={CX} cy={CY} r={R_LED}
        fill="none" stroke={`url(#${ledGradId})`}
        strokeWidth={LED_WIDTH} strokeDasharray={LED_DASH} strokeLinecap="round"
        opacity={isPlaying ? 0.7 : isLoaded ? 0.08 : 0}
        filter={`url(#${glowId})`}
        className={cssClass}
      />
      <circle
        ref={ledCoreRef}
        cx={CX} cy={CY} r={R_LED}
        fill="none" stroke="#fff"
        strokeWidth={LED_WIDTH_CORE} strokeDasharray={LED_DASH} strokeLinecap="round"
        opacity={isPlaying ? 0.25 : 0}
      />
    </>
  );
};

// ── Rotation Marker ────────────────────────────────────────

const RotationMarker: FC<{ color: string; deckId: DeckId }> = ({ color, deckId }) => {
  const isPlaying = useMixiStore((s) => s.decks[deckId].isPlaying);
  return (
    <g>
      {isPlaying && (
        <ellipse
          cx={CX} cy={CY - R_MARKER + 1}
          rx="1.2" ry="6"
          fill={`${color}33`}
          style={{ filter: 'blur(1.5px)' }}
        />
      )}
      <circle cx={CX} cy={CY - R_MARKER} r="3" fill="#111" opacity="0.5" />
      <circle
        cx={CX} cy={CY - R_MARKER} r="2.5"
        fill="#fff"
        opacity={isPlaying ? 0.95 : 0.6}
        style={{
          filter: isPlaying
            ? `drop-shadow(0 0 3px ${color}) drop-shadow(0 0 6px ${color}88) drop-shadow(0 0 1px #fff)`
            : 'drop-shadow(0 0 2px rgba(255,255,255,0.6)) drop-shadow(0 0 4px rgba(255,255,255,0.3))',
        }}
      />
      {isPlaying && (
        <circle cx={CX} cy={CY - R_MARKER} r="2.5" fill={color} opacity="0.35" style={{ filter: 'blur(3px)' }} />
      )}
    </g>
  );
};

// ── Jog Eye — Audio-reactive iris inside centre dot ─────────
//
// A realistic eye rendered as an HTML overlay on the centre circle.
// Deck A and B eyes move in mirrored directions based on audio.
// The iris pulses with bass, the pupil dilates on beats, and
// iris fibers shimmer with high-frequency content.

const JogEye: FC<{ deckId: DeckId; color: string; beatRef: React.RefObject<HTMLSpanElement | null> }> = ({
  deckId, color,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef2 = useRef(0);
  const pupilRef = useRef(0.35); // normalised pupil size (0=tiny, 1=dilated)
  const lookRef = useRef({ x: 0, y: 0 }); // iris offset
  const prevBassRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isMirrored = deckId === 'B';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SIZE = 80; // canvas pixel size
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const eyeR = SIZE * 0.42; // outer iris radius

    function tick() {
      const engine = MixiEngine.getInstance();
      const deck = useMixiStore.getState().decks[deckId];

      let bassLevel = 0;
      let midLevel = 0;
      let highLevel = 0;

      if (engine.isInitialized && deck.isPlaying) {
        const analyser = engine.getDeckAnalyser(deckId);
        if (analyser) {
          const data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(data);
          const bins = data.length;
          const bassEnd = Math.floor(bins * 0.08);
          const midEnd = Math.floor(bins * 0.4);

          let bSum = 0, mSum = 0, hSum = 0;
          for (let i = 0; i < bassEnd; i++) bSum += data[i];
          for (let i = bassEnd; i < midEnd; i++) mSum += data[i];
          for (let i = midEnd; i < bins; i++) hSum += data[i];

          bassLevel = Math.min(1, (bSum / (bassEnd * 255)) * 2.5);
          midLevel = Math.min(1, (mSum / ((midEnd - bassEnd) * 255)) * 3);
          highLevel = Math.min(1, (hSum / ((bins - midEnd) * 255)) * 4);
        }
      }

      // Beat detection for pupil dilation
      const isBeat = bassLevel > 0.5 && bassLevel - prevBassRef.current > 0.12;
      prevBassRef.current = bassLevel;

      // Pupil: dilate on beat, contract slowly
      if (isBeat) {
        pupilRef.current = Math.min(1, pupilRef.current + 0.3);
      } else {
        pupilRef.current *= 0.94;
        pupilRef.current = Math.max(0.15, pupilRef.current);
      }
      const pupilSize = 0.25 + pupilRef.current * 0.25; // normalized 0.25-0.50 of eyeR

      // Eye direction: follows audio balance (mirrored for deck B)
      const targetX = (highLevel - 0.3) * 4 * (isMirrored ? -1 : 1);
      const targetY = (midLevel - 0.4) * 3;
      lookRef.current.x += (targetX - lookRef.current.x) * 0.08;
      lookRef.current.y += (targetY - lookRef.current.y) * 0.08;
      const lookX = lookRef.current.x * 3;
      const lookY = lookRef.current.y * 2;

      // ── Draw ─────────────────────────────────────────────────
      if (!ctx) return;
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Outer dark circle (sclera)
      ctx.beginPath();
      ctx.arc(cx, cy, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = '#080c14';
      ctx.fill();

      // Iris
      const irisCx = cx + lookX;
      const irisCy = cy + lookY;
      const irisR = eyeR * 0.82;

      // Iris gradient
      const irisGrad = ctx.createRadialGradient(irisCx, irisCy, irisR * 0.2, irisCx, irisCy, irisR);
      irisGrad.addColorStop(0, color);
      irisGrad.addColorStop(0.5, color + 'cc');
      irisGrad.addColorStop(0.8, color + '44');
      irisGrad.addColorStop(1, '#0a0e18');

      ctx.beginPath();
      ctx.arc(irisCx, irisCy, irisR, 0, Math.PI * 2);
      ctx.fillStyle = irisGrad;
      ctx.fill();

      // Iris fibers (radial lines)
      ctx.save();
      ctx.globalAlpha = 0.15 + highLevel * 0.3;
      const fiberCount = 24;
      for (let i = 0; i < fiberCount; i++) {
        const angle = (i / fiberCount) * Math.PI * 2;
        const innerR = irisR * (pupilSize + 0.05);
        const outerR = irisR * (0.85 + Math.sin(i * 3.7 + bassLevel * 5) * 0.1);
        ctx.beginPath();
        ctx.moveTo(
          irisCx + Math.cos(angle) * innerR,
          irisCy + Math.sin(angle) * innerR
        );
        ctx.lineTo(
          irisCx + Math.cos(angle) * outerR,
          irisCy + Math.sin(angle) * outerR
        );
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.restore();

      // Iris ring glow (bass pulse)
      ctx.beginPath();
      ctx.arc(irisCx, irisCy, irisR, 0, Math.PI * 2);
      ctx.strokeStyle = color + Math.floor(bassLevel * 80 + 20).toString(16).padStart(2, '0');
      ctx.lineWidth = 1.5 + bassLevel * 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = bassLevel * 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Pupil
      const pupilR = irisR * pupilSize;
      ctx.beginPath();
      ctx.arc(irisCx, irisCy, pupilR, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();

      // Pupil edge softness
      const pupilEdge = ctx.createRadialGradient(irisCx, irisCy, pupilR * 0.8, irisCx, irisCy, pupilR * 1.15);
      pupilEdge.addColorStop(0, 'transparent');
      pupilEdge.addColorStop(0.7, 'rgba(0,0,0,0.3)');
      pupilEdge.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(irisCx, irisCy, pupilR * 1.15, 0, Math.PI * 2);
      ctx.fillStyle = pupilEdge;
      ctx.fill();

      // Specular highlight (top-left)
      const specX = irisCx - irisR * 0.25 + lookX * 0.3;
      const specY = irisCy - irisR * 0.3 + lookY * 0.3;
      ctx.beginPath();
      ctx.ellipse(specX, specY, 3, 2.2, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();

      // Second smaller highlight
      ctx.beginPath();
      ctx.arc(irisCx + irisR * 0.15, irisCy + irisR * 0.2, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();

      rafRef2.current = requestAnimationFrame(tick);
    }

    rafRef2.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef2.current);
  }, [deckId, color]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${(R_LABEL * 2 / VB) * 100}%`,
        height: `${(R_LABEL * 2 / VB) * 100}%`,
        borderRadius: '50%',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
};

// ── Centre Display (delegated to JogEye) ───────────────────

const CentreDisplay: FC<{ deckId: DeckId; color: string; beatRef: React.RefObject<HTMLSpanElement | null> }> = (props) => {
  return <JogEye {...props} />;
};
