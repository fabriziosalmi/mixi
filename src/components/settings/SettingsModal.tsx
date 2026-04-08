/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Settings Modal (v2 — Sidebar Layout)
//
// Vertical sidebar tabs + wider content area.
// Section headers group related settings.
// Modern toggle switches and segmented controls.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState, type FC, type ReactNode } from 'react';
import {
  useSettingsStore,
  EQ_RANGE_PRESETS,
  EQ_MODELS,
  BPM_RANGE_PRESETS,
  QUANTIZE_RESOLUTIONS,
  type EqRangePreset,
  type EqModel,
  type FpsLimit,
  type BpmRangePreset,
  type QuantizeResolution,
} from '../../store/settingsStore';
import { useMidiStore } from '../../store/midiStore';
import { useMixiStore } from '../../store/mixiStore';
import { MixiEngine } from '../../audio/MixiEngine';
import type { CrossfaderCurve } from '../../types';
import { useSessionStore } from '../../store/sessionStore';
import type { MidiAction } from '../../midi/MidiManager';
import { MIDI_CONTROLLER_PRESETS } from '../../midi/presets';

// ── Tabs ─────────────────────────────────────────────────────

type TabId = 'mixer' | 'audio' | 'midi' | 'perf' | 'system' | 'credits';

// ── SVG Tab Icons (16×16, stroke-based, professional) ────────

const TabIcon: FC<{ id: TabId }> = ({ id }) => {
  const props = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'mixer': return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    case 'audio': return <svg {...props}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>;
    case 'midi': return <svg {...props}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M6 11v4M10 11v4M14 11v4M18 11v4M8 7V4M16 7V4"/></svg>;
    case 'perf': return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'system': return <svg {...props}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
    case 'credits': return <svg {...props}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;
  }
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'audio', label: 'Audio' },
  { id: 'midi', label: 'MIDI' },
  { id: 'perf', label: 'Perf' },
  { id: 'system', label: 'System' },
  { id: 'credits', label: 'Info' },
];

export const SettingsModal: FC = () => {
  const show = useSettingsStore((s) => s.showSettings);
  const close = useSettingsStore((s) => s.setShowSettings);

  const [tab, setTab] = useState<TabId>('mixer');

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => close(false)}
    >
      <div
        className="w-[600px] max-h-[78vh] rounded-2xl border border-zinc-800 shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--srf-base)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2" style={{ borderBottom: '1px solid var(--brd-subtle)' }}>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--txt-bright)' }}>Settings</h2>
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded p-1 transition-colors"
            style={{ color: 'var(--txt-muted)' }}
            title="Close settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body: Sidebar + Content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="flex flex-col w-[130px] py-2 shrink-0" style={{ background: 'var(--srf-deep)', borderRight: '1px solid var(--brd-subtle)' }}>
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-left transition-all"
                style={{
                  color: tab === id ? 'var(--clr-a)' : 'var(--txt-muted)',
                  background: tab === id ? 'rgba(0,240,255,0.04)' : 'transparent',
                  borderLeft: tab === id ? '2px solid var(--clr-a)' : '2px solid transparent',
                  textShadow: tab === id ? '0 0 8px var(--clr-a)33' : 'none',
                }}
              >
                <TabIcon id={id} />
                <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
              </button>
            ))}
          </nav>

          {/* Content — fixed height so modal never resizes between tabs */}
          <div className="p-5 overflow-y-auto space-y-1" style={{ height: 420, flexShrink: 0 }}>
            {tab === 'mixer' && <MixerTab />}
            {tab === 'audio' && <AudioTab />}
            {tab === 'midi' && <MidiTab />}
            {tab === 'perf' && <PerfTab />}
            {tab === 'system' && <SystemTab />}
            {tab === 'credits' && <CreditsTab />}
          </div>
        </div>

        {/* Version */}
        <div className="text-center py-2" style={{ borderTop: '1px solid var(--brd-subtle)' }}>
          <span className="text-[9px]" style={{ color: 'var(--txt-dim)' }}>Mixi v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.4'}</span>
        </div>
      </div>
    </div>
  );
};

