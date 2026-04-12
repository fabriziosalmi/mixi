/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// DeckRegistry — Merges built-in house decks with external
// community plugins from the mixi-decks repo.
//
// Built-in decks are always available (Groovebox, TurboKick,
// TurboBass). External decks are fetched from a registry.json
// manifest hosted on GitHub and loaded as ES modules via
// dynamic import().
//
// If the registry fetch fails (offline, network error, etc.),
// the app works perfectly with built-in decks only.
// ─────────────────────────────────────────────────────────────

import { lazy, type FC } from 'react';
import { HOUSE_DECKS, type HouseDeckEntry, type HouseDeckProps } from './index';
import type { DeckMode } from '../types';
import { log } from '../utils/logger';

// ── Registry URL ─────────────────────────────────────────────

const REGISTRY_URL =
  'https://raw.githubusercontent.com/fabriziosalmi/mixi-decks/main/registry.json';

// ── Manifest type (what registry.json contains per deck) ─────

export interface DeckManifest {
  /** Unique deck identifier (kebab-case). */
  id: string;
  /** Mode key — must be unique across all decks. */
  mode: string;
  /** Display label for the picker (e.g. "SAMPLE SYNTH"). */
  label: string;
  /** Accent color hex (e.g. "#ff00ff"). */
  accentColor: string;
  /** Short description. */
  description: string;
  /** Author name. */
  author: string;
  /** Semver version string. */
  version: string;
  /** URL to the pre-built ES module (.mjs) — desktop component. */
  esmEntry: string;
  /** Optional URL to mobile-optimized ES module. */
  esmMobile?: string;
  /** Minimum MIXI version required (semver). */
  minMixiVersion: string;
  /** Optional icon (SVG data URI or URL). */
  icon?: string;
  /** Tags for filtering/search. */
  tags?: string[];
}

// ── Extended entry type for external decks ────────────────────

export interface ExternalDeckEntry extends HouseDeckEntry {
  external: true;
  manifest: DeckManifest;
}

// ── Simple semver comparison (major.minor.patch) ─────────────

function semverGte(current: string, required: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cM, cm, cp] = parse(current);
  const [rM, rm, rp] = parse(required);
  if (cM !== rM) return cM > rM;
  if (cm !== rm) return cm > rm;
  return cp >= rp;
}

// ── MIXI version from package.json (injected by Vite) ────────

// Vite define injection (declared in vite.config.ts)
declare const __MIXI_VERSION__: string | undefined;
const MIXI_VERSION = typeof __MIXI_VERSION__ !== 'undefined' ? __MIXI_VERSION__ : '0.0.0';

// ── Registry class ───────────────────────────────────────────

class DeckRegistryImpl {
  private external: ExternalDeckEntry[] = [];
  private fetched = false;
  private fetching: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  /** All available decks: built-in + external. */
  getAll(): HouseDeckEntry[] {
    return [...HOUSE_DECKS, ...this.external];
  }

  /** Find a deck by its mode key. */
  findByMode(mode: string): HouseDeckEntry | undefined {
    return this.getAll().find((d) => d.mode === mode);
  }

  /** Whether external decks have been fetched. */
  get isReady(): boolean {
    return this.fetched;
  }

  /** Number of external decks loaded. */
  get externalCount(): number {
    return this.external.length;
  }

  /** Subscribe to registry changes (for React re-render). */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  /**
   * Fetch the remote registry manifest and load external decks.
   * Safe to call multiple times (deduplicates).
   * Fails silently — built-in decks always work.
   *
   * NOTE: Disabled in production until the React dual-instance issue
   * is resolved (error #306). External ESM modules create a separate
   * React context that conflicts with the bundled React. The fix
   * requires either import maps (not yet widely supported) or
   * bundling external decks into the main Vite build.
   */
  async fetchFromRemote(url = REGISTRY_URL): Promise<void> {
    // External deck loading disabled until Vite's vendor chunks support
    // standard ESM exports. The react-vendor chunk uses CJS-to-ESM format
    // without proper default/named exports, breaking import map resolution.
    // Built-in decks (Groovebox, TurboKick, TurboBass) always work.
    if (import.meta.env.PROD) {
      this.fetched = true;
      this.notify();
      return;
    }
    if (this.fetched) return;
    if (this.fetching) return this.fetching;

    this.fetching = this._doFetch(url);
    return this.fetching;
  }

  private async _doFetch(url: string): Promise<void> {
    try {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const manifests: DeckManifest[] = await resp.json();

      // Filter: valid manifests + version check + no conflicts with built-in
      const builtInModes = new Set(HOUSE_DECKS.map((d) => d.mode));

      this.external = manifests
        .filter((m) => {
          if (!m.id || !m.mode || !m.esmEntry || !m.label) {
            log.warn('DECKS', `Skipping invalid manifest: ${JSON.stringify(m)}`);
            return false;
          }
          if (builtInModes.has(m.mode)) {
            log.warn('DECKS', `Skipping "${m.id}": mode "${m.mode}" conflicts with built-in`);
            return false;
          }
          if (!semverGte(MIXI_VERSION, m.minMixiVersion)) {
            log.warn('DECKS', `Skipping "${m.id}": requires MIXI ${m.minMixiVersion}, have ${MIXI_VERSION}`);
            return false;
          }
          return true;
        })
        .map((m) => ({
          mode: m.mode as DeckMode,
          label: m.label,
          accentColor: m.accentColor,
          component: lazy(() =>
            import(/* @vite-ignore */ m.esmEntry).then((mod) => ({
              default: (mod.default ?? mod[Object.keys(mod)[0]]) as FC<HouseDeckProps>,
            })),
          ),
          mobileComponent: m.esmMobile
            ? lazy(() =>
                import(/* @vite-ignore */ m.esmMobile!).then((mod) => ({
                  default: (mod.default ?? mod[Object.keys(mod)[0]]) as FC<HouseDeckProps>,
                })),
              )
            : undefined,
          external: true as const,
          manifest: m,
        }));

      log.success('DECKS', `Loaded ${this.external.length} external deck(s) from registry`);
    } catch (err) {
      log.warn('DECKS', `Registry fetch failed (built-in decks still available): ${err}`);
      this.external = [];
    } finally {
      this.fetched = true;
      this.fetching = null;
      this.notify();
    }
  }
}

/** Singleton deck registry. */
export const deckRegistry = new DeckRegistryImpl();
