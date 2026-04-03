/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Rotary Knob Control
//
// A custom SVG rotary knob inspired by Pioneer/Allen & Heath
// hardware. No <input type="range"> — pure pointer-drag.
//
// Interaction:
//   Drag UP   → increase value
//   Drag DOWN → decrease value
//   Sensitivity: 200 px of vertical travel = full range
//
// Visual:
//   270° arc from -135° to +135° (12 o'clock = centre).
//   Dark body with a luminous indicator line that rotates.
//   Bipolar mode: arc lights up from centre outward (for EQ/FX).
//   Unipolar mode: arc lights up from min to current value.
// ─────────────────────────────────────────────────────────────

import { useCallback, useRef, useEffect, useState, useId, type FC } from 'react';
import { useDrag } from '../../hooks/useDrag';
import { useMidiStore } from '../../store/midiStore';

// ── Constants ────────────────────────────────────────────────

/** Total angular sweep of the knob in degrees. */
const ARC_DEGREES = 270;
/** Half sweep — the indicator starts at -135° from 12 o'clock. */
const HALF_ARC = ARC_DEGREES / 2;
/** Pixels of vertical drag to traverse the full range. */
const DRAG_SENSITIVITY = 200;

// SVG geometry
const SIZE = 48;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 18;
const INDICATOR_INNER = 6;
const INDICATOR_OUTER = 17;

// ── Types ────────────────────────────────────────────────────

export interface KnobProps {
  /** Current value. */
  value: number;
  /** Range minimum. */
  min: number;
  /** Range maximum. */
  max: number;
  /** Fires on every drag frame with the new value. */
  onChange: (value: number) => void;
  /** Label rendered below the knob (e.g. "HI", "MID", "LOW"). */
  label?: string;
  /**
   * If true, the arc lights up outward from the centre point.
   * Used for EQ and Color FX.
   */
  bipolar?: boolean;
  /**
   * Override the centre value for bipolar mode.
   * Default: (min+max)/2. For EQ set to 0 so 0dB is at 12 o'clock
   * even with asymmetric ranges like -26 to +6.
   */
  center?: number;
  /** Accent colour for the active arc & indicator. */
  color?: string;
  /** Size multiplier (1 = 48px). */
  scale?: number;
  /**
   * Ghost mode: when true, the arc turns purple to indicate
   * the AI is controlling this knob, not the human.
   */
  ghost?: boolean;
  /**
   * Default value restored on double-click.
   * For bipolar knobs this is typically the centre (auto-calculated).
   * For unipolar knobs pass explicitly (e.g. 1.0 for gain).
   */
  defaultValue?: number;
  /** Show the current value as text below the label. */
  showValue?: boolean;
  /** Unit suffix for the value readout (e.g. "dB"). */
  unit?: string;
  /** Kill callback — when provided, LCD shows KILL on hover instead of value. */
  onKill?: () => void;
  /** Whether the band is currently killed (EQ at -inf). */
  killed?: boolean;
  /** Fires when drag starts. */
  onDragStart?: () => void;
  /** Fires when drag ends. */
  onDragEnd?: () => void;
  /** MIDI Action mapping. If provided, this knob is MIDI learnable. */
  midiAction?: any;
}

// ── Helpers ──────────────────────────────────────────────────

/** Map a value from [min, max] to [0, 1]. */
function normalise(value: number, min: number, max: number): number {
  return (value - min) / (max - min);
}

/**
 * Non-linear normalise with explicit centre point.
 * Maps: min→0, centre→0.5, max→1.
 * Two linear segments joined at 0.5.
 */
function normaliseCentred(value: number, min: number, max: number, centre: number): number {
  if (value <= centre) {
    // min→centre maps to 0→0.5
    return centre === min ? 0.5 : 0.5 * (value - min) / (centre - min);
  }
  // centre→max maps to 0.5→1
  return centre === max ? 0.5 : 0.5 + 0.5 * (value - centre) / (max - centre);
}

