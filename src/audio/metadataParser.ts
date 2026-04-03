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

export interface TrackMeta {
  title: string;
  artist: string;
  album: string;
  genre: string;
  bpm: number | null;
}

/**
 * Parse metadata from an audio Blob / File.
 * Returns sensible defaults when parsing fails or tags are absent.
 */
export async function parseTrackMeta(blob: Blob): Promise<TrackMeta> {
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
