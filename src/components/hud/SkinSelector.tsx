/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Skin Selector (top bar)
//
// Two controls:
//   1. Layers icon — click to cycle through all skins (loop)
//   2. Folder icon — click to load a custom skin from disk
// ─────────────────────────────────────────────────────────────

import { useCallback, useRef, type FC, useMemo } from 'react';
import { useSettingsStore, BUILTIN_SKINS, type BuiltinSkinId } from '../../store/settingsStore';
import { parseSkinFolder, injectSkinCSS } from '../../utils/skinLoader';
import { log } from '../../utils/logger';

/** Dot colors for built-in skins. */
const BUILTIN_DOT: Record<BuiltinSkinId, string> = {
  midnight:  'var(--skin-dot-midnight)',
  freetekno: 'var(--skin-dot-freetekno)',
  carbon:    'var(--skin-dot-carbon)',
};

const BUILTIN_LABELS: Record<BuiltinSkinId, string> = {
  midnight:  'Midnight',
  freetekno: 'Freetekno',
  carbon:    'Carbon',
};

export const SkinSelector: FC = () => {
  const skin = useSettingsStore((s) => s.skin);
  const setSkin = useSettingsStore((s) => s.setSkin);
  const customSkins = useSettingsStore((s) => s.customSkins);
  const addCustomSkin = useSettingsStore((s) => s.addCustomSkin);
  const fileRef = useRef<HTMLInputElement>(null);

  // Build the full ordered skin list: built-in + custom
  const allSkinIds = useMemo(() => [...BUILTIN_SKINS, ...customSkins.map((c) => c.id)], [customSkins]);
  const currentIdx = allSkinIds.indexOf(skin);

  // Resolve display color for current skin
  const dotColor = (BUILTIN_SKINS as readonly string[]).includes(skin)
    ? BUILTIN_DOT[skin as BuiltinSkinId]
    : customSkins.find((c) => c.id === skin)?.dotColor ?? '#888';

  // Resolve display name
  const skinName = (BUILTIN_SKINS as readonly string[]).includes(skin)
    ? BUILTIN_LABELS[skin as BuiltinSkinId]
    : customSkins.find((c) => c.id === skin)?.name ?? skin;

  const cycleSkin = useCallback(() => {
    const next = allSkinIds[(currentIdx + 1) % allSkinIds.length];
    setSkin(next);
  }, [allSkinIds, currentIdx, setSkin]);

  const handleFolderSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      try {
        const loaded = await parseSkinFolder(files);
        injectSkinCSS(loaded);
        addCustomSkin(loaded);
        setSkin(loaded.id);
      } catch (err) {
        log.error('SkinLoader', `Failed to load custom skin: ${err}`);
      }
      // Reset input so same folder can be re-selected
      e.target.value = '';
    },
    [addCustomSkin, setSkin],
  );

  return (
    <div className="flex items-center gap-1.5">
      {/* Cycle skins icon */}
      <button
        type="button"
        onClick={cycleSkin}
        className="rounded-md p-1 transition-all active:scale-90"
        title={`Skin: ${skinName}`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={dotColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all duration-300"
          style={{ filter: `drop-shadow(0 0 3px ${dotColor}66)` }}
        >
          <polygon points="12 2 22 8.5 12 15 2 8.5" />
          <polyline points="2 12 12 18.5 22 12" />
          <polyline points="2 15.5 12 22 22 15.5" />
        </svg>
      </button>

      {/* Active skin dot */}
      <div
        className="h-[6px] w-[6px] rounded-full transition-all duration-300"
        style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}88` }}
        title={skinName}
      />

      {/* Load custom skin from folder */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="rounded-md p-1 transition-all active:scale-90 opacity-60 hover:opacity-100"
        title="Load skin from folder"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--txt-dim)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <polyline points="9 14 12 11 15 14" />
        </svg>
      </button>

      {/* Hidden directory input */}
      <input
        ref={fileRef}
        type="file"
        /* @ts-expect-error webkitdirectory is non-standard but widely supported */
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={handleFolderSelect}
      />
    </div>
  );
};
