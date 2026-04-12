/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// MobileApp — Mobile entry point (code-split chunk)
//
// This entire module is never downloaded on desktop/tablet.
// Vite produces a separate chunk via lazy(() => import('./MobileApp')).
//
// Switches between landscape (mixing) and portrait (monitor)
// layouts based on viewport orientation. State is 100% preserved
// across orientation changes — zero audio interruption.
//
// Features:
//   - AudioContext init gate (iOS Safari requires user gesture)
//   - useMixiSync bridge (store↔engine forwarding)
//   - Shake-to-panic: shaking the phone resets all EQ/FX/loops
//   - Overscroll prevention
//   - Safe area inset handling
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useOrientation, type Orientation } from './hooks/useOrientation';
import { useHaptics } from './hooks/useHaptics';
import { useMixiSync } from './hooks/useMixiSync';
import { MobileLandscape } from './components/mobile/MobileLandscape';
import { MobilePortrait } from './components/mobile/MobilePortrait';
import { MobileInitGate } from './components/mobile/MobileInitGate';
import { mobilePanic } from './components/mobile/mobilePanic';
import { deckRegistry } from './decks/registry';
import { buildZwcWatermark } from './utils/watermark';

// ── Shake detection constants ────────────────────────────────

const SHAKE_THRESHOLD = 25;       // m/s² — high to avoid false positives
const SHAKE_CONSECUTIVE = 3;      // samples above threshold to trigger
const SHAKE_DEBOUNCE_MS = 2000;   // min time between panic triggers

export default function MobileApp() {
  const liveOrientation = useOrientation();
  const haptics = useHaptics();
  const { initEngine } = useMixiSync();
  const [lockedOrientation, setLockedOrientation] = useState<Orientation | null>(null);

  // Expose lock toggle for child components via a global
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__mixiLockOrientation = (lock: Orientation | null) => {
      setLockedOrientation(lock);
    };
    return () => { delete (window as unknown as Record<string, unknown>).__mixiLockOrientation; };
  }, []);

  const orientation = lockedOrientation ?? liveOrientation;

  // Fetch external deck plugins from mixi-decks registry
  useEffect(() => {
    deckRegistry.fetchFromRemote().catch(() => {});
  }, []);

  // ZWC steganography watermark (Tier 2) — survives copy-paste
  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    el.textContent = buildZwcWatermark();
    document.body.appendChild(el);
    return () => { el.remove(); };
  }, []);

  // Prevent pull-to-refresh and overscroll on mobile
  useEffect(() => {
    document.body.style.overscrollBehavior = 'none';
    document.body.style.touchAction = 'manipulation';
  }, []);

  // ── Shake-to-panic ──
  const shakeCountRef = useRef(0);
  const lastPanicRef = useRef(0);

  useEffect(() => {
    const handler = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;

      const total = Math.sqrt(
        (acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2,
      );

      if (total > SHAKE_THRESHOLD) {
        shakeCountRef.current++;
        if (shakeCountRef.current >= SHAKE_CONSECUTIVE) {
          const now = Date.now();
          if (now - lastPanicRef.current > SHAKE_DEBOUNCE_MS) {
            lastPanicRef.current = now;
            mobilePanic();
            haptics.panic();
          }
          shakeCountRef.current = 0;
        }
      } else {
        shakeCountRef.current = 0;
      }
    };

    window.addEventListener('devicemotion', handler);
    return () => window.removeEventListener('devicemotion', handler);
  }, [haptics]);

  const layout = orientation === 'landscape'
    ? <MobileLandscape />
    : <MobilePortrait />;

  return (
    <MobileInitGate onInit={initEngine}>
      {layout}
    </MobileInitGate>
  );
}