// ── Tab: Mixer ──────────────────────────────────────────────

const MixerTab: FC = () => {
  const eqModel = useSettingsStore((s) => s.eqModel);
  const setEqModel = useSettingsStore((s) => s.setEqModel);
  const eqRange = useSettingsStore((s) => s.eqRange);
  const setEqRange = useSettingsStore((s) => s.setEqRange);
  const quantizeRes = useSettingsStore((s) => s.quantizeResolution);
  const setQuantizeRes = useSettingsStore((s) => s.setQuantizeResolution);

  return (
    <>
      <SectionHeader label="EQ" />

      <SettingRow label="EQ Model" description="Filter architecture for channel EQ">
        <SegmentedControl<EqModel>
          options={EQ_MODELS.map((m) => ({
            value: m.value,
            label: m.label,
          }))}
          value={eqModel}
          onChange={setEqModel}
        />
      </SettingRow>

      <SettingRow label="EQ Range" description="Kill depth and boost headroom">
        <SegmentedControl<EqRangePreset>
          options={(['gentle', 'standard', 'techno'] as const).map((p) => ({
            value: p,
            label: EQ_RANGE_PRESETS[p].label,
          }))}
          value={eqRange}
          onChange={setEqRange}
        />
      </SettingRow>

      <SectionHeader label="Grid" />

      <SettingRow label="Quantize Resolution" description="Snap grid for cues and loops">
        <SegmentedControl<QuantizeResolution>
          options={QUANTIZE_RESOLUTIONS.map((r) => ({
            value: r.value,
            label: r.label,
          }))}
          value={quantizeRes}
          onChange={setQuantizeRes}
        />
      </SettingRow>

      <SectionHeader label="Blend" />

      <SettingRow label="Crossfader Curve" description="Blend behavior between decks">
        <SegmentedControl<CrossfaderCurve>
          options={[
            { value: 'smooth', label: 'Smooth' },
            { value: 'sharp', label: 'Sharp' },
          ]}
          value={useMixiStore.getState().crossfaderCurve}
          onChange={(v) => useMixiStore.getState().setCrossfaderCurve(v)}
        />
      </SettingRow>

      <SectionHeader label="Sessions" />

      <SessionManager />
    </>
  );
};

// ── Session Manager ─────────────────────────────────────────

const SessionManager: FC = () => {
  const sessions = useSessionStore((s) => s.sessions);
  const saveSession = useSessionStore((s) => s.saveSession);
  const loadSession = useSessionStore((s) => s.loadSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px]" style={{ color: 'var(--txt-secondary)' }}>Save and restore mixer state</span>
        <button
          type="button"
          onClick={() => {
            const name = prompt('Session name:');
            if (name?.trim()) saveSession(name.trim());
          }}
          className="rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-all active:scale-95 ml-auto"
          style={{ background: 'rgba(0,240,255,0.1)', color: 'var(--clr-a)', border: '1px solid rgba(0,240,255,0.2)' }}
        >
          Save Current
        </button>
      </div>
      {sessions.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-[100px] overflow-y-auto rounded" style={{ background: 'var(--srf-deep)', border: '1px solid var(--brd-subtle)' }}>
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1 group" style={{ borderBottom: '1px solid var(--brd-subtle)' }}>
              <span className="text-[10px] font-mono flex-1 truncate" style={{ color: 'var(--txt-primary)' }}>{s.name}</span>
              <span className="text-[9px] font-mono" style={{ color: 'var(--txt-dim)' }}>{new Date(s.savedAt).toLocaleDateString()}</span>
              <button type="button" onClick={() => loadSession(s.id)} className="text-[9px] font-bold px-1.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--clr-a)' }}>Load</button>
              <button type="button" onClick={() => deleteSession(s.id)} className="text-[9px] px-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--txt-dim)' }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {sessions.length === 0 && (
        <span className="text-[10px] font-mono" style={{ color: 'var(--txt-dim)' }}>No saved sessions</span>
      )}
    </div>
  );
};

// ── Tab: Audio ──────────────────────────────────────────────

