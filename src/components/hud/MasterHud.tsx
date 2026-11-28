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

// ── SVG Icon for Limiter (exported for Telemetry pill) ──────

/** Limiter — shield */
const LimIcon: FC<{ color: string }> = ({ color }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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
  const filterLabel = filterKnob < -0.01 ? 'LPF' : filterKnob > 0.01 ? 'HPF' : 'FLT';

  return (
    <div className="flex items-center gap-3.5">
      <HudKnob
        value={volume} min={0} max={1}
        onChange={onVolumeChange}
        color={COLOR_MASTER}
        label="MST" valueText={dbLabel}
        ghost={isGhost('master.volume')}
        defaultValue={1}
      />
      <HudKnob
        value={filterKnob} min={-1} max={1}
        onChange={onFilterChange}
        color={filterActive ? 'var(--clr-filter)' : 'var(--txt-muted)'}
        label={filterLabel} valueText={filterLabel}
        defaultValue={0} bipolar
        ghost={isGhost('master.filter')}
        activeGlow={filterActive ? 'var(--clr-filter)' : undefined}
      />
      <HudKnob
        value={distAmount} min={0} max={1}
        onChange={onDistChange}
        color={distActive ? 'var(--status-error)' : 'var(--txt-muted)'}
        label="DIST" valueText={`${Math.round(distAmount * 100)}%`}
        defaultValue={0}
        ghost={isGhost('master.distortion')}
        activeGlow={distActive ? 'var(--status-error)' : undefined}
      />
      <HudKnob
        value={punchAmount} min={0} max={1}
        onChange={onPunchChange}
        color={punchActive ? 'var(--status-warn)' : 'var(--txt-muted)'}
        label="PNCH" valueText={`${Math.round(punchAmount * 100)}%`}
        defaultValue={0}
        ghost={isGhost('master.punch')}
        activeGlow={punchActive ? 'var(--status-warn)' : undefined}
      />
    </div>
  );
};

// ── HudKnob (clean text-only label + rotary knob) ──────────

interface HudKnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  color: string;
  label: string;
  valueText: string;
  ghost?: boolean;
  defaultValue?: number;
  bipolar?: boolean;
  activeGlow?: string;
}

const HudKnob: FC<HudKnobProps> = ({
  value, min, max, onChange, color, label, valueText, ghost, defaultValue, bipolar, activeGlow,
}) => {
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${label}: ${valueText}`}
      style={activeGlow ? { filter: `drop-shadow(0 0 4px ${activeGlow}44)` } : undefined}
    >
      <span
        className="text-[8px] font-mono font-bold uppercase tracking-wider select-none"
        style={{ color: activeGlow ? color : 'var(--txt-secondary)' }}
      >
        {label}
      </span>
      <Knob
        value={value} min={min} max={max}
        onChange={onChange} color={color}
        scale={0.62} ghost={ghost}
        defaultValue={defaultValue} bipolar={bipolar}
      />
    </div>
  );
};

// ── Limiter Dot (sober monochrome when idle, amber/red only on GR) ──

export const LimiterDot: FC = () => {
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
    let raf = 0;
    let skip = false;
    function tick() {
      skip = !skip;
      if (skip) { raf = requestAnimationFrame(tick); return; }
      const engine = MixiEngine.getInstance();
      if (!engine.isInitialized || !dotRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const reduction = engine.getLimiterReduction();
      const absGR = Math.abs(reduction);
      const el = dotRef.current;
      const glow = glowRef.current;

      // 3-level visual feedback:
      //   idle:       absGR < 0.3  → dark (off)
      //   gentle:     0.3-3 dB    → amber glow (RMS compression, musical)
      //   emergency:  >3 dB       → red flash (peak rescue, safety)

      if (absGR > 3.0) {
        const intensity = Math.min(1, absGR / 8);
        const pulse = 0.8 + Math.random() * 0.2;
        el.style.backgroundColor = `rgba(220,38,38,${0.6 + intensity * 0.4})`;
        el.style.boxShadow = `0 0 ${4 + intensity * 14}px rgba(220,38,38,${0.5 + intensity * 0.5}), inset 0 0 4px rgba(255,120,120,${intensity * 0.5})`;
        if (glow) glow.style.opacity = String(pulse * intensity * 0.6);
        const clip = document.getElementById('mixi-clip-flash');
        if (clip) clip.style.opacity = String(intensity * 0.15);
      } else if (absGR > 0.3) {
        const intensity = Math.min(1, (absGR - 0.3) / 2.7);
        el.style.backgroundColor = `rgba(245,158,11,${0.3 + intensity * 0.5})`;
        el.style.boxShadow = `0 0 ${2 + intensity * 6}px rgba(245,158,11,${0.2 + intensity * 0.3}), inset 0 0 2px rgba(255,200,100,${intensity * 0.2})`;
        if (glow) glow.style.opacity = String(intensity * 0.25);
        const clip = document.getElementById('mixi-clip-flash');
        if (clip) clip.style.opacity = '0';
      } else {
        el.style.backgroundColor = 'rgba(255,255,255,0.08)';
        el.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.5)';
        if (glow) glow.style.opacity = '0';
        const clip = document.getElementById('mixi-clip-flash');
        if (clip) clip.style.opacity = '0';
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    const cleanupDot = dotRef.current;
    const cleanupGlow = glowRef.current;
    return () => {
      cancelAnimationFrame(raf);
      const clip = document.getElementById('mixi-clip-flash');
      if (clip) clip.style.opacity = '0';
      if (cleanupDot) {
        cleanupDot.style.backgroundColor = 'rgba(255,255,255,0.08)';
        cleanupDot.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.5)';
      }
      if (cleanupGlow) cleanupGlow.style.opacity = '0';
    };
  }, [enabled]);

  return (
    <div className="flex items-center gap-1 relative" title={`Master Limiter: ${enabled ? 'ON (nominal)' : 'BYPASSED'}`}>
      <LimIcon color={enabled ? 'var(--txt-muted)' : 'var(--brd-default)'} />
      <div
        ref={glowRef}
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 18, height: 18, top: '50%', right: -3, transform: 'translateY(-50%)',
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
          width: 8, height: 8,
          backgroundColor: enabled ? 'rgba(255,255,255,0.12)' : 'var(--srf-inset)',
          border: `1px solid ${enabled ? 'rgba(255,255,255,0.25)' : 'var(--brd-subtle)'}`,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
          transition: 'background-color 0.08s',
        }}
        aria-label={`Master Limiter ${enabled ? 'enabled' : 'disabled'}`}
      />
    </div>
  );
};
