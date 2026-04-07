/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// First-Run Onboarding — 4-step guided overlay
//
// Shows on first launch (checked via localStorage).
// Steps:
//   1. Welcome — "Drop a track to start"
//   2. Mixer — "EQ, crossfader, effects"
//   3. Transport — "Play, sync, hot cues"
//   4. Shortcuts — quick reference card
//
// Dismissible at any step. Never shows again after completion.
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, type FC } from 'react';

const STORAGE_KEY = 'mixi-onboarding-done';

const STEPS = [
  {
    title: 'Welcome to MIXI',
    body: 'Drag an audio file onto a deck to load it, or click browse. Supported formats: WAV, MP3, FLAC, OGG, AAC.',
    icon: '🎧',
  },
  {
    title: 'Mixer',
    body: 'Each deck has a 3-band EQ with kill switches. Use the Color FX knob for filter sweeps. The crossfader blends between decks.',
    icon: '🎛️',
  },
  {
    title: 'Performance',
    body: 'Press Space to play Deck A. Use Sync to match tempos. Set hot cues with keys 1-8. FX1/FX2 buttons activate effects.',
    icon: '▶️',
  },
  {
    title: 'Keyboard Shortcuts',
    body: 'Space = Play A · Shift+B = Play B · S = Sync · Q = Quantize · T = Tap Tempo · ←→ = Beat Jump · Esc = Panic Reset · Tab = Browser',
    icon: '⌨️',
  },
];

export const Onboarding: FC = () => {
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEY); }
    catch { return true; }
  });
  const [step, setStep] = useState(0);

  const dismiss = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* noop */ }
  }, []);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  }, [step, dismiss]);

  const prev = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  if (!visible) return null;

  const s = STEPS[step];

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={dismiss}
    >
      <div
        className="flex flex-col items-center gap-4 rounded-xl px-8 py-6 max-w-sm"
        style={{
          background: 'rgba(10,10,15,0.95)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <span className="text-4xl">{s.icon}</span>

        {/* Title */}
        <h2 className="text-lg font-bold tracking-wide text-white">{s.title}</h2>

        {/* Body */}
        <p className="text-[12px] text-zinc-400 text-center leading-relaxed">{s.body}</p>

        {/* Step dots */}
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: 6, height: 6,
                background: i === step ? '#06b6d4' : 'rgba(255,255,255,0.15)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex gap-3 w-full">
          {step > 0 && (
            <button
              type="button"
              onClick={prev}
              className="flex-1 rounded-lg py-2 text-[11px] font-bold tracking-wider text-zinc-400 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              BACK
            </button>
          )}
          <button
            type="button"
            onClick={next}
            className="flex-1 rounded-lg py-2 text-[11px] font-bold tracking-wider text-black transition-all active:scale-95"
            style={{ background: '#06b6d4' }}
          >
            {step < STEPS.length - 1 ? 'NEXT' : 'START MIXING'}
          </button>
        </div>

        {/* Skip */}
        <button
          type="button"
          onClick={dismiss}
          className="text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Skip tutorial
        </button>
      </div>
    </div>
  );
};
