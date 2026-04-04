/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Master HUD (inline in top bar group)
//
// LIM indicator + Master/Filter/Dist/Punch knobs with icons.
// Each knob has an SVG icon above and smart label/value below.
// ─────────────────────────────────────────────────────────────

import { useCallback, useState, useEffect, useRef, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import { Knob } from '../controls/Knob';
import { COLOR_MASTER } from '../../theme';
import { isGhost } from '../../ai/ghostFields';

// ── SVG Icons (14×14, consistent with telemetry icons) ──────

/** Limiter — shield with exclamation */
const LimIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

/** Master volume — speaker */
const MstIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

/** Filter — funnel */
const FltIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

/** Distortion — lightning bolt */
const DistIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

/** Punch — eye / wake lock */
const PnchIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// ── Main component ─────────────────────────────────────────

export const MasterHud: FC = () => {
  const volume = useMixiStore((s) => s.master.volume);
  const filterKnob = useMixiStore((s) => s.master.filter);
  const distAmount = useMixiStore((s) => s.master.distortion);
  const punchAmount = useMixiStore((s) => s.master.punch);
  const setMasterVolume = useMixiStore((s) => s.setMasterVolume);
  const setMasterFilter = useMixiStore((s) => s.setMasterFilter);
  const setMasterDistortion = useMixiStore((s) => s.setMasterDistortion);
  const setMasterPunch = useMixiStore((s) => s.setMasterPunch);

  const onVolumeChange = useCallback(
    (v: number) => setMasterVolume(v),
    [setMasterVolume],
  );
  const onFilterChange = useCallback(
    (v: number) => setMasterFilter(v),
    [setMasterFilter],
  );
  const onDistChange = useCallback(
    (v: number) => setMasterDistortion(v),
    [setMasterDistortion],
  );
  const onPunchChange = useCallback(
    (v: number) => setMasterPunch(v),
    [setMasterPunch],
  );

  const db = volume > 0.001 ? Math.round(20 * Math.log10(volume)) : -60;
  const dbLabel = db <= -60 ? '-∞' : `${db}dB`;
  const filterActive = Math.abs(filterKnob) > 0.01;
  const distActive = distAmount > 0.01;
  const punchActive = punchAmount > 0.01;
  const filterLabel = filterKnob < -0.01 ? 'LPF' : filterKnob > 0.01 ? 'HPF' : 'Flt';

  return (
    <div className="flex items-center gap-2">
      <LimiterDot />
      <HudKnob
        value={volume} min={0} max={1}
        onChange={onVolumeChange}
        color={COLOR_MASTER}
        icon={<MstIcon color={COLOR_MASTER} />}
        label="Mst" valueText={dbLabel}
        ghost={isGhost('master.volume')}
        defaultValue={1}
        iconScale={0.8}
      />
      <HudKnob
        value={filterKnob} min={-1} max={1}
        onChange={onFilterChange}
        color={filterActive ? 'var(--clr-filter)' : 'var(--txt-muted)'}
        icon={<FltIcon color={filterActive ? 'var(--clr-filter)' : 'var(--txt-muted)'} />}
        label="Flt" valueText={filterLabel}
        defaultValue={0} bipolar
        ghost={isGhost('master.filter')}
        activeGlow={filterActive ? 'var(--clr-filter)' : undefined}
      />
      <HudKnob
        value={distAmount} min={0} max={1}
        onChange={onDistChange}
        color={distActive ? 'var(--status-error)' : 'var(--txt-muted)'}
        icon={<DistIcon color={distActive ? 'var(--status-error)' : 'var(--txt-muted)'} />}
        label="Dist" valueText={`${Math.round(distAmount * 100)}%`}
        defaultValue={0}
        ghost={isGhost('master.distortion')}
        activeGlow={distActive ? 'var(--status-error)' : undefined}
      />
      <HudKnob
        value={punchAmount} min={0} max={1}
        onChange={onPunchChange}
        color={punchActive ? 'var(--status-warn)' : 'var(--txt-muted)'}
        icon={<PnchIcon color={punchActive ? 'var(--status-warn)' : 'var(--txt-muted)'} />}
        label="Pnch" valueText={`${Math.round(punchAmount * 100)}%`}
        defaultValue={0}
        ghost={isGhost('master.punch')}
        activeGlow={punchActive ? 'var(--status-warn)' : undefined}
      />
    </div>
  );
};

// ── HudKnob with icon ──────────────────────────────────────

interface HudKnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  color: string;
  icon: React.ReactNode;
  label: string;
  valueText: string;
  ghost?: boolean;
  defaultValue?: number;
  bipolar?: boolean;
  iconScale?: number;
  activeGlow?: string;
}

