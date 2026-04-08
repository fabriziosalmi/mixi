/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// useDeckRegistry — React hook for the deck plugin registry
//
// Fetches external decks on mount and triggers re-render when
// the registry is populated. Components using this hook will
// see both built-in and external decks.
// ─────────────────────────────────────────────────────────────

import { useEffect, useSyncExternalStore } from 'react';
import { deckRegistry } from '../decks/registry';
import type { HouseDeckEntry } from '../decks/index';

/** Subscribe to registry changes for React re-render. */
function subscribe(cb: () => void) {
  return deckRegistry.subscribe(cb);
}

function getSnapshot() {
  return deckRegistry.isReady;
}

/**
 * Hook that fetches the external deck registry on mount and
 * returns all available decks (built-in + external).
 *
 * Safe to use in any component — multiple mounts share
 * the same singleton fetch.
 */
export function useDeckRegistry(): {
  ready: boolean;
  decks: HouseDeckEntry[];
  externalCount: number;
} {
  const ready = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    deckRegistry.fetchFromRemote();
  }, []);

  return {
    ready,
    decks: deckRegistry.getAll(),
    externalCount: deckRegistry.externalCount,
  };
}
