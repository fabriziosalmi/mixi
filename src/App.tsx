/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Main Application Shell
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, type FC } from 'react';
import { useMixiSync } from './hooks/useMixiSync';
import { useMixiBridge } from './hooks/useMixiBridge';
import { useMixiStore } from './store/mixiStore';
import { MixiEngine } from './audio/MixiEngine';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAIEngine } from './ai/useAIEngine';
import { AiControlPanel } from './ai/components/AiControlPanel';
import { IntentDisplay } from './ai/components/IntentDisplay';
import { AiDebugPanel } from './ai/components/AiDebugPanel';
import { DeckSection } from './components/deck/DeckSection';
import { HOUSE_DECKS } from './decks';
import { Suspense } from 'react';
import { MixerSection } from './components/mixer/MixerSection';
import { SettingsModal } from './components/settings/SettingsModal';
import { useSettingsStore } from './store/settingsStore';
import { SkinSelector } from './components/hud/SkinSelector';
import { injectAllCustomSkins } from './utils/skinLoader';
import { SystemHud } from './components/hud/SystemHud';
import { MasterHud } from './components/hud/MasterHud';
import { RecPanel } from './components/hud/RecPanel';
import { MasterClock } from './components/hud/MasterClock';
import { TrackBrowser } from './components/browser/TrackBrowser';
import { useBrowserStore } from './store/browserStore';
import { SplashScreen } from './components/SplashScreen';
import { VfxCanvas } from './components/VfxCanvas';
import { MidiManager } from './midi/MidiManager';
import { generateFingerprint, createUiWatermarkCanvas } from './utils/watermark';
import { log } from './utils/logger';
import type { DeckId } from './types';

import { COLOR_DECK_A, COLOR_DECK_B } from './theme';
const CYAN = COLOR_DECK_A;
const ORANGE = COLOR_DECK_B;

// ── Global Quantize toggle (topbar center group) ────────────

