/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// M3: Safe localStorage wrapper that catches QuotaExceededError.
// Zustand's persist middleware does NOT handle storage quota errors.
// Without this, a large track library causes a silent crash when
// setItem throws, leaving the store in a corrupted half-persisted state.

import type { StateStorage } from 'zustand/middleware';

export const safeStorage: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      // QuotaExceededError or SecurityError (private browsing).
      // Silently degrade — the app works fine without persistence,
      // but the user loses state on reload.
      if (typeof console !== 'undefined') {
        console.warn(`[MIXI] localStorage.setItem('${name}') failed:`, e);
      }
    }
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name);
    } catch {
      // noop
    }
  },
};
