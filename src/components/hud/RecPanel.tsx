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
// Zero-latency set recording via MediaRecorder connected to
// the WebAudio master output. Includes MARK feature for
// cue-list / tracklist export.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { useMixiStore } from '../../store/mixiStore';
import { generateFingerprint, watermarkAudioBlob } from '../../utils/watermark';

// ── Types ────────────────────────────────────────────────────

interface CueMark {
  time: number;      // seconds since rec start
  trackA: string;
  trackB: string;
}

// ── Timer formatting ─────────────────────────────────────────

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// ── RecPanel component ───────────────────────────────────────

export const RecPanel: FC = () => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [marks, setMarks] = useState<CueMark[]>([]);

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

  // ── Start recording ────────────────────────────────────────

  const startRec = useCallback(() => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const actx = engine.getAudioContext();
    const masterOutput = engine.getMasterOutput();

    // Create stream destination and connect master
    const dest = actx.createMediaStreamDestination();
    masterOutput.connect(dest);
    destRef.current = dest;

    // Choose best supported codec
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(dest.stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      // Disconnect
      try {
        masterOutput.disconnect(dest);
      } catch { /* already disconnected */ }
      destRef.current = null;

      // Build file + watermark + download
      const rawBlob = new Blob(chunksRef.current, { type: mimeType });
      const now = new Date();
      const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

      // Watermark: inject build fingerprint into container metadata
      generateFingerprint().then((fp) => watermarkAudioBlob(rawBlob, fp)).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MIXI_Set_${stamp}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      });

      // Export cue list if marks exist
      const currentMarks = marksRef.current;
      const finalElapsed = Math.floor((performance.now() - startTimeRef.current) / 1000);
      if (currentMarks.length > 0) {
        exportCueList(currentMarks, finalElapsed);
      }
    };

    recorder.start(1000); // 1s chunks
    recorderRef.current = recorder;
    startTimeRef.current = performance.now();
    setRecording(true);
    setElapsed(0);
    setMarks([]);

    // Timer — performance.now() is monotonic (immune to clock adjustments)
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000));
    }, 250);
  }, []);

  // ── Stop recording ─────────────────────────────────────────

  const stopRec = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
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

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-1.5">
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
        <span
          className="text-[9px] font-mono font-bold tracking-wider"
          style={{ color: recording ? 'var(--clr-rec)' : 'var(--txt-muted)' }}
        >
          REC
        </span>
      </button>

      {/* Timer + mark count (visible only when recording) */}
      {recording && (
        <>
          <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: 'var(--clr-rec)' }}>
            {fmtTime(elapsed)}
          </span>

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
