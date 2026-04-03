# Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
#
# This file is part of MIXI.
# MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
# You may not use this file for commercial purposes without explicit permission.
# For commercial licensing, contact: fabrizio.salmi@gmail.com

import os

content = """import { useMixiStore } from '../store/mixiStore';

export type MidiMapping = {
  portId: string;
  type: 'cc' | 'note';
  channel: number;
  control: number;
  action: MidiAction;
};

export type MidiAction = 
  | { type: 'CROSSFADER' }
  | { type: 'DECK_VOL'; deck: 'A' | 'B' }
  | { type: 'DECK_EQ_HIGH'; deck: 'A' | 'B' }
  | { type: 'DECK_EQ_MID'; deck: 'A' | 'B' }
  | { type: 'DECK_EQ_LOW'; deck: 'A' | 'B' }
  | { type: 'DECK_FILTER'; deck: 'A' | 'B' }
  | { type: 'DECK_PLAY'; deck: 'A' | 'B' }
  | { type: 'DECK_CUE'; deck: 'A' | 'B' };

export class MidiManager {
  private static instance: MidiManager;
  private midiAccess: any = null;
  public isLearning = false;
  
  public mappings: MidiMapping[] = [];

  private constructor() {
    this.init();
  }

  static getInstance() {
    if (!MidiManager.instance) {
      MidiManager.instance = new MidiManager();
    }
    return MidiManager.instance;
  }

  async init() {
    if (!(navigator as any).requestMIDIAccess) {
      console.warn('[WebMIDI] API not supported');
      return;
    }
    try {
      this.midiAccess = await (navigator as any).requestMIDIAccess({ sysex: false });
      
      if (this.midiAccess) {
        this.midiAccess.inputs.forEach((input: any) => {
          this.attachListener(input);
        });

        this.midiAccess.onstatechange = (e: any) => {
          if (!e.port) return;
          console.log('[WebMIDI] State change:', e.port.name, e.port.state);
          if (e.port.type === 'input' && e.port.state === 'connected') {
            this.attachListener(e.port);
          }
        };
        console.log('[WebMIDI] Initialized successfully');
      }
    } catch (err) {
      console.error('[WebMIDI] Access denied or failed', err);
    }
  }

  private attachListener(input: any) {
    input.onmidimessage = this.onMidiMessage.bind(this);
  }

  private onMidiMessage(event: any) {
    const [status, data1, data2] = event.data;
    
    if (status >= 248) return;

    const command = status >> 4;
    const channel = status & 0xf;
    
    const isNoteOn = command === 9 && data2 > 0;
    const isCC = command === 11;

    for (const map of this.mappings) {
      if (map.channel !== channel) continue;
      
      if (isCC && map.type === 'cc' && map.control === data1) {
        this.executeCCAction(map.action, data2);
      } else if (isNoteOn && map.type === 'note' && map.control === data1) {
        this.executeNoteAction(map.action, data2);
      }
    }
  }

  private executeCCAction(action: MidiAction, value: number) {
    const store = useMixiStore.getState();
    const norm = value / 127;

    switch (action.type) {
      case 'CROSSFADER':
        store.setCrossfader(norm);
        break;
      case 'DECK_VOL':
        store.setDeckGain(action.deck, norm);
        break;
      case 'DECK_EQ_HIGH': {
        const bipolar = (norm * 2) - 1;
        store.setDeckEq(action.deck, 'high', bipolar);
        break;
      }
      case 'DECK_EQ_MID': {
        const bipolar = (norm * 2) - 1;
        store.setDeckEq(action.deck, 'mid', bipolar);
        break;
      }
      case 'DECK_EQ_LOW': {
        const bipolar = (norm * 2) - 1;
        store.setDeckEq(action.deck, 'low', bipolar);
        break;
      }
      case 'DECK_FILTER': {
        const bipolar = (norm * 2) - 1;
        store.setDeckColorFx(action.deck, bipolar);
        break;
      }
    }
  }

  private executeNoteAction(action: MidiAction, velocity: number) {
    if (velocity === 0) return;
    const store = useMixiStore.getState();
    
    switch (action.type) {
      case 'DECK_PLAY':
        store.setDeckPlaying(action.deck, !store.decks[action.deck].isPlaying);
        break;
      case 'DECK_CUE':
        store.toggleCue(action.deck);
        break;
    }
  }
}
"""

with open('src/midi/MidiManager.ts', 'w') as f:
    f.write(content)
