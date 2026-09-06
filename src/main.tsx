/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Entry Point with Code-Split Device Routing
//
// Device detection runs ONCE, synchronously, BEFORE React mount.
// Vite produces separate chunks for desktop and mobile — the
// unused chunk is never downloaded by the browser.
//
// Desktop/Tablet → DesktopRoot (App + MobileScaleWrapper)
// Mobile phone   → MobileApp  (dedicated touch UI)
//
// Zero runtime overhead on desktop. Zero bytes of mobile code
// in the desktop bundle.
// ─────────────────────────────────────────────────────────────

import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// ── Device detection: synchronous, pre-mount, one-time ──────
// Uses the short side of the viewport (invariant to orientation)
// combined with touch capability. A phone in landscape (852×393)
// has minDim=393 → mobile. An iPad Mini (744×1133) has minDim=744
// → desktop/tablet path (handled by MobileScaleWrapper scaling).
const minDim = Math.min(window.innerWidth, window.innerHeight);
const isMobile = minDim < 500 && navigator.maxTouchPoints > 0;

// ── Code-split: separate Vite chunks ────────────────────────
const Root = isMobile
  ? lazy(() => import('./MobileApp'))
  : lazy(() => import('./DesktopRoot'));

// ── Cross-origin isolation check ────────────────────────────
// The Rust/Wasm audio engine needs SharedArrayBuffer, which the browser only
// exposes to a cross-origin isolated document. That requires the host to send
// COOP and COEP. vite dev/preview and the Electron app set them; a static
// deployment depends on whoever serves it, and GitHub Pages cannot send custom
// headers at all.
//
// Nothing throws when they are missing: the engine falls back to the Web Audio
// path and the only symptom is that it sounds different. Say so once, rather
// than leaving it to be discovered by ear.
if (!window.crossOriginIsolated) {
  console.warn(
    '[mixi] Not cross-origin isolated: SharedArrayBuffer is unavailable, so the '
    + 'Rust/Wasm audio engine cannot start and the Web Audio fallback is in use. '
    + 'The host must send Cross-Origin-Opener-Policy: same-origin and '
    + 'Cross-Origin-Embedder-Policy: require-corp. See public/_headers.'
  );
}

// ── PWA service worker registration (mobile only) ──────────
if ('serviceWorker' in navigator && isMobile) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Expose stores for E2E tests (dev/test, or a packaged app launched with
//    MIXI_E2E=1 → preload sets window.mixi.e2e). Default OFF in normal DMGs. ──
if (
  import.meta.env.DEV ||
  import.meta.env.MODE === 'test' ||
  (window as unknown as { mixi?: { e2e?: boolean } }).mixi?.e2e
) {
  import('./store/mixiStore').then(m => {
    (window as any).__MIXI_STORE__ = m.useMixiStore;
  });
  import('./store/settingsStore').then(m => {
    (window as any).__SETTINGS_STORE__ = m.useSettingsStore;
  });
  import('./audio/MixiEngine').then(m => {
    // Expose as a getter so it always returns the current singleton
    Object.defineProperty(window, '__MIXI_ENGINE__', {
      get: () => m.MixiEngine.getInstance(),
      configurable: true,
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense
        fallback={
          <div
            style={{
              width: '100vw',
              height: '100vh',
              background: '#000',
            }}
          />
        }
      >
        <Root />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
