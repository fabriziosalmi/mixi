/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Settings Modal
//
// Tabbed overlay panel with app settings.
// Opened via the gear icon in the top bar.
// ─────────────────────────────────────────────────────────────

import { useEffect, useState, type FC } from 'react';
import {
  useSettingsStore,
  EQ_RANGE_PRESETS,
  BPM_RANGE_PRESETS,
  QUANTIZE_RESOLUTIONS,
  type EqRangePreset,
  type FpsLimit,
  type BpmRangePreset,
  type QuantizeResolution,
} from '../../store/settingsStore';
import { useMidiStore } from '../../store/midiStore';
import { AKAI_MIDI_MIX_PRESET } from '../../midi/presets/akaiMidiMix';

// ── Tabs ─────────────────────────────────────────────────────

type TabId = 'mixer' | 'audio' | 'midi' | 'perf' | 'system' | 'credits';

const TABS: { id: TabId; label: string }[] = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'audio', label: 'Audio' },
  { id: 'midi', label: 'MIDI' },
  { id: 'perf', label: 'Perf' },
  { id: 'system', label: 'System' },
  { id: 'credits', label: 'Credits' },
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
        className="w-[400px] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">Settings</h2>
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Close settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 px-5 border-b border-zinc-800/60">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
              style={{
                color: tab === id ? 'var(--clr-a)' : 'var(--txt-muted)',
                borderBottom: tab === id ? '2px solid var(--clr-a)' : '2px solid transparent',
                textShadow: tab === id ? '0 0 6px var(--clr-a)44' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5 space-y-3 min-h-[220px]">
          {tab === 'mixer' && <MixerTab />}
          {tab === 'audio' && <AudioTab />}
          {tab === 'midi' && <MidiTab />}
          {tab === 'perf' && <PerfTab />}
          {tab === 'system' && <SystemTab />}
          {tab === 'credits' && <CreditsTab />}
        </div>

        {/* Version */}
        <div className="text-center pb-3">
          <span className="text-[9px] text-zinc-500">Mixi v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.4'}</span>
        </div>
      </div>
    </div>
  );
};

// ── Tab: Mixer ──────────────────────────────────────────────

const MixerTab: FC = () => {
  const eqRange = useSettingsStore((s) => s.eqRange);
  const setEqRange = useSettingsStore((s) => s.setEqRange);
  const quantizeRes = useSettingsStore((s) => s.quantizeResolution);
  const setQuantizeRes = useSettingsStore((s) => s.setQuantizeResolution);

  return (
    <>
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

      <Divider />

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
    </>
  );
};

// ── Tab: Audio ──────────────────────────────────────────────

const AudioTab: FC = () => {
  const bpmRange = useSettingsStore((s) => s.bpmRange);
  const setBpmRange = useSettingsStore((s) => s.setBpmRange);
  const loadDemoTrack = useSettingsStore((s) => s.loadDemoTrack);
  const setLoadDemoTrack = useSettingsStore((s) => s.setLoadDemoTrack);

  return (
    <>
      <SettingRow label="BPM Detection Range" description="Hint for BPM analysis on track load">
        <SegmentedControl<BpmRangePreset>
          options={(['wide', 'downtempo', 'house', 'dnb'] as const).map((p) => ({
            value: p,
            label: BPM_RANGE_PRESETS[p].label,
          }))}
          value={bpmRange}
          onChange={setBpmRange}
        />
      </SettingRow>

      <Divider />

      <SettingRow label="Demo Track" description="Load demo track on Deck A at startup">
        <ToggleSwitch checked={loadDemoTrack} onChange={() => setLoadDemoTrack(!loadDemoTrack)} />
      </SettingRow>
    </>
  );
};

// ── Tab: MIDI ───────────────────────────────────────────────

import type { MidiAction } from '../../midi/MidiManager';

const MIDI_PRESETS = [
  { id: 'manual', label: 'Manual (MIDI Learn)' },
  { id: 'akai-midimix', label: 'Akai MIDI Mix' },
] as const;

