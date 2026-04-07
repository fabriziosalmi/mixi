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
  <div className="mixi-hud-group justify-self-start">
    <MasterHud />
    <AiControlPanel engineState={aiState} onToggleEngine={toggleAI} />
    <IntentDisplay engineState={aiState} />
  </div>
);
