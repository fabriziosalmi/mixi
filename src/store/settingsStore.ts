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
import { persist } from 'zustand/middleware';
import type { CustomSkin } from '../utils/skinLoader';

/** Built-in skin presets. */
export type BuiltinSkinId = 'midnight' | 'freetekno' | 'carbon';
export const BUILTIN_SKINS: BuiltinSkinId[] = ['midnight', 'freetekno', 'carbon'];

/** Any valid skin id (built-in or custom). */
export type SkinId = string;

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
  eqRange: EqRangePreset;
  skin: SkinId;
  customSkins: CustomSkin[];
  loadDemoTrack: boolean;
  fpsLimit: FpsLimit;
  bpmRange: BpmRangePreset;
  quantizeResolution: QuantizeResolution;
}

export interface SettingsActions {
  toggleDebugPanel: () => void;
  toggleSettings: () => void;
  setShowSettings: (v: boolean) => void;
  setEqRange: (preset: EqRangePreset) => void;
  setSkin: (skin: SkinId) => void;
  addCustomSkin: (skin: CustomSkin) => void;
  removeCustomSkin: (id: string) => void;
  setLoadDemoTrack: (v: boolean) => void;
  setFpsLimit: (fps: FpsLimit) => void;
  setBpmRange: (preset: BpmRangePreset) => void;
  setQuantizeResolution: (res: QuantizeResolution) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      showDebugPanel: false,
      showSettings: false,
      eqRange: 'standard' as EqRangePreset,
      skin: 'midnight' as SkinId,
      customSkins: [] as CustomSkin[],
      loadDemoTrack: true,
      fpsLimit: 60 as FpsLimit,
      bpmRange: 'wide' as BpmRangePreset,
      quantizeResolution: 1 as QuantizeResolution,

      toggleDebugPanel: () => set((s) => ({ showDebugPanel: !s.showDebugPanel })),
      toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
      setShowSettings: (v) => set({ showSettings: v }),
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
    }),
    {
      name: 'mixi-settings',
      partialize: (s) => ({
        eqRange: s.eqRange,
        skin: s.skin,
        customSkins: s.customSkins,
        showDebugPanel: s.showDebugPanel,
        loadDemoTrack: s.loadDemoTrack,
        fpsLimit: s.fpsLimit,
        bpmRange: s.bpmRange,
        quantizeResolution: s.quantizeResolution,
      }),
    },
  ),
);