/** All learnable parameters, organized by section. */
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

/** Match a MidiAction to an existing mapping. */
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
    if (presetId === 'akai-midimix') {
      loadPreset('Akai MIDI Mix', AKAI_MIDI_MIX_PRESET);
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
    <div className="space-y-2">
      {/* Preset selector */}
      <div className="flex justify-between items-center">
        <select
          value={activePreset === 'Akai MIDI Mix' ? 'akai-midimix' : 'manual'}
          onChange={(e) => handlePreset(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-300 font-mono"
        >
          {MIDI_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          {isLearning && (
            <button type="button" onClick={cancelLearn}
              className="text-[9px] text-amber-400 hover:text-amber-300 font-mono uppercase animate-pulse">
              Cancel
            </button>
          )}
          {mappings.length > 0 && (
            <button type="button" onClick={clearMappings}
              className="text-[9px] text-red-400 hover:text-red-300 font-mono uppercase">
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Parameter mapping table */}
      <div className="max-h-[280px] overflow-auto space-y-2 pr-1">
        {MIDI_PARAMS.map(({ section, params }) => (
          <div key={section}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-0.5 sticky top-0 bg-zinc-950 py-0.5">
              {section}
            </div>
            {params.map(({ label, action }) => {
              const mapping = findMapping(mappings, action);
              const waiting = isWaiting(action);
              return (
                <div key={`${action.type}-${'deck' in action ? (action as any).deck : 'M'}`}
                  className="flex items-center justify-between py-0.5 border-b border-zinc-800/20">
                  <span className="text-[10px] text-zinc-400 w-[70px]">{label}</span>
                  <span className="text-[9px] font-mono text-zinc-600 flex-1 text-center">
                    {waiting ? (
                      <span className="text-amber-400 animate-pulse">⏳ Move control…</span>
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
                        border: `1px solid ${waiting ? 'var(--status-warn)' : 'rgba(255,255,255,0.08)'}`,
                      }}>
                      {waiting ? '…' : 'Learn'}
                    </button>
                    {mapping && (
                      <button type="button"
                        onClick={() => removeMapping(action.type, 'deck' in action ? (action as any).deck : undefined)}
                        className="text-[8px] text-zinc-600 hover:text-red-400 px-1">
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

  return (
    <>
      <SettingRow label="FPS Limit" description="Cap canvas rendering rate (saves GPU)">
        <SegmentedControl<FpsLimit>
          options={[
            { value: 60, label: '60' },
            { value: 30, label: '30' },
          ]}
          value={fpsLimit}
          onChange={setFpsLimit}
        />
      </SettingRow>

      <Divider />

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

  // Native audio state
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [nativeHost, setNativeHost] = useState('');
  const [nativeDevices, setNativeDevices] = useState<Array<{id: string; name: string; isDefault: boolean}>>([]);

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

    // Probe native audio (Electron only)
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
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">System Info</span>
        <InfoRow label="Browser" value={sysInfo.ua} />
        <InfoRow label="CPU Cores" value={String(sysInfo.cores)} />
        <InfoRow label="Memory" value={sysInfo.mem} />
        <InfoRow label="Audio SR" value="44.1 kHz" />
        <InfoRow label="Tick Rate" value="50 ms (20 Hz)" />
      </div>

      <Divider />

      <div className="space-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">DSP Engine</span>
        <SettingRow
          label="Rust/Wasm DSP"
          description={useWasmDsp ? 'AudioWorklet (Rust)' : 'Native WebAudio'}
        >
          <ToggleSwitch
            checked={useWasmDsp}
            onChange={() => setUseWasmDsp(!useWasmDsp)}
          />
        </SettingRow>
        {useWasmDsp && (
          <div className="text-[9px] text-amber-400/80 px-1">
            Experimental: Requires page reload to take effect.
          </div>
        )}
      </div>

      {/* Native Audio I/O — only visible in Electron with addon */}
      {nativeAvailable && (
        <>
          <Divider />
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Native Audio I/O
            </span>
            <InfoRow label="Backend" value={nativeHost} />
            <InfoRow
              label="Devices"
              value={nativeDevices.length > 0
                ? nativeDevices.map(d => `${d.name}${d.isDefault ? ' ★' : ''}`).join(', ')
                : 'Scanning...'}
            />
            <div className="text-[9px] text-emerald-400/70 px-1">
              ✓ Zero-copy audio path available (cpal → {nativeHost})
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── Tab: Credits ────────────────────────────────────────────

const CreditRow: FC<{ name: string; role: string; link?: string; icon?: string }> = ({ name, role, link, icon }) => (
  <div className="flex justify-between items-center text-[10px]">
    <div>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:underline" style={{ color: 'var(--clr-a)' }}>{name}</a>
      ) : (
        <span className="text-zinc-300">{name}</span>
      )}
      {icon && <span className="ml-1 text-[9px]">{icon}</span>}
    </div>
    <span className="text-zinc-500">{role}</span>
  </div>
);

const CreditsTab: FC = () => (
  <div className="space-y-3">
    <div className="space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Team</span>
      <CreditRow name="Fabrizio Salmi" role="Author" link="mailto:fabrizio.salmi@gmail.com" icon="👾" />
      <CreditRow name="The FreeTekno Community" role="Love & Music" />
      <CreditRow name="Gemini & Claude" role="Coders" />
      <CreditRow name="Suno" role="Demo Tracks" />
    </div>

    <Divider />

    <div className="space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Source Code</span>
      <div className="text-[10px]">
        <a
          href="https://github.com/fabriziosalmi/mixi"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono hover:underline"
          style={{ color: 'var(--clr-a)' }}
        >
          github.com/fabriziosalmi/mixi
        </a>
      </div>
    </div>
  </div>
);

// ── Shared sub-components ────────────────────────────────────

const Divider: FC = () => <div className="h-px bg-zinc-800/60" />;

const SettingRow: FC<{ label: string; description: string; children: React.ReactNode }> = ({
  label, description, children,
}) => (
  <div className="flex items-center justify-between gap-3">
    <div>
      <div className="text-xs text-zinc-300">{label}</div>
      <div className="text-[10px] text-zinc-500">{description}</div>
    </div>
    {children}
  </div>
);

const ToggleSwitch: FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    title={checked ? 'Disable' : 'Enable'}
    className="relative w-9 h-5 rounded-full transition-all duration-200"
    style={{
      background: checked ? 'var(--srf-mid)' : 'var(--srf-raised)',
      border: `1px solid ${checked ? 'var(--clr-a)44' : 'var(--brd-default)'}`,
      boxShadow: checked ? 'inset 0 0 6px var(--clr-a)11' : 'none',
    }}
  >
    <div
      className="absolute top-0.5 h-4 w-4 rounded-full transition-all duration-200"
      style={{
        left: checked ? 18 : 2,
        background: checked ? 'var(--clr-a)' : 'var(--txt-muted)',
        boxShadow: checked ? '0 0 8px var(--clr-a)66, 0 0 2px var(--clr-a)' : '0 1px 2px rgba(0,0,0,0.5)',
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
    <div className="flex rounded-md overflow-hidden border border-zinc-800">
      {options.map((opt, i) => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className="px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-all"
            style={{
              background: active ? 'var(--srf-mid)' : 'transparent',
              color: active ? 'var(--clr-a)' : 'var(--txt-muted)',
              borderRight: i < options.length - 1 ? '1px solid var(--brd-default)' : 'none',
              textShadow: active ? '0 0 6px var(--clr-a)44' : 'none',
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
  <div className="flex justify-between text-[10px]">
    <span className="text-zinc-500">{label}</span>
    <span className="text-zinc-400 font-mono">{value}</span>
  </div>
);