const QuantizeToggle: FC = () => {
  const qA = useMixiStore((s) => s.decks.A.quantize);
  const qB = useMixiStore((s) => s.decks.B.quantize);
  const setQuantize = useMixiStore((s) => s.setQuantize);
  const active = qA && qB;
  const partial = qA || qB;

  const toggle = useCallback(() => {
    const next = !active;
    setQuantize('A', next);
    setQuantize('B', next);
  }, [active, setQuantize]);

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-[10px] font-mono font-black rounded px-1.5 py-0.5 transition-all active:scale-95"
      style={{
        color: active ? '#000' : partial ? 'var(--status-warn)' : 'var(--txt-muted)',
        backgroundColor: active ? 'var(--status-ok)' : partial ? 'rgba(245,158,11,0.15)' : 'transparent',
        border: `1px solid ${active ? 'var(--status-ok)' : partial ? 'var(--status-warn)' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? '0 0 8px var(--status-ok)66' : 'none',
      }}
      title={`Quantize: ${active ? 'ON (all decks)' : partial ? 'Partial' : 'OFF'}`}
    >
      Q
    </button>
  );
};

// ── Deck slot: renders track deck or groovebox per slot mode ─

const DeckSlot: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const mode = useMixiStore((s) => s.deckModes[deckId]);
  const setDeckMode = useMixiStore((s) => s.setDeckMode);

  // Check house decks registry first
  const houseDeck = HOUSE_DECKS.find((d) => d.mode === mode);
  if (houseDeck) {
    const Comp = houseDeck.component;
    return (
      <Suspense fallback={<div className="flex-1" />}>
        <Comp
          deckId={deckId}
          color={color}
          onSwitchToTrack={() => setDeckMode(deckId, 'track')}
        />
      </Suspense>
    );
  }
  return <DeckSection deckId={deckId} color={color} />;
};

const App: FC = () => {
  const { initEngine } = useMixiSync();
  const { connected: mcpConnected } = useMixiBridge();
  const { state: aiState, toggle: toggleAI } = useAIEngine();
  useKeyboardShortcuts();
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const skin = useSettingsStore((s) => s.skin);
  const customSkins = useSettingsStore((s) => s.customSkins);
  const toggleBrowser = useBrowserStore((s) => s.toggle);
  const browserOpen = useBrowserStore((s) => s.open);
  const [audioStarted, setAudioStarted] = useState(false);
  const [vfxActive, setVfxActive] = useState(false);
  const [panicFlash, setPanicFlash] = useState(false);

  const handleStart = useCallback(async () => {
    try {
      await initEngine();
    } catch (err) {
      console.error('[mixi] Audio init failed:', err);
      // Still proceed — some features may work without audio
    }
    setAudioStarted(true);

    // Init Web MIDI
    try { MidiManager.getInstance(); } catch { /* MIDI optional */ }

    const settings = useSettingsStore.getState();
    const engine = MixiEngine.getInstance();
    
    if (settings.loadDemoTrack) {
      try {
        // Deck A
        const resA = await fetch(new URL('../assets/v0.1.0.mp3', import.meta.url).href);
        const bufA = await resA.arrayBuffer();
        await engine.loadTrack('A', bufA);
        useMixiStore.getState().setDeckTrackName('A', 'MIXI v0.1.0');
        useMixiStore.getState().setDeckTrackLoaded('A', true);

        // Deck B
        const resB = await fetch(new URL('../assets/v0.1.1.mp3', import.meta.url).href);
        const bufB = await resB.arrayBuffer();
        await engine.loadTrack('B', bufB);
        useMixiStore.getState().setDeckTrackName('B', 'MIXI v0.1.1');
        useMixiStore.getState().setDeckTrackLoaded('B', true);
      } catch (e) {
        log.warn('App', `Demo track load failed: ${e}`);
      }
    }
  }, [initEngine]);

  // ── Block browser default file-open on drag/drop ────────
  useEffect(() => {
    const prevent = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  // ── UI Watermark (Tier 1) — invisible canvas fingerprint ──
  useEffect(() => {
    let canvas: HTMLCanvasElement | null = null;
    generateFingerprint().then((fp) => {
      canvas = createUiWatermarkCanvas(fp);
      document.body.appendChild(canvas);
    });
    return () => { canvas?.remove(); };
  }, []);

  // ── Panic reset (Escape key or button) ──────────────────
  const handlePanic = useCallback(() => {
    const store = useMixiStore.getState();
    const engine = MixiEngine.getInstance();

    // Reset EQ flat + gain + color FX for both decks
    for (const d of ['A', 'B'] as const) {
      store.setDeckEq(d, 'high', 0);
      store.setDeckEq(d, 'mid', 0);
      store.setDeckEq(d, 'low', 0);
      store.setDeckGain(d, 0);
      store.setDeckColorFx(d, 0);
      // Exit loops
      if (store.decks[d].activeLoop) store.exitLoop(d);
    }

    // Reset per-deck FX
    if (engine.isInitialized) {
      for (const d of ['A', 'B'] as const) {
        for (const fx of ['flt', 'dly', 'rev', 'pha', 'flg', 'gate', 'crush', 'echo', 'tape', 'noise'] as const) {
          engine.setDeckFx(d, fx, 0, false);
        }
      }
    }

    // Reset master FX via store (sync hook forwards to engine)
    store.setMasterFilter(0);
    store.setMasterDistortion(0);
    store.setMasterPunch(0);

    // Reset crossfader to center
    store.setCrossfader(0.5);

    // VFX off
    setVfxActive(false);

    // Visual flash feedback
    setPanicFlash(true);
    setTimeout(() => setPanicFlash(false), 200);
  }, []);

  // Escape key binding
  useEffect(() => {
    // Re-inject persisted custom skin CSS on mount or when skins change
    if (customSkins.length > 0) injectAllCustomSkins(customSkins);
  }, [customSkins]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handlePanic(); }
      if (e.key === 'Tab') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          toggleBrowser();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePanic, toggleBrowser]);

  if (!audioStarted) {
    return <SplashScreen onStart={handleStart} />;
  }

  return (
    <div className={`flex h-screen w-screen flex-col text-white overflow-hidden mixi-chassis mixi-skin-${skin} ${vfxActive ? 'mixi-vfx' : ''}`}>
      {/* VFX visual overlay — audio-reactive canvas */}
      <VfxCanvas active={vfxActive} />
      {/* Top bar */}
      <header
        className="grid items-center border-b border-zinc-800/40 px-4 py-1.5 mixi-topbar gap-4 transition-colors duration-200"
        style={{
          gridTemplateColumns: '1fr auto 1fr',
          ...(panicFlash ? { backgroundColor: 'rgba(220,38,38,0.15)', borderColor: 'rgba(220,38,38,0.4)' } : {}),
        }}
      >
        {/* ── Left: Master FX + Skin + AI + Intent ── */}
        <div className="mixi-hud-group justify-self-start">
          <MasterHud />
          <div className="h-4 border-r border-zinc-700/40" />
          <SkinSelector />
          <div className="h-4 border-r border-zinc-700/40" />
          <AiControlPanel engineState={aiState} onToggleEngine={toggleAI} />
          <div className="h-4 border-r border-zinc-700/40" />
          <IntentDisplay engineState={aiState} />
        </div>

        {/* ── Center: Quantize + Master Clock + REC (aligned above mixer) ── */}
        <div className="mixi-hud-group justify-self-center">
          <QuantizeToggle />
          <div className="h-4 border-r border-zinc-700/40" />
          <MasterClock />
          <div className="h-4 border-r border-zinc-700/40" />
          <RecPanel />
        </div>

        {/* ── Right: Telemetry + Browser + VFX + Panic + Settings ── */}
        <div className="mixi-hud-group justify-self-end">
          <SystemHud mcpConnected={mcpConnected} />
          <div className="h-4 border-r border-zinc-700/40" />
          {/* Track Browser toggle */}
          <button
            type="button"
            onClick={toggleBrowser}
            className="rounded p-0.5 transition-all duration-150"
            title="Track Browser (Tab)"
            style={{
              color: browserOpen ? 'var(--clr-master)' : 'var(--txt-muted)',
              filter: browserOpen ? 'drop-shadow(0 0 4px var(--clr-master)88)' : 'none',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>

          <div className="h-4 border-r border-zinc-700/40" />

          {/* VFX toggle — Space Invader */}
          <button
            type="button"
            onClick={() => setVfxActive((v) => !v)}
            className={`rounded p-0.5 transition-all duration-300 ${vfxActive ? 'mixi-vfx-btn' : ''}`}
            title={vfxActive ? 'VFX: ON' : 'VFX: OFF'}
            style={{
              color: vfxActive ? 'var(--txt-white)' : 'var(--txt-muted)',
              filter: vfxActive ? 'drop-shadow(0 0 6px #ff00ff88)' : 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="1" width="2" height="2" />
              <rect x="11" y="1" width="2" height="2" />
              <rect x="5" y="3" width="2" height="2" />
              <rect x="9" y="3" width="2" height="2" />
              <rect x="3" y="5" width="10" height="2" />
              <rect x="1" y="7" width="2" height="2" />
              <rect x="3" y="7" width="2" height="2" />
              <rect x="5" y="7" width="6" height="2" />
              <rect x="11" y="7" width="2" height="2" />
              <rect x="13" y="7" width="2" height="2" />
              <rect x="1" y="9" width="2" height="2" />
              <rect x="5" y="9" width="2" height="2" />
              <rect x="9" y="9" width="2" height="2" />
              <rect x="13" y="9" width="2" height="2" />
              <rect x="3" y="11" width="2" height="2" />
              <rect x="5" y="11" width="2" height="2" />
              <rect x="9" y="11" width="2" height="2" />
              <rect x="11" y="11" width="2" height="2" />
            </svg>
          </button>

          {/* Panic button — reset all FX/EQ/loops */}
          <button
            type="button"
            onClick={handlePanic}
            className="rounded p-0.5 text-zinc-600 hover:text-red-400 transition-colors duration-150 active:scale-90"
            title="Panic Reset (Esc) — flatten EQ, kill FX, exit loops"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </button>

          <div className="h-4 border-r border-zinc-700/40" />

          {/* Settings gear */}
          <button
            type="button"
            onClick={toggleSettings}
            className="mixi-gear rounded p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-[1fr_auto_1fr] grid-rows-[1fr] gap-4 p-4 overflow-hidden relative">
        <DeckSlot deckId="A" color={CYAN} />
        <MixerSection />
        <DeckSlot deckId="B" color={ORANGE} />

        {/* Track Browser — slides up from bottom */}
        <TrackBrowser />
      </main>

      {/* Glass vignette — subtle edge darkening for physical cohesion */}
      <div
        className="fixed inset-0 pointer-events-none z-[9995]"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.05) 100%)',
        }}
      />

      {/* Limiter clip flash — thin red border */}
      <div
        id="mixi-clip-flash"
        className="fixed inset-0 pointer-events-none z-[9996]"
        style={{
          opacity: 0,
          border: '2px solid var(--clr-clip-border)',
          borderImage: 'linear-gradient(135deg, var(--clr-clip-border), var(--clr-clip-grad), var(--clr-clip-border)) 1',
          transition: 'opacity 0.04s ease-out',
        }}
      />

      {/* Modals / overlays */}
      <SettingsModal />
      <AiDebugPanel engineState={aiState} />
    </div>
  );
};

export default App;
