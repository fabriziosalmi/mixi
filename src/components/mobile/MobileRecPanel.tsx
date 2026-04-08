/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileRecPanel — Compact mobile recording controls
//
// MediaRecorder-only (no Electron disk bridge on mobile).
// Captures master output → WebM/Opus → download on stop.
// Features: start/stop, elapsed timer, MARK button.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import { MixiEngine } from '../../audio/MixiEngine';
import { useHaptics } from '../../hooks/useHaptics';

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export const MobileRecPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [markCount, setMarkCount] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const haptics = useHaptics();

  const startRec = useCallback(async () => {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const actx = engine.getAudioContext();
    const masterOutput = engine.getMasterOutput();

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
      try { masterOutput.disconnect(dest); } catch {}
      destRef.current = null;

      const blob = new Blob(chunksRef.current, { type: mimeType });
      const now = new Date();
      const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MIXI_Set_${stamp}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    startTimeRef.current = performance.now();
    setRecording(true);
    setElapsed(0);
    setMarkCount(0);
    haptics.confirm();

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000));
    }, 250);
  }, [haptics]);

  const stopRec = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setRecording(false);
    haptics.confirm();
  }, [haptics]);

  const addMark = useCallback(() => {
    setMarkCount((c) => c + 1);
    haptics.snap();
  }, [haptics]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 16 }}>
      {/* Timer */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 32,
          fontWeight: 900,
          color: recording ? '#ef4444' : '#555',
          letterSpacing: 4,
        }}
      >
        {fmtElapsed(elapsed)}
      </div>

      {/* Recording indicator */}
      {recording && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%', background: '#ef4444',
            animation: 'mobileRecPulse 1s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 10, color: '#ef4444', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            REC
          </span>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12 }}>
        {!recording ? (
          <button
            onClick={startRec}
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              border: '3px solid #ef4444',
              background: '#ef444422',
              color: '#ef4444',
              fontSize: 10,
              fontWeight: 900,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            REC
          </button>
        ) : (
          <>
            <button
              onClick={stopRec}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                border: '3px solid #ef4444',
                background: '#ef444433',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Stop square */}
              <div style={{ width: 20, height: 20, borderRadius: 3, background: '#ef4444' }} />
            </button>
            <button
              onClick={addMark}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                border: '2px solid #f59e0b',
                background: '#f59e0b11',
                color: '#f59e0b',
                fontSize: 10,
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              MARK
              {markCount > 0 && (
                <div style={{ fontSize: 8, marginTop: 2, opacity: 0.7 }}>×{markCount}</div>
              )}
            </button>
          </>
        )}
      </div>

      {/* Close */}
      {!recording && (
        <button
          onClick={onClose}
          style={{ fontSize: 10, color: '#555', background: 'none', border: 'none', cursor: 'pointer', touchAction: 'manipulation' }}
        >
          Close
        </button>
      )}

      <style>{`
        @keyframes mobileRecPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};
