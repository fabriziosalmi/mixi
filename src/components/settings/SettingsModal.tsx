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
          <span className="text-[9px] text-zinc-500">Mixi v{__APP_VERSION__}</span>
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

const MIDI_PRESETS = [
  { id: 'manual', label: 'Manual (MIDI Learn)' },
  { id: 'akai-midimix', label: 'Akai MIDI Mix' },
] as const;

const MidiTab: FC = () => {
  const mappings = useMidiStore((s) => s.mappings);
  const activePreset = useMidiStore((s) => s.activePreset);
  const loadPreset = useMidiStore((s) => s.loadPreset);
  const clearMappings = useMidiStore((s) => s.clearMappings);

  const handlePreset = (presetId: string) => {
    if (presetId === 'akai-midimix') {
      loadPreset('Akai MIDI Mix', AKAI_MIDI_MIX_PRESET);
    } else {
      clearMappings();
    }
  };

  return (
    <>
      <SettingRow label="Controller Preset" description="Load a factory mapping for your controller">
        <select
          value={activePreset === 'Akai MIDI Mix' ? 'akai-midimix' : 'manual'}
          onChange={(e) => handlePreset(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-300 font-mono"
        >
          {MIDI_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </SettingRow>

      <Divider />

      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Mappings ({mappings.length})
          </span>
          {mappings.length > 0 && (
            <button
              type="button"
              onClick={clearMappings}
              className="text-[9px] text-red-400 hover:text-red-300 font-mono uppercase"
            >
              Clear All
            </button>
          )}
        </div>
        {mappings.length === 0 ? (
          <div className="text-[10px] text-zinc-600 py-2">
            No mappings. Use MIDI Learn or load a preset.
          </div>
        ) : (
          <div className="max-h-[120px] overflow-auto space-y-0.5">
            {mappings.map((m, i) => (
              <div key={i} className="flex justify-between text-[9px] font-mono py-0.5 border-b border-zinc-800/30">
                <span className="text-zinc-400">
                  {m.action.type}{'deck' in m.action ? ` ${(m.action as any).deck}` : ''}
                </span>
                <span className="text-zinc-600">
                  {m.type.toUpperCase()} Ch{m.channel + 1} #{m.control}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
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
  }, []);

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">System Info</span>
      <InfoRow label="Browser" value={sysInfo.ua} />
      <InfoRow label="CPU Cores" value={String(sysInfo.cores)} />
      <InfoRow label="Memory" value={sysInfo.mem} />
      <InfoRow label="Audio SR" value="44.1 kHz" />
      <InfoRow label="Tick Rate" value="50 ms (20 Hz)" />
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
