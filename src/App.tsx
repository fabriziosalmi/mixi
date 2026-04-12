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

import { useState, useCallback, useEffect, useRef, type FC } from 'react';
import { useMixiSync } from './hooks/useMixiSync';
import { useMixiBridge } from './hooks/useMixiBridge';
import { useMixiStore } from './store/mixiStore';
import { MixiEngine } from './audio/MixiEngine';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAIEngine } from './ai/useAIEngine';
import { AiDebugPanel } from './ai/components/AiDebugPanel';
import { DeckSection } from './components/deck/DeckSection';
import { deckRegistry } from './decks/registry';
import { Suspense } from 'react';
import { MixerSection } from './components/mixer/MixerSection';
import { SettingsModal } from './components/settings/SettingsModal';
import { useSettingsStore } from './store/settingsStore';
import { injectAllCustomSkins } from './utils/skinLoader';
import { HudLeft } from './components/topbar/HudLeft';
import { HudCenter } from './components/topbar/HudCenter';
import { HudRight } from './components/topbar/HudRight';
import { HudStatusBar } from './components/topbar/HudStatusBar';
import { TrackBrowser } from './components/browser/TrackBrowser';
import { useBrowserStore } from './store/browserStore';
import { SplashScreen } from './components/SplashScreen';
import { Onboarding } from './components/Onboarding';
import { VfxCanvas } from './components/VfxCanvas';
import { MidiManager } from './midi/MidiManager';
import { generateFingerprint, createUiWatermarkCanvas, buildZwcWatermark } from './utils/watermark';
import { log } from './utils/logger';
import type { DeckId } from './types';

import { COLOR_DECK_A, COLOR_DECK_B } from './theme';
const CYAN = COLOR_DECK_A;
const ORANGE = COLOR_DECK_B;

// ── Mini Master VU for center HUD (thin horizontal bars) ────

// ── Deck slot: renders track deck or groovebox per slot mode ─

const DeckSlot: FC<{ deckId: DeckId; color: string }> = ({ deckId, color }) => {
  const mode = useMixiStore((s) => s.deckModes[deckId]);
  const setDeckMode = useMixiStore((s) => s.setDeckMode);

  // Check house decks registry first
  const houseDeck = deckRegistry.findByMode(mode);
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
  useMixiBridge();
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
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // Fetch external deck plugins from mixi-decks registry
  useEffect(() => {
    deckRegistry.fetchFromRemote().catch(() => {});
  }, []);

  // Listen for update-available notification from main process
  useEffect(() => {
    const mixi = (window as unknown as { mixi?: { onUpdateAvailable?: (cb: (v: string) => void) => void } }).mixi;
    mixi?.onUpdateAvailable?.(() => setUpdateAvailable(true));
  }, []);

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

  // ── UI Watermark (Tier 2) — ZWC steganography in DOM ──────
  // Invisible zero-width characters embedded in a hidden element.
  // Survives copy-paste of HTML — identifies build version + date.
  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    el.textContent = buildZwcWatermark();
    document.body.appendChild(el);
    return () => { el.remove(); };
  }, []);

  // ── Panic reset (requires double-press within 500ms) ────
  const panicPendingRef = useRef(false);
  const panicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePanic = useCallback(() => {
    if (!panicPendingRef.current) {
      // First press — arm with subtle flash, wait for second
      panicPendingRef.current = true;
      setPanicFlash(true);
      setTimeout(() => setPanicFlash(false), 100); // dim flash = "armed"
      panicTimerRef.current = setTimeout(() => { panicPendingRef.current = false; }, 500);
      return; // don't fire yet
    }
    // Second press within 500ms — fire panic
    panicPendingRef.current = false;
    if (panicTimerRef.current) clearTimeout(panicTimerRef.current);
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
    <div
      className={`h-screen w-screen text-white overflow-hidden mixi-chassis mixi-skin-${skin} ${vfxActive ? 'mixi-vfx' : ''}`}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gridTemplateRows: 'auto auto 1fr' }}
    >
      {/* VFX visual overlay — audio-reactive canvas */}
      <VfxCanvas active={vfxActive} />
      {/* Top bar — subgrid shares column tracks with main */}
      <header
        className="grid items-center border-b border-zinc-800/40 px-4 h-12 mixi-topbar gap-4 transition-colors duration-200 overflow-hidden"
        style={{
          gridColumn: '1 / -1',
          gridTemplateColumns: 'subgrid',
          background: 'rgba(0,0,0,0.6)',
          ...(panicFlash ? {
            backgroundColor: panicPendingRef.current ? 'rgba(220,38,38,0.06)' : 'rgba(220,38,38,0.25)',
            borderColor: panicPendingRef.current ? 'rgba(220,38,38,0.15)' : 'rgba(220,38,38,0.5)',
          } : {}),
        }}
      >
        {/* ── Left: Master FX + AI + Intent ── */}
        <HudLeft aiState={aiState} toggleAI={toggleAI} />

        {/* ── Center: Master HUD screen (sized by mixer column via subgrid) ── */}
        <HudCenter />

        {/* ── Right: REC group + action buttons ── */}
        <HudRight
          toggleBrowser={toggleBrowser} browserOpen={browserOpen}
          vfxActive={vfxActive} setVfxActive={setVfxActive}
          handlePanic={handlePanic} toggleSettings={toggleSettings}
          updateAvailable={updateAvailable}
        />
      </header>

      {/* Status ticker — real-time feedback, alerts, parameter values */}
      <HudStatusBar />

      <main
        className="grid grid-rows-[1fr] gap-4 p-4 overflow-hidden relative"
        style={{ gridColumn: '1 / -1', gridTemplateColumns: 'subgrid' }}
      >
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
      <Onboarding />
      <SettingsModal />
      <AiDebugPanel engineState={aiState} />
    </div>
  );
};

export default App;