const REC_FORMAT_LABELS: Record<import('../../store/settingsStore').RecFormat, string> = {
  'webm-opus': 'WebM/Opus',
  'webm-pcm':  'WebM/PCM',
  'ogg-opus':  'OGG/Opus',
  'mp4-aac':   'M4A/AAC',
};

const AudioTab: FC = () => {
  const bpmRange = useSettingsStore((s) => s.bpmRange);
  const setBpmRange = useSettingsStore((s) => s.setBpmRange);
  const loadDemoTrack = useSettingsStore((s) => s.loadDemoTrack);
  const setLoadDemoTrack = useSettingsStore((s) => s.setLoadDemoTrack);
  const recFormat = useSettingsStore((s) => s.recFormat);
  const setRecFormat = useSettingsStore((s) => s.setRecFormat);

  return (
    <>
      <SectionHeader label="Analysis" />

      <SettingRow label="BPM Detection Range" description="Hint for BPM analysis on track load">
        <SegmentedControl<BpmRangePreset>
          options={(['wide', 'downtempo', 'house', 'dnb', 'hardcore'] as const).map((p) => ({
            value: p,
            label: BPM_RANGE_PRESETS[p].label,
          }))}
          value={bpmRange}
          onChange={setBpmRange}
        />
      </SettingRow>

      <SectionHeader label="Recording" />

      <SettingRow label="Format" description="Audio format for set recording">
        <SegmentedControl<import('../../store/settingsStore').RecFormat>
          options={(['webm-opus', 'ogg-opus', 'mp4-aac', 'webm-pcm'] as const).map((f) => ({
            value: f,
            label: REC_FORMAT_LABELS[f],
          }))}
          value={recFormat}
          onChange={setRecFormat}
        />
      </SettingRow>

      <SectionHeader label="Playback" />

      <SettingRow label="Pitch Range" description="Pitch fader range (also affects sync)">
        <SegmentedControl<number>
          options={[
            { value: 0.08, label: '±8%' },
            { value: 0.16, label: '±16%' },
            { value: 0.50, label: '±50%' },
          ]}
          value={useSettingsStore.getState().pitchRange}
          onChange={(v) => useSettingsStore.getState().setPitchRange(v)}
        />
      </SettingRow>

      <SettingRow label="Demo Track" description="Load demo on Deck A at startup">
        <ToggleSwitch checked={loadDemoTrack} onChange={() => setLoadDemoTrack(!loadDemoTrack)} />
      </SettingRow>
    </>
  );
};

// ── Tab: MIDI ───────────────────────────────────────────────

const MIDI_PRESETS = [
  { id: 'manual', label: 'Manual (MIDI Learn)' },
  ...MIDI_CONTROLLER_PRESETS.map((p) => ({ id: p.id, label: p.label })),
];

const MIDI_PARAMS: { section: string; params: { label: string; action: MidiAction }[] }[] = [
  {
    section: 'Deck A',
    params: [
      { label: 'EQ High', action: { type: 'DECK_EQ_HIGH', deck: 'A' } },
      { label: 'EQ Mid', action: { type: 'DECK_EQ_MID', deck: 'A' } },
      { label: 'EQ Low', action: { type: 'DECK_EQ_LOW', deck: 'A' } },
      { label: 'Gain', action: { type: 'DECK_GAIN', deck: 'A' } },
      { label: 'Volume', action: { type: 'DECK_VOL', deck: 'A' } },
      { label: 'Filter', action: { type: 'DECK_FILTER', deck: 'A' } },
      { label: 'Pitch', action: { type: 'DECK_PITCH', deck: 'A' } },
      { label: 'Play', action: { type: 'DECK_PLAY', deck: 'A' } },
      { label: 'Cue', action: { type: 'DECK_CUE', deck: 'A' } },
      { label: 'Sync', action: { type: 'DECK_SYNC', deck: 'A' } },
    ],
  },
  {
    section: 'Deck B',
    params: [
      { label: 'EQ High', action: { type: 'DECK_EQ_HIGH', deck: 'B' } },
      { label: 'EQ Mid', action: { type: 'DECK_EQ_MID', deck: 'B' } },
      { label: 'EQ Low', action: { type: 'DECK_EQ_LOW', deck: 'B' } },
      { label: 'Gain', action: { type: 'DECK_GAIN', deck: 'B' } },
      { label: 'Volume', action: { type: 'DECK_VOL', deck: 'B' } },
      { label: 'Filter', action: { type: 'DECK_FILTER', deck: 'B' } },
      { label: 'Pitch', action: { type: 'DECK_PITCH', deck: 'B' } },
      { label: 'Play', action: { type: 'DECK_PLAY', deck: 'B' } },
      { label: 'Cue', action: { type: 'DECK_CUE', deck: 'B' } },
      { label: 'Sync', action: { type: 'DECK_SYNC', deck: 'B' } },
    ],
  },
  {
    section: 'Master',
    params: [
      { label: 'Crossfader', action: { type: 'CROSSFADER' } },
      { label: 'Master Vol', action: { type: 'MASTER_VOL' } },
      { label: 'HP Mix', action: { type: 'HEADPHONE_MIX' } },
      { label: 'HP Level', action: { type: 'HEADPHONE_LEVEL' } },
    ],
  },
];

