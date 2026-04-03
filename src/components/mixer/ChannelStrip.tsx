/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Channel Strip (compact layout)
// ─────────────────────────────────────────────────────────────

import { useCallback, useState, type FC } from 'react';
import { useMixiStore } from '../../store/mixiStore';
import { Knob } from '../controls/Knob';
import { Fader } from '../controls/Fader';
import { VuMeter } from './VuMeter';
import { useSettingsStore, EQ_RANGE_PRESETS } from '../../store/settingsStore';
import type { DeckId, EqBand } from '../../types';
import { isGhost } from '../../ai/ghostFields';

interface ChannelStripProps {
  deckId: DeckId;
  color: string;
  /** Where to place the VU meter relative to the fader. */
  vuSide?: 'left' | 'right';
}

export const ChannelStrip: FC<ChannelStripProps> = ({ deckId, color, vuSide = 'left' }) => {
  const deck = useMixiStore((s) => s.decks[deckId]);
  const eqPreset = useSettingsStore((s) => s.eqRange);
  const eqRange = EQ_RANGE_PRESETS[eqPreset];
  const setGain = useMixiStore((s) => s.setDeckGain);
  const setEq = useMixiStore((s) => s.setDeckEq);
  const setColorFx = useMixiStore((s) => s.setDeckColorFx);
  const setVolume = useMixiStore((s) => s.setDeckVolume);


  // Kill state per EQ band — stores the value before kill
  const [kills, setKills] = useState<Record<EqBand, number | null>>({
    high: null, mid: null, low: null,
  });

  const onGainChange = useCallback(
    (val: number) => setGain(deckId, val),
    [deckId, setGain],
  );
  const onEqChange = useCallback(
    (band: EqBand) => (val: number) => {
      // If user moves knob while killed, un-kill it
      if (kills[band] !== null) {
        setKills((k) => ({ ...k, [band]: null }));
      }
      setEq(deckId, band, val);
    },
    [deckId, setEq, kills],
  );
  const onKill = useCallback(
    (band: EqBand) => () => {
      const isKilled = kills[band] !== null;
      if (isKilled) {
        // Restore previous value
        setEq(deckId, band, kills[band]!);
        setKills((k) => ({ ...k, [band]: null }));
      } else {
        // Save current value and kill (set to min)
        setKills((k) => ({ ...k, [band]: deck.eq[band] }));
        setEq(deckId, band, eqRange.min);
      }
    },
    [deckId, deck.eq, eqRange.min, kills, setEq],
  );
  const onColorFxChange = useCallback(
    (val: number) => setColorFx(deckId, val),
    [deckId, setColorFx],
  );
  const onVolumeChange = useCallback(
    (val: number) => setVolume(deckId, val),
    [deckId, setVolume],
  );


  return (
    <div className="flex flex-col items-center gap-0 px-1 py-1">
      {/* Deck label */}
      <span className="text-[10px] font-bold tracking-widest mb-0.5" style={{ color }}>
        {deckId}
      </span>

      {/* Gain / Trim */}
      <Knob value={deck.gain} min={-12} max={12} onChange={onGainChange} bipolar color={color} scale={0.8} ghost={isGhost(`${deckId}.gain`)} showValue unit="dB" />

      {/* EQ: HI / MID / LOW */}
      <Knob value={deck.eq.high} min={eqRange.min} max={eqRange.max} center={0} onChange={onEqChange('high')} bipolar color={color} scale={0.8} ghost={isGhost(`${deckId}.eq.high`)} showValue unit="dB" onKill={onKill('high')} killed={kills.high !== null} />
      <Knob value={deck.eq.mid} min={eqRange.min} max={eqRange.max} center={0} onChange={onEqChange('mid')} bipolar color={color} scale={0.8} ghost={isGhost(`${deckId}.eq.mid`)} showValue unit="dB" onKill={onKill('mid')} killed={kills.mid !== null} />
      <Knob value={deck.eq.low} min={eqRange.min} max={eqRange.max} center={0} onChange={onEqChange('low')} bipolar color={color} scale={0.8} ghost={isGhost(`${deckId}.eq.low`)} showValue unit="dB" onKill={onKill('low')} killed={kills.low !== null} />

      {/* Color FX */}
      <Knob value={deck.colorFx} min={-1} max={1} onChange={onColorFxChange} bipolar color={color} scale={0.8} ghost={isGhost(`${deckId}.colorFx`)} />

      {/* Small spacer before fader */}
      <div style={{ height: 13 }} />

      {/* Volume Fader + VU Meter — shifted outward for spacing */}
      <div
        className="flex flex-col items-center gap-1"
        style={{ marginLeft: vuSide === 'left' ? -6 : 0, marginRight: vuSide === 'right' ? -6 : 0 }}
      >
        <div className="flex items-end gap-1">
          {vuSide === 'left' && <VuMeter deckId={deckId} />}
          <Fader value={deck.volume} min={0} max={1} onChange={onVolumeChange} orientation="vertical" length={140} color={color} ghost={isGhost(`${deckId}.volume`)} />
          {vuSide === 'right' && <VuMeter deckId={deckId} />}
        </div>
        {/* Volume LCD — dB readout */}
        <VolumeLcd value={deck.volume} color={color} />
      </div>
    </div>
  );
};

// ── Volume LCD ──────────────────────────────────────────────
// Converts 0–1 linear volume to dB and displays as LCD.

const VolumeLcd: FC<{ value: number; color: string }> = ({ value, color }) => {
  // 0→-∞, 1→0dB. Use 20*log10(value), floor at -60.
  const db = value > 0.001 ? Math.round(20 * Math.log10(value)) : -60;
  const label = db <= -60 ? '-∞' : `${db}dB`;

  return (
    <span
      className="text-[10px] font-mono font-medium rounded-md px-2.5 py-1"
      style={{
        background: 'var(--srf-base)',
        border: `1px solid ${color}18`,
        color,
        textShadow: `0 0 8px ${color}55`,
        boxShadow: `inset 0 1px 3px rgba(0,0,0,0.6), 0 0 4px ${color}11`,
        minWidth: 42,
        textAlign: 'center' as const,
      }}
    >
      {label}
    </span>
  );
};
