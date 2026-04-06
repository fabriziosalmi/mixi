/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Settings Store
//
// App-level settings, separate from the mixer state.
// Persisted to localStorage.
// ─────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from './safeStorage';
import type { CustomSkin } from '../utils/skinLoader';

/** Built-in skin presets. */
export type BuiltinSkinId = 'midnight' | 'freetekno' | 'carbon';
export const BUILTIN_SKINS: BuiltinSkinId[] = ['midnight', 'freetekno', 'carbon'];

/** Any valid skin id (built-in or custom). */
export type SkinId = string;

/** EQ model type — selects the filter architecture per channel. */
export type EqModel = 'lr4-isolator' | 'dj-peak' | 'xone-kill';

export const EQ_MODELS: { value: EqModel; label: string; description: string }[] = [
  { value: 'lr4-isolator', label: 'LR4 Isolator',  description: 'Linkwitz-Riley 24dB/oct parallel isolator (default)' },
  { value: 'dj-peak',      label: 'DJ Peak',        description: 'Pioneer DJM-style shelf + peak EQ' },
  { value: 'xone-kill',    label: 'Xone Kill',      description: 'Allen & Heath-style 48dB/oct full-kill isolator' },
];

/** EQ range presets — [min dB, max dB]. Centre is always 0 dB. */
export type EqRangePreset = 'techno' | 'standard' | 'gentle';

export const EQ_RANGE_PRESETS: Record<EqRangePreset, { min: number; max: number; label: string }> = {
  techno:   { min: -32, max: 12, label: '-32 / +12' },
  standard: { min: -26, max: 6,  label: '-26 / +6' },
  gentle:   { min: -18, max: 6,  label: '-18 / +6' },
};

/** FPS limit for canvas rendering loops. */
export type FpsLimit = 60 | 30;

/** BPM detection range presets. */
export type BpmRangePreset = 'wide' | 'downtempo' | 'house' | 'dnb';

export const BPM_RANGE_PRESETS: Record<BpmRangePreset, { min: number; max: number; label: string }> = {
  downtempo: { min: 70,  max: 120, label: '70–120' },
  house:     { min: 115, max: 150, label: '115–150' },
  dnb:       { min: 140, max: 190, label: '140–190' },
  wide:      { min: 65,  max: 200, label: '65–200' },
};

/** Quantize resolution in beats. */
export type QuantizeResolution = 1 | 0.5 | 0.25 | 0.125 | 0.0625;

export const QUANTIZE_RESOLUTIONS: { value: QuantizeResolution; label: string }[] = [
  { value: 1,      label: '1' },
  { value: 0.5,    label: '1/2' },
  { value: 0.25,   label: '1/4' },
  { value: 0.125,  label: '1/8' },
  { value: 0.0625, label: '1/16' },
];

export interface SettingsState {
  showDebugPanel: boolean;
  showSettings: boolean;
  eqModel: EqModel;
  eqRange: EqRangePreset;
  skin: SkinId;
  customSkins: CustomSkin[];
  loadDemoTrack: boolean;
  fpsLimit: FpsLimit;
  bpmRange: BpmRangePreset;
  quantizeResolution: QuantizeResolution;
  /** When true, use Rust/Wasm DSP in AudioWorklet instead of native WebAudio nodes. */
  useWasmDsp: boolean;
  /** Groove offset in ms (-10 to +10). Positive = push (urgency), negative = lay back. */
  grooveOffsetMs: number;
}

export interface SettingsActions {
  toggleDebugPanel: () => void;
  toggleSettings: () => void;
  setShowSettings: (v: boolean) => void;
  setEqModel: (model: EqModel) => void;
  setEqRange: (preset: EqRangePreset) => void;
  setSkin: (skin: SkinId) => void;
  addCustomSkin: (skin: CustomSkin) => void;
  removeCustomSkin: (id: string) => void;
  setLoadDemoTrack: (v: boolean) => void;
  setFpsLimit: (fps: FpsLimit) => void;
  setBpmRange: (preset: BpmRangePreset) => void;
  setQuantizeResolution: (res: QuantizeResolution) => void;
  setUseWasmDsp: (v: boolean) => void;
  setGrooveOffset: (ms: number) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      showDebugPanel: false,
      showSettings: false,
      eqModel: 'lr4-isolator' as EqModel,
      eqRange: 'standard' as EqRangePreset,
      skin: 'midnight' as SkinId,
      customSkins: [] as CustomSkin[],
      loadDemoTrack: true,
      fpsLimit: 60 as FpsLimit,
      bpmRange: 'wide' as BpmRangePreset,
      quantizeResolution: 1 as QuantizeResolution,
      useWasmDsp: false,
      grooveOffsetMs: 0,

      toggleDebugPanel: () => set((s) => ({ showDebugPanel: !s.showDebugPanel })),
      toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
      setShowSettings: (v) => set({ showSettings: v }),
      setEqModel: (model) => set({ eqModel: model }),
      setEqRange: (preset) => set({ eqRange: preset }),
      setSkin: (skin) => set({ skin }),
      addCustomSkin: (skin) =>
        set((s) => ({
          customSkins: [...s.customSkins.filter((c) => c.id !== skin.id), skin],
        })),
      removeCustomSkin: (id) =>
        set((s) => ({
          customSkins: s.customSkins.filter((c) => c.id !== id),
          // If active skin was removed, fall back to midnight
          ...(s.skin === id ? { skin: 'midnight' } : {}),
        })),
      setLoadDemoTrack: (v) => set({ loadDemoTrack: v }),
      setFpsLimit: (fps) => set({ fpsLimit: fps }),
      setBpmRange: (preset) => set({ bpmRange: preset }),
      setQuantizeResolution: (res) => set({ quantizeResolution: res }),
      setUseWasmDsp: (v) => set({ useWasmDsp: v }),
      setGrooveOffset: (ms) => set({ grooveOffsetMs: Math.max(-10, Math.min(10, ms)) }),
    }),
    {
      name: 'mixi-settings',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        eqModel: s.eqModel,
        eqRange: s.eqRange,
        skin: s.skin,
        customSkins: s.customSkins,
        showDebugPanel: s.showDebugPanel,
        fpsLimit: s.fpsLimit,
        bpmRange: s.bpmRange,
        quantizeResolution: s.quantizeResolution,
        useWasmDsp: s.useWasmDsp,
      }),
      merge: (persisted, current) => {
        const p = persisted as Record<string, unknown> | undefined;
        if (!p) return current;
        // Strip stale loadDemoTrack — it should always default to true
        const { loadDemoTrack: _, ...clean } = p;
        return { ...current, ...clean };
      },
    },
  ),
);