function findMapping(mappings: any[], action: MidiAction) {
  return mappings.find((m: any) =>
    m.action.type === action.type &&
    ('deck' in action ? (m.action as any).deck === (action as any).deck : true)
  );
}

const MidiTab: FC = () => {
  const mappings = useMidiStore((s) => s.mappings);
  const activePreset = useMidiStore((s) => s.activePreset);
  const loadPreset = useMidiStore((s) => s.loadPreset);
  const clearMappings = useMidiStore((s) => s.clearMappings);
  const isLearning = useMidiStore((s) => s.isLearning);
  const learningAction = useMidiStore((s) => s.learningAction);
  const setLearning = useMidiStore((s) => s.setLearning);
  const setLearningAction = useMidiStore((s) => s.setLearningAction);
  const removeMapping = useMidiStore((s) => s.removeMapping);

  const handlePreset = (presetId: string) => {
    const preset = MIDI_CONTROLLER_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      loadPreset(preset.label, preset.mappings);
    } else {
      clearMappings();
    }
  };

  const startLearn = (action: MidiAction) => {
    setLearning(true);
    setLearningAction(action);
  };

  const cancelLearn = () => {
    setLearning(false);
    setLearningAction(null);
  };

  const isWaiting = (action: MidiAction) =>
    isLearning &&
    learningAction?.type === action.type &&
    ('deck' in action ? (learningAction as any)?.deck === (action as any).deck : true);

  return (
    <div className="space-y-3">
      <SectionHeader label="Controller" />

      {/* Preset selector */}
      <div className="flex justify-between items-center gap-2">
        <select
          value={MIDI_CONTROLLER_PRESETS.find((p) => p.label === activePreset)?.id ?? 'manual'}
          onChange={(e) => handlePreset(e.target.value)}
          className="rounded px-2.5 py-1.5 text-[10px] font-mono outline-none flex-1"
          style={{ background: 'var(--srf-inset)', border: '1px solid var(--brd-default)', color: 'var(--txt-primary)' }}
        >
          {MIDI_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <div className="flex gap-2 shrink-0">
          {isLearning && (
            <button type="button" onClick={cancelLearn}
              className="text-[9px] font-mono uppercase animate-pulse" style={{ color: 'var(--status-warn)' }}>
              Cancel
            </button>
          )}
          {mappings.length > 0 && (
            <button type="button" onClick={clearMappings}
              className="text-[9px] font-mono uppercase" style={{ color: 'var(--status-error)' }}>
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Parameter mapping table */}
      <div className="max-h-[320px] overflow-auto space-y-2 pr-1">
        {MIDI_PARAMS.map(({ section, params }) => (
          <div key={section}>
            <div className="text-[9px] font-bold uppercase tracking-wider mb-1 sticky top-0 py-0.5" style={{ color: 'var(--txt-dim)', background: 'var(--srf-base)' }}>
              {section}
            </div>
            {params.map(({ label, action }) => {
              const mapping = findMapping(mappings, action);
              const waiting = isWaiting(action);
              return (
                <div key={`${action.type}-${'deck' in action ? (action as any).deck : 'M'}`}
                  className="flex items-center justify-between py-1" style={{ borderBottom: '1px solid var(--brd-subtle)' }}>
                  <span className="text-[10px] w-[70px]" style={{ color: 'var(--txt-secondary)' }}>{label}</span>
                  <span className="text-[9px] font-mono flex-1 text-center" style={{ color: 'var(--txt-dim)' }}>
                    {waiting ? (
                      <span className="animate-pulse" style={{ color: 'var(--status-warn)' }}>⏳ Move control…</span>
                    ) : mapping ? (
                      `${mapping.type.toUpperCase()} Ch${mapping.channel + 1} #${mapping.control}`
                    ) : (
                      '—'
                    )}
                  </span>
                  <div className="flex gap-1">
                    <button type="button"
                      onClick={() => startLearn(action)}
                      className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded transition-all"
                      style={{
                        background: waiting ? 'var(--status-warn)' : 'transparent',
                        color: waiting ? '#000' : 'var(--txt-muted)',
                        border: `1px solid ${waiting ? 'var(--status-warn)' : 'var(--brd-subtle)'}`,
                      }}>
                      {waiting ? '…' : 'Learn'}
                    </button>
                    {mapping && (
                      <button type="button"
                        onClick={() => removeMapping(action.type, 'deck' in action ? (action as any).deck : undefined)}
                        className="text-[8px] px-1" style={{ color: 'var(--txt-dim)' }}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Tab: Performance ────────────────────────────────────────

const PerfTab: FC = () => {
  const fpsLimit = useSettingsStore((s) => s.fpsLimit);
  const setFpsLimit = useSettingsStore((s) => s.setFpsLimit);
  const debugPanel = useSettingsStore((s) => s.showDebugPanel);
  const toggleDebug = useSettingsStore((s) => s.toggleDebugPanel);
  const colorblindMode = useSettingsStore((s) => s.colorblindMode);
  const setColorblindMode = useSettingsStore((s) => s.setColorblindMode);

  return (
    <>
      <SectionHeader label="Display" />

      <SettingRow label="FPS Limit" description="Cap canvas rendering rate (saves GPU)">
        <SegmentedControl<FpsLimit>
          options={[
            { value: 60, label: '60 fps' },
            { value: 30, label: '30 fps' },
          ]}
          value={fpsLimit}
          onChange={setFpsLimit}
        />
      </SettingRow>

      <SettingRow label="Colorblind Mode" description="Deuteranopia-safe waveform palette">
        <ToggleSwitch checked={colorblindMode} onChange={() => setColorblindMode(!colorblindMode)} />
      </SettingRow>

      <SectionHeader label="Debug" />

      <SettingRow label="AI Debug Panel" description="Show live blackboard and intent scores">
        <ToggleSwitch checked={debugPanel} onChange={toggleDebug} />
      </SettingRow>
    </>
  );
};

// ── Tab: System ─────────────────────────────────────────────

const SystemTab: FC = () => {
  const [sysInfo, setSysInfo] = useState({ cores: 0, mem: '', ua: '' });
  const useWasmDsp = useSettingsStore((s) => s.useWasmDsp);
  const setUseWasmDsp = useSettingsStore((s) => s.setUseWasmDsp);

  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [nativeHost, setNativeHost] = useState('');
  const [nativeDevices, setNativeDevices] = useState<Array<{id: string; name: string; isDefault: boolean}>>([]);
  const [nativeOutputActive, setNativeOutputActive] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('0');

  useEffect(() => {
    setSysInfo({
      cores: navigator.hardwareConcurrency || 0,
      mem: 'deviceMemory' in navigator
        ? `${(navigator as unknown as Record<string, number>).deviceMemory} GB`
        : 'N/A',
      ua: navigator.userAgent.includes('Firefox') ? 'Firefox'
        : navigator.userAgent.includes('Chrome') ? 'Chrome'
        : navigator.userAgent.includes('Safari') ? 'Safari'
        : 'Other',
    });

    const w = window as any;
    if (w?.mixi?.nativeAudio) {
      w.mixi.nativeAudio.isAvailable().then((ok: boolean) => {
        setNativeAvailable(ok);
        if (ok) {
          w.mixi.nativeAudio.getHostName().then((h: string) => setNativeHost(h));
          w.mixi.nativeAudio.getDevices().then((d: any[]) => setNativeDevices(d));
        }
      }).catch(() => setNativeAvailable(false));
    }
  }, []);

  return (
    <>
      <SectionHeader label="Engine" />

      <SettingRow
        label="Rust/Wasm DSP"
        description={useWasmDsp ? 'AudioWorklet (Rust) — experimental' : 'Native WebAudio nodes'}
      >
        <ToggleSwitch checked={useWasmDsp} onChange={() => setUseWasmDsp(!useWasmDsp)} />
      </SettingRow>
      {useWasmDsp && (
        <div className="text-[9px] px-1 rounded py-1" style={{ color: 'var(--status-warn)', background: 'rgba(245,158,11,0.06)' }}>
          Requires page reload to take effect.
        </div>
      )}

      {/* Native Audio I/O — only visible in Electron with addon */}
      {nativeAvailable && (
        <>
          <SectionHeader label="Audio I/O" />
          <InfoRow label="Backend" value={nativeHost} />
          <SettingRow
            label="Native Output"
            description={nativeOutputActive ? `Active → ${nativeHost}` : 'WebAudio (compatible)'}
          >
            <ToggleSwitch
              checked={nativeOutputActive}
              onChange={async () => {
                const engine = MixiEngine.getInstance();
                if (nativeOutputActive) {
                  await engine.switchToWebOutput();
                  setNativeOutputActive(false);
                } else {
                  const selectedIdx = parseInt(selectedDevice, 10) || 0;
                  const ok = await engine.switchToNativeOutput(selectedIdx);
                  setNativeOutputActive(ok);
                }
              }}
            />
          </SettingRow>
          {nativeDevices.length > 0 && (
            <SettingRow label="Output Device" description="">
              <select
                className="rounded px-2 py-1 text-[10px] outline-none"
                style={{ background: 'var(--srf-inset)', color: 'var(--txt-primary)', border: '1px solid var(--brd-default)' }}
                value={selectedDevice}
                disabled={nativeOutputActive}
                onChange={(e) => setSelectedDevice(e.target.value)}
              >
                {nativeDevices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </SettingRow>
          )}
          <div className="text-[9px] px-1 font-mono" style={{ color: nativeOutputActive ? 'var(--status-ok)' : 'var(--txt-dim)' }}>
            {nativeOutputActive
              ? `✓ Zero-copy: Wasm → SAB → cpal → ${nativeHost}`
              : `○ Available: cpal → ${nativeHost}`}
          </div>
        </>
      )}

      <SectionHeader label="Info" />

      <InfoRow label="Browser" value={sysInfo.ua} />
      <InfoRow label="CPU Cores" value={String(sysInfo.cores)} />
      <InfoRow label="Memory" value={sysInfo.mem} />
      <InfoRow label="Audio SR" value="44.1 kHz" />
      <InfoRow label="AI Tick" value="50 ms (20 Hz)" />
    </>
  );
};

// ── Tab: Credits ────────────────────────────────────────────

const CreditRow: FC<{ name: string; role: string; link?: string }> = ({ name, role, link }) => (
  <div className="flex justify-between items-center text-[11px] py-1">
    <div>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--clr-a)' }}>{name}</a>
      ) : (
        <span style={{ color: 'var(--txt-bright)' }}>{name}</span>
      )}
    </div>
    <span style={{ color: 'var(--txt-muted)' }}>{role}</span>
  </div>
);

const CreditsTab: FC = () => (
  <>
    <SectionHeader label="Team" />
    <CreditRow name="Fabrizio Salmi" role="Author" link="mailto:fabrizio.salmi@gmail.com" />
    <CreditRow name="The FreeTekno Community" role="Love & Music" />
    <CreditRow name="Gemini & Claude" role="Coders" />
    <CreditRow name="Suno" role="Demo Tracks" />

    <SectionHeader label="Source Code" />
    <div className="text-[10px]">
      <a href="https://github.com/fabriziosalmi/mixi" target="_blank" rel="noopener noreferrer"
        className="font-mono hover:underline" style={{ color: 'var(--clr-a)' }}>
        github.com/fabriziosalmi/mixi
      </a>
    </div>

    <SectionHeader label="Resources" />
    <div className="flex flex-col gap-2 text-[11px]">
      <a href="https://fabriziosalmi.github.io/mixi/guide/getting-started" target="_blank" rel="noopener noreferrer"
        className="hover:underline" style={{ color: 'var(--clr-a)' }}>
        Documentation & Keyboard Shortcuts
      </a>
      <a href="https://github.com/fabriziosalmi/mixi/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer"
        className="hover:underline" style={{ color: 'var(--clr-a)' }}>
        Privacy Policy
      </a>
      <a href="https://github.com/fabriziosalmi/mixi/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer"
        className="hover:underline" style={{ color: 'var(--clr-a)' }}>
        Changelog
      </a>
    </div>
  </>
);

// ── Shared sub-components ────────────────────────────────────

/** Section header — replaces Divider with a labeled group. */
const SectionHeader: FC<{ label: string }> = ({ label }) => (
  <div className="pt-4 pb-1.5 first:pt-0">
    <span
      className="text-[9px] font-bold uppercase tracking-[0.2em]"
      style={{ color: 'var(--txt-dim)', borderBottom: '1px solid var(--brd-subtle)', paddingBottom: 3, display: 'inline-block' }}
    >
      {label}
    </span>
  </div>
);

const SettingRow: FC<{ label: string; description: string; children: ReactNode }> = ({
  label, description, children,
}) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <div className="min-w-0">
      <div className="text-[12px] font-medium" style={{ color: 'var(--txt-bright)' }}>{label}</div>
      {description && <div className="text-[10px] mt-0.5" style={{ color: 'var(--txt-muted)' }}>{description}</div>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const ToggleSwitch: FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    role="switch"
    aria-checked={checked}
    title={checked ? 'Disable' : 'Enable'}
    className="relative rounded-full transition-all duration-200"
    style={{
      width: 42,
      height: 24,
      background: checked ? 'rgba(0,240,255,0.15)' : 'var(--srf-inset)',
      border: `1px solid ${checked ? 'rgba(0,240,255,0.3)' : 'var(--brd-default)'}`,
      boxShadow: checked ? 'inset 0 0 8px rgba(0,240,255,0.1)' : 'inset 0 1px 3px rgba(0,0,0,0.4)',
    }}
  >
    <div
      className="absolute rounded-full transition-all duration-200 ease-out"
      style={{
        width: 18,
        height: 18,
        top: 2,
        left: checked ? 21 : 2,
        background: checked ? 'var(--clr-a)' : 'var(--txt-muted)',
        boxShadow: checked
          ? '0 0 8px rgba(0,240,255,0.5), 0 0 2px rgba(0,240,255,0.8)'
          : '0 1px 2px rgba(0,0,0,0.5)',
      }}
    />
  </button>
);

function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--brd-default)' }}>
      {options.map((opt, i) => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wide transition-all"
            style={{
              minWidth: 52,
              background: active ? 'rgba(0,240,255,0.1)' : 'transparent',
              color: active ? 'var(--clr-a)' : 'var(--txt-muted)',
              borderRight: i < options.length - 1 ? '1px solid var(--brd-default)' : 'none',
              textShadow: active ? '0 0 8px rgba(0,240,255,0.3)' : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const InfoRow: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between text-[11px] py-1">
    <span style={{ color: 'var(--txt-muted)' }}>{label}</span>
    <span className="font-mono" style={{ color: 'var(--txt-secondary)' }}>{value}</span>
  </div>
);
