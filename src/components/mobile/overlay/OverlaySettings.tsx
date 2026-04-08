/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// OverlaySettings — Mobile settings panel (slide-up)
//
// Compact settings for mobile:
//   - Crossfader curve (smooth / sharp)
//   - Pitch range (±4% / ±8% / ±16% / ±50%)
//   - Load demo track toggle
// ─────────────────────────────────────────────────────────────

import { type FC } from 'react';
import { useMixiStore } from '../../../store/mixiStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { MobileTapTempo } from '../MobileTapTempo';
import { COLOR_DECK_A } from '../../../theme';
import type { CrossfaderCurve } from '../../../types';

const XFADER_CURVES: { value: CrossfaderCurve; label: string }[] = [
  { value: 'smooth', label: 'SMOOTH' },
  { value: 'sharp', label: 'SHARP' },
];

const PITCH_RANGES: { value: number; label: string }[] = [
  { value: 0.04, label: '±4%' },
  { value: 0.08, label: '±8%' },
  { value: 0.16, label: '±16%' },
  { value: 0.50, label: '±50%' },
];

export const OverlaySettings: FC = () => {
  const crossfaderCurve = useMixiStore((s) => s.crossfaderCurve);
  const setCrossfaderCurve = useMixiStore((s) => s.setCrossfaderCurve);
  const pitchRange = useSettingsStore((s) => s.pitchRange);
  const setPitchRange = useSettingsStore((s) => s.setPitchRange);
  const loadDemoTrack = useSettingsStore((s) => s.loadDemoTrack);
  const setLoadDemoTrack = useSettingsStore((s) => s.setLoadDemoTrack);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Crossfader curve */}
      <div>
        <div style={{ fontSize: 9, color: '#555', fontFamily: 'var(--font-mono)', marginBottom: 8, letterSpacing: 2 }}>
          CROSSFADER CURVE
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {XFADER_CURVES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setCrossfaderCurve(value)}
              style={{
                flex: 1,
                height: 40,
                border: `1px solid ${crossfaderCurve === value ? '#a855f7' : '#333'}`,
                borderRadius: 6,
                background: crossfaderCurve === value ? '#a855f722' : '#151515',
                color: crossfaderCurve === value ? '#a855f7' : '#888',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Pitch range */}
      <div>
        <div style={{ fontSize: 9, color: '#555', fontFamily: 'var(--font-mono)', marginBottom: 8, letterSpacing: 2 }}>
          PITCH RANGE
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PITCH_RANGES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPitchRange(value)}
              style={{
                flex: 1,
                height: 40,
                border: `1px solid ${pitchRange === value ? '#a855f7' : '#333'}`,
                borderRadius: 6,
                background: pitchRange === value ? '#a855f722' : '#151515',
                color: pitchRange === value ? '#a855f7' : '#888',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tap tempo */}
      <div>
        <div style={{ fontSize: 9, color: '#555', fontFamily: 'var(--font-mono)', marginBottom: 8, letterSpacing: 2 }}>
          TAP TEMPO
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <MobileTapTempo deckId="A" color={COLOR_DECK_A} />
        </div>
      </div>

      {/* Demo track toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: '#888', fontFamily: 'var(--font-mono)' }}>
          LOAD DEMO ON START
        </span>
        <button
          aria-label="Toggle load demo track"
          onClick={() => setLoadDemoTrack(!loadDemoTrack)}
          style={{
            width: 48,
            height: 28,
            borderRadius: 14,
            border: 'none',
            background: loadDemoTrack ? '#a855f7' : '#333',
            position: 'relative',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            transition: 'background 150ms',
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: 3,
              left: loadDemoTrack ? 23 : 3,
              transition: 'left 150ms',
            }}
          />
        </button>
      </div>
    </div>
  );
};
