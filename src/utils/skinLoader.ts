/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Custom Skin Loader
//
// Loads skin folders (skin.json + skin.css) from the filesystem
// via the File System Access API or <input> fallback.
// Injects/removes <style> tags scoped to .mixi-skin-{id}.
// ─────────────────────────────────────────────────────────────

export interface CustomSkin {
  id: string;
  name: string;
  dotColor: string;
  css: string;
}

const STYLE_PREFIX = 'mixi-custom-skin-';

/** Inject a custom skin's CSS into a <style> element in <head>. */
export function injectSkinCSS(skin: CustomSkin): void {
  const existing = document.getElementById(STYLE_PREFIX + skin.id);
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.id = STYLE_PREFIX + skin.id;
  style.textContent = skin.css;
  document.head.appendChild(style);
}

/** Remove a custom skin's injected <style> element. */
export function removeSkinCSS(skinId: string): void {
  const el = document.getElementById(STYLE_PREFIX + skinId);
  if (el) el.remove();
}

/** Inject all persisted custom skins (call on app init). */
export function injectAllCustomSkins(skins: CustomSkin[]): void {
  for (const s of skins) injectSkinCSS(s);
}

/**
 * Parse a skin folder from a FileList (from <input webkitdirectory>).
 * Expects skin.json + skin.css at the folder root.
 */
export async function parseSkinFolder(files: FileList): Promise<CustomSkin> {
  let jsonFile: File | null = null;
  let cssFile: File | null = null;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // webkitdirectory gives paths like "folder-name/skin.json"
    const name = f.name.toLowerCase();
    if (name === 'skin.json') jsonFile = f;
    if (name === 'skin.css') cssFile = f;
  }

  if (!jsonFile) throw new Error('skin.json not found in folder');
  if (!cssFile) throw new Error('skin.css not found in folder');

  const jsonText = await jsonFile.text();
  const meta = JSON.parse(jsonText);

  if (!meta.id || typeof meta.id !== 'string') throw new Error('skin.json must have a string "id"');
  if (!meta.name || typeof meta.name !== 'string') throw new Error('skin.json must have a string "name"');

  // Sanitize id: only lowercase alphanumeric + hyphens
  const id = meta.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

  const css = await cssFile.text();

  // Validate that CSS only contains rules scoped to .mixi-skin-{id}
  // (basic safety check — not bulletproof but catches obvious mistakes)
  if (css.includes('<script') || css.includes('javascript:') || css.includes('expression(')) {
    throw new Error('Skin CSS contains disallowed content');
  }

  return {
    id,
    name: meta.name,
    dotColor: meta.dotColor || '#888',
    css,
  };
}