/** Polar to cartesian for SVG arc drawing. */
function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0° = 12 o'clock
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Build an SVG arc path string. */
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  // Ensure we always go from smaller to larger angle for the arc.
  if (startAngle > endAngle) [startAngle, endAngle] = [endAngle, startAngle];
  const start = polarToXY(cx, cy, r, startAngle);
  const end = polarToXY(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

// ── Component ────────────────────────────────────────────────

/** Ghost color — electric purple (AI is in control). */
const COLOR_GHOST = 'var(--clr-master)';

export const Knob: FC<KnobProps> = ({
  value,
  min,
  max,
  onChange,
  label,
  bipolar = false,
  center: centerProp,
  color = 'var(--clr-a)',
  scale = 1,
  ghost = false,
  defaultValue,
  showValue = false,
  unit = '',
  onKill,
  killed = false,
  onDragStart: onDragStartCb,
  onDragEnd: onDragEndCb,
  midiAction,
}) => {
  // Centre point for bipolar: explicit prop or midpoint of range.
  const centre = centerProp ?? (min + max) / 2;

  // When ghost is active, override the arc color to purple.
  const arcColor = ghost ? COLOR_GHOST : color;
  const valueAtDragStart = useRef(value);

  // Double-click → reset to centre (or explicit default).
  const resetValue = defaultValue ?? (bipolar ? centre : undefined);
  const handleDoubleClick = useCallback(() => {
    if (resetValue !== undefined) onChange(resetValue);
  }, [onChange, resetValue]);

  const onDrag = useCallback(
    (_dx: number, dy: number) => {
      const range = max - min;
      const delta = (-dy / DRAG_SENSITIVITY) * range;
      const raw = valueAtDragStart.current + delta;
      const clamped = Math.min(max, Math.max(min, raw));

      // Snap to centre in bipolar mode when within 2% of range.
      if (bipolar) {
        const snapZone = range * 0.02;
        if (Math.abs(clamped - centre) < snapZone) {
          onChange(centre);
          return;
        }
      }

      onChange(clamped);
    },
    [min, max, onChange, bipolar, centre],
  );

  const [isDragging, setIsDragging] = useState(false);

  const { onPointerDown } = useDrag({
    onDrag,
    onDragEnd: () => { setIsDragging(false); onDragEndCb?.(); },
  });

  // Capture value at drag start so delta is always from the initial position.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Intercept for MIDI learn
      if (midiAction && (window as any).__MIXIMIDILEARN__ && useMidiStore.getState().isLearning) {
        e.preventDefault();
        e.stopPropagation();
        (window as any).__MIXIMIDILEARN__(midiAction);
        return;
      }
      valueAtDragStart.current = value;
      setIsDragging(true);
      onDragStartCb?.();
      onPointerDown(e);
    },
    [value, onPointerDown, onDragStartCb, midiAction],
  );

  // ── Zero detent flash ─────────────────────────────────────
  // Brief white flash on the indicator when snapping to centre.

  const [detentFlash, setDetentFlash] = useState(false);
  const prevAtCentre = useRef(false);

  const isAtCentre = bipolar && value === centre;

  useEffect(() => {
    if (isAtCentre && !prevAtCentre.current) {
      setDetentFlash(true);
      const t = setTimeout(() => setDetentFlash(false), 150);
      return () => clearTimeout(t);
    }
    prevAtCentre.current = isAtCentre;
  }, [isAtCentre]);

  // ── Compute visuals ──────────────────────────────────────

  const gradId = useId();

  // When a custom centre is set, use non-linear mapping so
  // the centre value always lands at 12 o'clock (norm 0.5).
  const hasCentre = centerProp !== undefined && bipolar;
  const norm = hasCentre
    ? normaliseCentred(value, min, max, centre)
    : normalise(value, min, max);
  const angleDeg = -HALF_ARC + norm * ARC_DEGREES; // -135 to +135

  // Indicator line endpoint
  const indInner = polarToXY(CX, CY, INDICATOR_INNER, angleDeg);
  const indOuter = polarToXY(CX, CY, INDICATOR_OUTER, angleDeg);

  // Active arc
  let arcPath: string;
  if (bipolar) {
    // Centre is always at norm 0.5 → angle 0° (12 o'clock)
    const centreAngle = 0; // Always 12 o'clock when centre is explicit
    arcPath =
      centreAngle === angleDeg ? '' : describeArc(CX, CY, RADIUS, centreAngle, angleDeg);
  } else {
    // Arc from min (-135°) to current angle.
    arcPath =
      norm === 0 ? '' : describeArc(CX, CY, RADIUS, -HALF_ARC, angleDeg);
  }

  // Track arc (full background arc)
  const trackPath = describeArc(CX, CY, RADIUS, -HALF_ARC, HALF_ARC);

  const s = SIZE * scale;

  return (
    <div className="group flex flex-col items-center gap-1 select-none touch-none">
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="cursor-grab active:cursor-grabbing transition-transform duration-100"
        style={{ transform: isDragging ? 'scale(1.06)' : 'scale(1)' }}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      >
        {/* Outer ring – dark metallic body */}
        <circle
          cx={CX}
          cy={CY}
          r={RADIUS + 2}
          fill="none"
          stroke="var(--brd-default)"
          strokeWidth={1}
        />
        {/* Knob body — cylindrical with zenithal light */}
        <circle cx={CX} cy={CY} r={RADIUS} fill="var(--srf-mid)" />
        <circle
          cx={CX}
          cy={CY}
          r={RADIUS}
          fill={`url(#${gradId})`}
          opacity={0.5}
        />

        {/* Track arc (dim groove) */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--brd-subtle)"
          strokeWidth={3.5}
          strokeLinecap="round"
        />

        {/* Active arc — subsurface scattering glow layer (wide, soft) */}
        {arcPath && (
          <path
            d={arcPath}
            fill="none"
            stroke={arcColor}
            strokeWidth={7}
            strokeLinecap="round"
            opacity={ghost ? 0.3 : 0.2}
            style={{ filter: `blur(3px)` }}
          />
        )}

        {/* Active arc — main bright line */}
        {arcPath && (
          <path
            d={arcPath}
            fill="none"
            stroke={arcColor}
            strokeWidth={3}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${arcColor}) drop-shadow(0 0 1px ${arcColor})` }}
          />
        )}

        {/* Indicator line */}
        <line
          x1={indInner.x}
          y1={indInner.y}
          x2={indOuter.x}
          y2={indOuter.y}
          stroke={isAtCentre ? 'var(--txt-white)' : 'var(--txt-bright)'}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{
            filter: detentFlash
              ? 'drop-shadow(0 0 6px #fff) drop-shadow(0 0 2px #fff)'
              : isAtCentre
                ? 'drop-shadow(0 0 4px rgba(255,255,255,0.6)) drop-shadow(0 0 1px #fff)'
                : 'drop-shadow(0 0 2px rgba(255,255,255,0.15))',
            transition: 'filter 0.06s ease-out, stroke 0.1s ease-out',
          }}
        />

        {/* Radial gradient — zenithal light reflection */}
        <defs>
          <radialGradient id={gradId} cx="38%" cy="30%" r="60%">
            <stop offset="0%" stopColor="var(--txt-secondary)" />
            <stop offset="50%" stopColor="var(--srf-light)" />
            <stop offset="100%" stopColor="var(--srf-base)" />
          </radialGradient>
        </defs>
      </svg>

      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          {label}
        </span>
      )}
      {showValue && (
        isDragging ? (
          /* Value readout — visible while dragging */
          <span
            className="text-[8px] font-mono font-medium rounded px-1.5 py-0.5 -mt-0.5 opacity-90"
            style={{
              background: 'var(--srf-base)',
              border: `1px solid ${arcColor}15`,
              color: arcColor,
              textShadow: `0 0 6px ${arcColor}44`,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
            }}
          >
            {Math.round(value)}{unit}
          </span>
        ) : onKill ? (
          /* Kill button — visible on hover when not dragging */
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            className={`text-[7px] font-mono font-bold tracking-wider rounded px-1.5 py-0.5 -mt-0.5 transition-all duration-150 cursor-pointer
              ${killed
                ? 'opacity-90'
                : 'opacity-0 group-hover:opacity-90'
              }`}
            style={{
              background: killed ? 'rgba(220,38,38,0.15)' : 'var(--srf-base)',
              border: `1px solid ${killed ? 'var(--clr-kill)66' : 'var(--brd-subtle)'}`,
              color: killed ? 'var(--clr-kill)' : 'var(--txt-secondary)',
              textShadow: killed ? '0 0 4px var(--clr-kill)66' : 'none',
              boxShadow: killed ? '0 0 6px rgba(220,38,38,0.2)' : 'inset 0 1px 2px rgba(0,0,0,0.5)',
            }}
          >
            KILL
          </button>
        ) : (
          /* Value readout — visible on hover */
          <span
            className="text-[8px] font-mono font-medium rounded px-1.5 py-0.5 -mt-0.5 transition-opacity duration-150 opacity-0 group-hover:opacity-90"
            style={{
              background: 'var(--srf-base)',
              border: `1px solid ${arcColor}15`,
              color: arcColor,
              textShadow: `0 0 6px ${arcColor}44`,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
            }}
          >
            {Math.round(value)}{unit}
          </span>
        )
      )}
    </div>
  );
};