const HudKnob: FC<HudKnobProps> = ({
  value, min, max, onChange, color, icon, ghost, defaultValue, bipolar, iconScale, activeGlow,
}) => {
  return (
    <div
      className="flex items-center gap-0.5"
      title={`${Math.round(value * 100)}%`}
      style={activeGlow ? { filter: `drop-shadow(0 0 4px ${activeGlow}44)` } : undefined}
    >
      <div style={iconScale ? { transform: `scale(${iconScale})` } : undefined}>
        {icon}
      </div>
      <Knob
        value={value} min={min} max={max}
        onChange={onChange} color={color}
        scale={0.5} ghost={ghost}
        defaultValue={defaultValue} bipolar={bipolar}
      />
    </div>
  );
};

// ── Limiter Dot ────────────────────────────────────────────

const LimiterDot: FC = () => {
  const [enabled, setEnabled] = useState(true);
  const dotRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      MixiEngine.getInstance().setLimiterEnabled(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized || !dotRef.current) return;
      const reduction = engine.getLimiterReduction();
      const absGR = Math.abs(reduction);
      const el = dotRef.current;
      const glow = glowRef.current;

      // 3-level visual feedback:
      //   idle:       absGR < 0.3  → dark (off)
      //   gentle:     0.3-3 dB    → amber glow (RMS compression, musical)
      //   emergency:  >3 dB       → red flash (peak rescue, safety)

      if (absGR > 3.0) {
        // ── EMERGENCY: Red flash (Hermite peak rescue) ──
        const intensity = Math.min(1, absGR / 8);
        const pulse = 0.8 + Math.random() * 0.2;
        el.style.backgroundColor = `rgba(220,38,38,${0.6 + intensity * 0.4})`;
        el.style.boxShadow = `0 0 ${4 + intensity * 14}px rgba(220,38,38,${0.5 + intensity * 0.5}), inset 0 0 4px rgba(255,120,120,${intensity * 0.5})`;
        if (glow) glow.style.opacity = String(pulse * intensity * 0.6);
        const clip = document.getElementById('mixi-clip-flash');
        if (clip) clip.style.opacity = String(intensity * 0.15);
      } else if (absGR > 0.3) {
        // ── GENTLE: Amber glow (RMS compression, musical) ──
        const intensity = Math.min(1, (absGR - 0.3) / 2.7);
        el.style.backgroundColor = `rgba(245,158,11,${0.3 + intensity * 0.5})`;
        el.style.boxShadow = `0 0 ${2 + intensity * 6}px rgba(245,158,11,${0.2 + intensity * 0.3}), inset 0 0 2px rgba(255,200,100,${intensity * 0.2})`;
        if (glow) glow.style.opacity = String(intensity * 0.25);
        const clip = document.getElementById('mixi-clip-flash');
        if (clip) clip.style.opacity = '0';
      } else {
        // ── IDLE: Dark/off ──
        el.style.backgroundColor = 'var(--clr-limiter-bg)';
        el.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.5)';
        if (glow) glow.style.opacity = '0';
        const clip = document.getElementById('mixi-clip-flash');
        if (clip) clip.style.opacity = '0';
      }
    }, 50); // 20Hz update rate (smooth enough, low CPU)
    const cleanupDot = dotRef.current;
    const cleanupGlow = glowRef.current;
    return () => {
      clearInterval(interval);
      const clip = document.getElementById('mixi-clip-flash');
      if (clip) clip.style.opacity = '0';
      if (cleanupDot) {
        cleanupDot.style.backgroundColor = 'var(--clr-limiter-bg)';
        cleanupDot.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.5)';
      }
      if (cleanupGlow) cleanupGlow.style.opacity = '0';
    };
  }, [enabled]);

  return (
    <div className="flex items-center gap-0.5 relative" title={`Limiter: ${enabled ? 'ON' : 'OFF'}`}>
      <LimIcon color={enabled ? 'var(--txt-secondary)' : 'var(--brd-default)'} />
      <div
        ref={glowRef}
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 24, height: 24, top: '50%', right: -3, transform: 'translateY(-50%)',
          background: 'radial-gradient(circle, rgba(245,158,11,0.35) 0%, rgba(220,38,38,0.2) 50%, transparent 70%)',
          opacity: 0, transition: 'opacity 0.05s',
        }}
      />
      <button
        ref={dotRef}
        type="button"
        onClick={handleToggle}
        className="rounded-full shrink-0 cursor-pointer active:scale-90 transition-transform duration-75"
        style={{
          width: 14, height: 14,
          backgroundColor: enabled ? 'var(--clr-limiter-bg)' : 'var(--srf-inset)',
          border: `1.5px solid ${enabled ? 'var(--clr-limiter-brd)' : 'var(--brd-subtle)'}`,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
          transition: 'background-color 0.08s',
        }}
        title={`Limiter: ${enabled ? 'ON' : 'OFF'}`}
      />
    </div>
  );
};
