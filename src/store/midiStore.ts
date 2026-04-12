/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import { create } from 'zustand';

// Auto-cancel timer for MIDI learn mode
let _learnTimer: ReturnType<typeof setTimeout> | null = null;
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from './safeStorage';
import type { MidiAction, MidiMapping } from '../midi/MidiManager';

interface MidiState {
  isLearning: boolean;
  learningAction: MidiAction | null;
  mappings: MidiMapping[];
  activePreset: string;

  setLearning: (learning: boolean) => void;
  setLearningAction: (action: MidiAction | null) => void;
  addMapping: (mapping: MidiMapping) => void;
  removeMapping: (actionType: MidiAction['type'], deck?: 'A'|'B') => void;
  clearMappings: () => void;
  loadPreset: (name: string, mappings: MidiMapping[]) => void;
  exportMappings: () => string;
}

export const useMidiStore = create<MidiState>()(
  persist(
    (set, get) => ({
      isLearning: false,
      learningAction: null,
      mappings: [],
      activePreset: 'Manual',

      setLearning: (learning) => {
        // Auto-cancel learn mode after 10 seconds if no MIDI input received
        if (_learnTimer) clearTimeout(_learnTimer);
        if (learning) {
          _learnTimer = setTimeout(() => {
            set({ isLearning: false, learningAction: null });
            _learnTimer = null;
          }, 10_000);
        } else {
          _learnTimer = null;
        }
        set({ isLearning: learning, learningAction: null });
      },
      setLearningAction: (action) => set({ learningAction: action }),
      
      addMapping: (mapping) =>
        set((state) => {
          const filtered = state.mappings.filter(
            (m) => !(m.action.type === mapping.action.type && (m.action as any).deck === (mapping.action as any).deck)
          );
          return { mappings: [...filtered, mapping], learningAction: null, isLearning: false, activePreset: 'Custom' };
        }),

      removeMapping: (actionType, deck) =>
        set((state) => ({
          mappings: state.mappings.filter(
            (m) => !(m.action.type === actionType && (m.action as any).deck === deck)
          )
        })),

      clearMappings: () => set({ mappings: [], activePreset: 'Manual' }),

      loadPreset: (name, mappings) => set({ mappings, activePreset: name }),

      exportMappings: () => JSON.stringify(get().mappings, null, 2),
    }),
    { name: 'mixi-midi-bindings', storage: createJSONStorage(() => safeStorage) }
  )
);
