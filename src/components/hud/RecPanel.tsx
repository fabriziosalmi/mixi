/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Recording Panel (Top Bar)
//
// Dual-mode set recording:
//   • Electron: crash-proof WAV via SPSC ring → disk (Pillar 3)
//   • Web: MediaRecorder → WebM/Opus (fallback)
//
// Includes MARK feature for cue-list / tracklist export.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { DiskRecordingBridge } from '../../audio/recording/DiskRecordingBridge';
import { useMixiStore } from '../../store/mixiStore';
import { generateFingerprint, watermarkAudioBlob } from '../../utils/watermark';

// ── Types ────────────────────────────────────────────────────

interface CueMark {
  time: number;      // seconds since rec start
  trackA: string;
  trackB: string;
}

interface OrphanInfo {
  path: string;
  sizeBytes: number;
  estimatedDurationSecs: number;
  createdAt: string;
}

// ── Helpers ──────────────────────────────────────────────────

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// ── RecPanel component ───────────────────────────────────────

export const RecPanel: FC = () => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [marks, setMarks] = useState<CueMark[]>([]);
  const [orphans, setOrphans] = useState<OrphanInfo[]>([]);

  // Track which recording mode is active
  const diskModeRef = useRef(false);
  const diskBridgeRef = useRef<DiskRecordingBridge | null>(null);

  // MediaRecorder fallback refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Keep marks ref in sync for the onstop closure
  const marksRef = useRef(marks);
  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);

  // ── Check for disk recording availability + orphans on mount ─

  useEffect(() => {
    const bridge = DiskRecordingBridge.getInstance();
    diskBridgeRef.current = bridge;

    if (bridge.isAvailable()) {
      bridge.checkOrphans().then((found) => {
        if (found.length > 0) setOrphans(found);
      });
    }
  }, []);

  const diskAvailable = diskBridgeRef.current?.isAvailable() ?? false;

  // ── Start recording ────────────────────────────────────────

  const startRec = useCallback(async () => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const actx = engine.getAudioContext();
    const masterOutput = engine.getMasterOutput();

    // Try disk recording first (Electron only)
    if (diskAvailable && diskBridgeRef.current) {
      const ok = await diskBridgeRef.current.start(actx, masterOutput);
      if (ok) {
        diskModeRef.current = true;
        startTimeRef.current = performance.now();
        setRecording(true);
        setElapsed(0);
        setMarks([]);

        timerRef.current = setInterval(() => {
          setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000));
        }, 250);
        return;
      }
      // If disk recording failed, fall through to MediaRecorder
    }

    // Fallback: MediaRecorder (web + Electron without addon)
    diskModeRef.current = false;

    const dest = actx.createMediaStreamDestination();
    masterOutput.connect(dest);
    destRef.current = dest;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(dest.stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      try {
        masterOutput.disconnect(dest);
      } catch { /* already disconnected */ }
      destRef.current = null;

      const rawBlob = new Blob(chunksRef.current, { type: mimeType });
      const now = new Date();
      const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

      generateFingerprint().then((fp) => watermarkAudioBlob(rawBlob, fp)).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MIXI_Set_${stamp}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      });

      const currentMarks = marksRef.current;
      const finalElapsed = Math.floor((performance.now() - startTimeRef.current) / 1000);
      if (currentMarks.length > 0) {
        exportCueList(currentMarks, finalElapsed);
      }
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    startTimeRef.current = performance.now();
    setRecording(true);
    setElapsed(0);
    setMarks([]);

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000));
    }, 250);
  }, [diskAvailable]);

  // ── Stop recording ─────────────────────────────────────────

  const stopRec = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (diskModeRef.current && diskBridgeRef.current) {
      // Disk recording path: finalize → save dialog → save-as
      const result = await diskBridgeRef.current.stop();
      if (result) {
        const dest = await diskBridgeRef.current.showSaveDialog();
        if (dest) {
          await diskBridgeRef.current.saveAs(result.filePath, dest);
        }
        // else: user cancelled save dialog — temp file remains for recovery
      }

      // Export cue list
      const currentMarks = marksRef.current;
      const finalElapsed = Math.floor((performance.now() - startTimeRef.current) / 1000);
      if (currentMarks.length > 0) {
        exportCueList(currentMarks, finalElapsed);
      }
    } else {
      // MediaRecorder path
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
    }

    setRecording(false);
  }, []);

  // ── Add mark (M key or button) ─────────────────────────────

  const addMark = useCallback(() => {
    if (!recording) return;
    const time = (performance.now() - startTimeRef.current) / 1000;
    const store = useMixiStore.getState();
    setMarks((prev) => [
      ...prev,
      {
        time,
        trackA: store.decks.A.trackName,
        trackB: store.decks.B.trackName,
      },
    ]);
  }, [recording]);

  // ── M key = add mark ────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyM' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        addMark();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addMark]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  // ── Orphan recovery handlers ───────────────────────────────

  const handleRecoverOrphan = useCallback(async (orphan: OrphanInfo) => {
    const bridge = diskBridgeRef.current;
    if (!bridge) return;

    const dest = await bridge.showSaveDialog();
    if (dest) {
      await bridge.recover(orphan.path, dest);
    }
    setOrphans((prev) => prev.filter((o) => o.path !== orphan.path));
  }, []);

  const handleDiscardOrphan = useCallback(async (orphan: OrphanInfo) => {
    const bridge = diskBridgeRef.current;
    if (!bridge) return;

    await bridge.discard(orphan.path);
    setOrphans((prev) => prev.filter((o) => o.path !== orphan.path));
  }, []);

  // ── Estimated file size for disk recording ─────────────────

  const estimatedBytes = diskModeRef.current && recording
    ? elapsed * 44100 * 2 * 4 // stereo, 32-bit float, 44.1kHz
    : 0;

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-1.5">
      {/* Recovery banner for orphan recordings */}
      {orphans.length > 0 && !recording && (
        <div className="flex items-center gap-1.5 mr-2">
          {orphans.map((o) => (
            <div key={o.path} className="flex items-center gap-1 rounded px-1.5 py-0.5"
              style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <span className="text-[9px] font-mono text-amber-400/90">
                Recovered ({fmtTime(o.estimatedDurationSecs)} · {fmtSize(o.sizeBytes)})
              </span>
              <button type="button" onClick={() => handleRecoverOrphan(o)}
                className="text-[9px] font-bold text-emerald-400 hover:text-emerald-300 px-1 active:scale-95">
                Save
              </button>
              <button type="button" onClick={() => handleDiscardOrphan(o)}
                className="text-[9px] font-bold text-zinc-500 hover:text-zinc-400 px-1 active:scale-95">
                Discard
              </button>
            </div>
          ))}
        </div>
      )}

      {/* REC button */}
      <button
        type="button"
        onClick={recording ? stopRec : startRec}
        className="relative flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-all active:scale-95"
        style={{
          background: recording ? 'rgba(220,38,38,0.12)' : 'transparent',
          border: recording ? '1px solid rgba(220,38,38,0.3)' : '1px solid transparent',
        }}
        title={recording ? 'Stop Recording' : 'Start Recording'}
      >
        {/* Red dot */}
        <span
          className="block rounded-full"
          style={{
            width: 8,
            height: 8,
            background: recording ? 'var(--clr-rec)' : 'var(--txt-muted)',
            boxShadow: recording ? '0 0 8px var(--clr-rec)aa' : 'none',
            animation: recording ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }}
        />
        {/* WAV badge when disk recording is active */}
        {recording && diskModeRef.current && (
          <span className="text-[8px] font-mono font-bold tracking-wider text-emerald-400/80">
            WAV
          </span>
        )}
      </button>

      {/* Timer + file size + mark count (visible only when recording) */}
      {recording && (
        <>
          <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: 'var(--clr-rec)' }}>
            {fmtTime(elapsed)}
          </span>

          {/* File size estimate (disk recording only) */}
          {diskModeRef.current && estimatedBytes > 0 && (
            <span className="text-[9px] font-mono text-zinc-500 tabular-nums">
              {fmtSize(estimatedBytes)}
            </span>
          )}

          {/* MARK button */}
          <button
            type="button"
            onClick={addMark}
            className="rounded px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-wider transition-all active:scale-95"
            style={{
              color: 'var(--status-warn)',
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.2)',
            }}
            title="Add cue mark (M)"
          >
            MARK{marks.length > 0 && ` (${marks.length})`}
          </button>
        </>
      )}
    </div>
  );
};

// ── Cue list export ──────────────────────────────────────────

function exportCueList(marks: CueMark[], totalSecs: number) {
  let txt = `MIXI SET — Tracklist\n`;
  txt += `Total duration: ${fmtTime(totalSecs)}\n`;
  txt += `Exported: ${new Date().toISOString()}\n`;
  txt += `${'─'.repeat(50)}\n\n`;

  marks.forEach((m, i) => {
    const ts = fmtTime(m.time);
    const tracks = [m.trackA, m.trackB].filter(Boolean).join(' / ');
    txt += `[${ts}]  ${i + 1}. ${tracks || '(no track loaded)'}\n`;
  });

  const blob = new Blob([txt], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'MIXI_Tracklist.txt';
  a.click();
  URL.revokeObjectURL(url);
}
