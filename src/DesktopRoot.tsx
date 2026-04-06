/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// DesktopRoot — Desktop/tablet entry point (code-split chunk)
//
// Extracted from main.tsx to enable lazy loading.
// This entire module is never downloaded on mobile devices.
// ─────────────────────────────────────────────────────────────

import App from './App';
import { MobileScaleWrapper } from './components/mobile/MobileScaleWrapper';
import './styles/mobile-compact.css';

export default function DesktopRoot() {
  return (
    <MobileScaleWrapper>
      <App />
    </MobileScaleWrapper>
  );
}
