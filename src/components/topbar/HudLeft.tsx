/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Topbar HUD Left — Master Processing + AI
//
// Aligned with Deck A column via CSS subgrid.
// Contains: LimiterDot, Master knobs (Vol/Flt/Dist/Pnch),
//           MiniVu, AI toggle, Intent display.
// ─────────────────────────────────────────────────────────────

import type { FC } from 'react';
import { MasterHud } from '../hud/MasterHud';
import { AiControlPanel } from '../../ai/components/AiControlPanel';
import { IntentDisplay } from '../../ai/components/IntentDisplay';
import type { AIEngineState } from '../../ai/AutoMixEngine';

interface HudLeftProps {
  aiState: AIEngineState;
  toggleAI: () => void;
}

export const HudLeft: FC<HudLeftProps> = ({ aiState, toggleAI }) => (
  <div
    className="flex items-center gap-2 justify-self-start rounded-md px-3 py-1 overflow-hidden"
    style={{
      background: 'rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)',
    }}
  >
    <MasterHud />
    <AiControlPanel engineState={aiState} onToggleEngine={toggleAI} />
    <IntentDisplay engineState={aiState} />
  </div>
);
