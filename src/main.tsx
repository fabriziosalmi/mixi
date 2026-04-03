/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

import { MobileScaleWrapper } from './components/mobile/MobileScaleWrapper';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileScaleWrapper>
      <App />
    </MobileScaleWrapper>
  </StrictMode>,
);
