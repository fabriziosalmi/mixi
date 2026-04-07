/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Topbar HUD Center — Master Clock only (clean)
//
// Q, M, CPU, OUT moved to HudLeft/HudRight/StatusBar.
// Center now shows: DeckA info | MasterClock | DeckB info
// ─────────────────────────────────────────────────────────────

import type { FC } from 'react';
import { MasterClock } from '../hud/MasterClock';
import { HudDeckInfo } from './HudDeckInfo';

export const HudCenter: FC = () => (
  <div className="flex items-center gap-1.5 justify-self-stretch h-full">
    {/* Deck A telemetry */}
    <HudDeckInfo deckId="A" />

    {/* Master BPM display */}
    <div
      className="mixi-master-hud flex items-center justify-center flex-1 rounded-md px-3 py-1 overflow-hidden h-full"
      style={{
        background: 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
        minWidth: 0,
      }}
    >
      <MasterClock />
    </div>

    {/* Deck B telemetry */}
    <HudDeckInfo deckId="B" />
  </div>
);
