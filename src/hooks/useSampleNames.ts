/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import { useState, useEffect } from 'react';
import { SampleManager } from '../audio/SampleManager';

export function useSampleNames() {
  const [names, setNames] = useState<Record<string, string>>({});
  
  useEffect(() => {
    const sm = SampleManager.getInstance();
    const update = () => {
      setNames({
        kick: sm.getSampleName('kick') || '',
        snare: sm.getSampleName('snare') || '',
        hat: sm.getSampleName('hat') || '',
        perc: sm.getSampleName('perc') || '',
      });
    };
    
    update();
    return sm.subscribe(update);
  }, []);
  
  return names;
}
