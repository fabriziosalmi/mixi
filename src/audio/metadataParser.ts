/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – ID3 / Audio Metadata Parser
//
// Extracts artist, title, album, genre, and BPM from audio
// file metadata (ID3v2, Vorbis, FLAC, MP4, etc.) using
// the music-metadata library.
// ─────────────────────────────────────────────────────────────

import { parseBlob } from 'music-metadata';
import { isWasmReady } from '../wasm/wasmBridge';

// Wasm module — imported dynamically
let wasmModule: typeof import('../../mixi-core/pkg/mixi_core') | null = null;
import('../../mixi-core/pkg/mixi_core').then((m) => { wasmModule = m; }).catch(() => {});

export interface TrackMeta {
  title: string;
  artist: string;
  album: string;
  genre: string;
  bpm: number | null;
}

/**
 * Parse metadata from an audio Blob / File.
 * Uses Rust/Wasm when available for fast ID3v2/Vorbis parsing.
 * Falls back to JS music-metadata library.
 */
export async function parseTrackMeta(blob: Blob): Promise<TrackMeta> {
  // ── Wasm fast path ──────────────────────────────────────────
  if (isWasmReady() && wasmModule) {
    try {
      const buffer = await blob.arrayBuffer();
      // Only send first 256KB — metadata is always in the header
      const headerSize = Math.min(buffer.byteLength, 256 * 1024);
      const header = new Uint8Array(buffer, 0, headerSize);
      const result = wasmModule.parse_metadata(header);
      const [title, artist, album, genre, bpmStr] = result.split('\0');
      const bpmNum = bpmStr ? parseFloat(bpmStr) : NaN;
      const meta: TrackMeta = {
        title: title || '',
        artist: artist || '',
        album: album || '',
        genre: genre || '',
        bpm: !isNaN(bpmNum) && bpmNum > 0 ? bpmNum : null,
      };
      // If Rust found something, return it; otherwise fall through to JS
      if (meta.title || meta.artist || meta.album) {
        return meta;
      }
    } catch {
      // Fall through to JS
    }
  }

  // ── JS fallback (music-metadata library) ─────────────────────
  try {
    const metadata = await parseBlob(blob);
    const { common } = metadata;

    return {
      title: common.title ?? '',
      artist: common.artist ?? '',
      album: common.album ?? '',
      genre: common.genre?.[0] ?? '',
      bpm: common.bpm ?? null,
    };
  } catch {
    return { title: '', artist: '', album: '', genre: '', bpm: null };
  }
}
