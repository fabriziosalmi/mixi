/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Hot Cue Persistence (localStorage)
//
// Saves/loads hot cues keyed by track name.
// When a track is loaded that was seen before, its cues
// are automatically restored.
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mixi_hotcues';

interface HotCueStore {
  [trackName: string]: (number | null)[];
}

let _cache: HotCueStore | null = null;

function readAll(): HotCueStore {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _cache = raw ? JSON.parse(raw) : {};
    return _cache!;
  } catch {
    _cache = {};
    return _cache;
  }
}

function writeAll(store: HotCueStore): void {
  _cache = store;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage full or unavailable — silently ignore.
  }
}

/** Save hot cues for a track. */
export function saveHotCues(trackName: string, cues: (number | null)[]): void {
  if (!trackName) return;
  // Only save if there's at least one cue set.
  if (cues.every((c) => c === null)) {
    // Remove entry if all cues cleared.
    const store = readAll();
    delete store[trackName];
    writeAll(store);
    return;
  }
  const store = readAll();
  store[trackName] = [...cues];
  writeAll(store);
}

/** Load hot cues for a track. Returns null if not found or invalid. */
export function loadHotCues(trackName: string): (number | null)[] | null {
  if (!trackName) return null;
  const store = readAll();
  const raw = store[trackName];
  if (!Array.isArray(raw) || raw.length !== 8) return null;
  return raw.map(v => (typeof v === 'number' && isFinite(v)) ? v : null);
}
