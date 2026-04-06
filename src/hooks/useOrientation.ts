/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// useOrientation — Tracks viewport orientation
//
// Returns 'landscape' | 'portrait' based on viewport dimensions.
// Updates on resize. Used by MobileApp to switch layout.
// ─────────────────────────────────────────────────────────────

export type Orientation = 'landscape' | 'portrait';

export function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(
    () => window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
  );

  useEffect(() => {
    const update = () => {
      setOrientation(
        window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
      );
    };

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return orientation;
}
