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

/** SVG icons for each onboarding step (no emoji). */
const StepIcon: FC<{ step: number }> = ({ step }) => {
  const p = { width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', stroke: '#06b6d4', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (step) {
    case 0: return <svg {...p}><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>;
    case 1: return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="14"/><line x1="10" y1="10" x2="10" y2="14"/><line x1="14" y1="10" x2="14" y2="14"/><line x1="18" y1="10" x2="18" y2="14"/></svg>;
    case 2: return <svg {...p}><polygon points="5 3 19 12 5 21 5 3"/></svg>;
    case 3: return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="18" y2="8"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="18" y2="16"/></svg>;
    case 4: return <svg width="40" height="40" viewBox="0 0 24 24" fill="#f5c518" stroke="#f5c518" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
    default: return null;
  }
};

const STEPS = [
  {
    title: 'Welcome to MIXI',
    body: 'Drag an audio file onto a deck to load it, or click browse. Supported formats: WAV, MP3, FLAC, OGG, AAC.',
  },
  {
    title: 'Mixer',
    body: 'Each deck has a 3-band EQ with kill switches. Use the Color FX knob for filter sweeps. The crossfader blends between decks.',
  },
  {
    title: 'Performance',
    body: 'Press Space to play Deck A. Use Sync to match tempos. Set hot cues with keys 1-8. FX1/FX2 buttons activate effects.',
  },
  {
    title: 'Keyboard Shortcuts',
    body: 'Space = Play A · Shift+B = Play B · S = Sync · Q = Quantize · T = Tap Tempo · ←→ = Beat Jump · Esc = Panic Reset · Tab = Browser',
  },
  {
    title: 'Enjoy MIXI? Leave a Star',
    body: 'MIXI is free and open-source. If you like it, a star on GitHub helps other DJs discover it. It takes 2 seconds and means a lot.',
    link: 'https://github.com/fabriziosalmi/mixi',
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
        {/* Icon (SVG, no emoji) */}
        <StepIcon step={step} />

        {/* Title */}
        <h2 className="text-lg font-bold tracking-wide text-white">{s.title}</h2>

        {/* Body */}
        <p className="text-[12px] text-zinc-400 text-center leading-relaxed">{s.body}</p>

        {/* Star link on last step */}
        {'link' in s && s.link && (
          <a
            href={s.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[11px] font-bold tracking-wider transition-all active:scale-95"
            style={{ background: 'rgba(245,197,24,0.15)', color: '#f5c518', border: '1px solid rgba(245,197,24,0.3)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Star on GitHub
          </a>
        )}

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
            {step < STEPS.length - 1 ? 'NEXT' : 'START MIXING!'}
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
