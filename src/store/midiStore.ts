/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MidiAction, MidiMapping } from '../midi/MidiManager';

interface MidiState {
  isLearning: boolean;
  learningAction: MidiAction | null;
  mappings: MidiMapping[];

  setLearning: (learning: boolean) => void;
  setLearningAction: (action: MidiAction | null) => void;
  addMapping: (mapping: MidiMapping) => void;
  removeMapping: (actionType: MidiAction['type'], deck?: 'A'|'B') => void;
  clearMappings: () => void;
}

export const useMidiStore = create<MidiState>()(
  persist(
    (set) => ({
      isLearning: false,
      learningAction: null,
      mappings: [],

      setLearning: (learning) => set({ isLearning: learning, learningAction: null }),
      setLearningAction: (action) => set({ learningAction: action }),
      
      addMapping: (mapping) =>
        set((state) => {
          // Remove old mapping for the same action
          const filtered = state.mappings.filter(
            (m) => !(m.action.type === mapping.action.type && (m.action as any).deck === (mapping.action as any).deck)
          );
          // Add the new mapping
          return { mappings: [...filtered, mapping], learningAction: null };
        }),

      removeMapping: (actionType, deck) =>
        set((state) => ({
          mappings: state.mappings.filter(
            (m) => !(m.action.type === actionType && (m.action as any).deck === deck)
          )
        })),

      clearMappings: () => set({ mappings: [] }),
    }),
    { name: 'mixi-midi-bindings' }
  )
);
