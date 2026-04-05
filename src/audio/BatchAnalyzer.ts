/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI — PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Batch BPM/Key Analyzer
//
// Analyzes all tracks in the library that lack BPM or key data.
// Uses the existing Rust/Wasm BPM+Key detectors (same as
// single-track import) but runs them in a yielded queue so
// the main thread stays responsive.
//
// Usage:
//   const analyzer = new BatchAnalyzer();
//   analyzer.onProgress = (cur, total, name) => { ... };
//   await analyzer.analyzeAll();
//   analyzer.cancel();
// ─────────────────────────────────────────────────────────────

import { useBrowserStore } from '../store/browserStore';
import { useSettingsStore, BPM_RANGE_PRESETS } from '../store/settingsStore';
import { detectBpm } from './BpmDetector';
import { detectKey } from './KeyDetector';
import { getTrackBlob } from '../store/trackDb';
import { log } from '../utils/logger';

export class BatchAnalyzer {
  private _cancelled = false;
  private _running = false;

  /** Progress callback: (current, total, trackTitle). */
  onProgress?: (current: number, total: number, title: string) => void;
  /** Called when analysis completes or is cancelled. */
  onComplete?: () => void;

  get isRunning(): boolean { return this._running; }

  cancel(): void {
    this._cancelled = true;
  }

  /**
   * Analyze all tracks that need BPM or key detection.
   * Yields between tracks via setTimeout(0) to keep UI responsive.
   */
  async analyzeAll(): Promise<void> {
    if (this._running) return;
    this._running = true;
    this._cancelled = false;

    const store = useBrowserStore.getState();
    const tracks = store.tracks.filter((t) => !t.bpm || !t.key || t.analyzedAt === 0);

    if (tracks.length === 0) {
      this._running = false;
      this.onComplete?.();
      return;
    }

    const bpmPreset = useSettingsStore.getState().bpmRange;
    const { min: bpmMin, max: bpmMax } = BPM_RANGE_PRESETS[bpmPreset];

    for (let i = 0; i < tracks.length; i++) {
      if (this._cancelled) break;

      const track = tracks[i];
      this.onProgress?.(i + 1, tracks.length, track.title);

      try {
        // Fetch blob from IndexedDB
        const blob = await getTrackBlob(track.id);
        if (!blob) continue;

        // G6: Reuse a single OfflineAudioContext per batch to avoid leaking
        // native audio resources (one per track). decodeAudioData doesn't
        // require rendering — it only needs an AudioContext for decoding.
        const arrayBuf = await blob.arrayBuffer();
        const audioCtx = new OfflineAudioContext(1, 1, 44100);
        const decoded = await audioCtx.decodeAudioData(arrayBuf);

        // BPM detection (Rust/Wasm fast path if available)
        const bpmResult = detectBpm(decoded, { bpmMin, bpmMax });

        // Key detection (Rust/Wasm fast path if available)
        const keyResult = detectKey(decoded);

        // Update store
        useBrowserStore.getState().updateTrackAnalysis(
          track.id,
          Math.round(bpmResult.bpm),
          keyResult.camelot,
        );

        log.info('BatchAnalyzer', `${track.title}: ${bpmResult.bpm.toFixed(1)} BPM, ${keyResult.camelot}`);
      } catch (err) {
        log.warn('BatchAnalyzer', `Failed to analyze ${track.title}: ${err}`);
      }

      // Yield to keep UI responsive
      await new Promise((r) => setTimeout(r, 0));
    }

    this._running = false;
    this._cancelled = false;
    this.onComplete?.();
  }
}
