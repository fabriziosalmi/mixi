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

// ── PWA service worker registration (mobile only) ──────────
if ('serviceWorker' in navigator && isMobile) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
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
