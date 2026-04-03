/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import { useMixiStore } from '../store/mixiStore';
import { useMidiStore } from '../store/midiStore';
import { useSettingsStore, EQ_RANGE_PRESETS } from '../store/settingsStore';
import type { VoiceId } from '../groovebox/types';

export type MidiMapping = {
  portId: string;
  type: 'cc' | 'note';
  channel: number;
  control: number;
  action: MidiAction;
};

export type MidiAction = 
  | { type: 'CROSSFADER' }
  | { type: 'DECK_GAIN'; deck: 'A' | 'B' }
  | { type: 'DECK_VOL'; deck: 'A' | 'B' }
  | { type: 'DECK_EQ_HIGH'; deck: 'A' | 'B' }
  | { type: 'DECK_EQ_MID'; deck: 'A' | 'B' }
  | { type: 'DECK_EQ_LOW'; deck: 'A' | 'B' }
  | { type: 'DECK_FILTER'; deck: 'A' | 'B' }
  | { type: 'DECK_PLAY'; deck: 'A' | 'B' }
  | { type: 'DECK_SYNC'; deck: 'A' | 'B' }
  | { type: 'DECK_CUE'; deck: 'A' | 'B' }
  | { type: 'DECK_PITCH'; deck: 'A' | 'B' }
  | { type: 'GROOVEBOX_PAD'; deck: 'A' | 'B', voice: VoiceId };

export class MidiManager {
  private static instance: MidiManager;
  private midiAccess: MIDIAccess | null = null;
  public static onStatusChange: ((connected: boolean) => void) | null = null;

  private constructor() {
    this.init();
  }

  static getInstance() {
    if (!MidiManager.instance) {
      MidiManager.instance = new MidiManager();
    }
    return MidiManager.instance;
  }

  public get isConnected(): boolean {
    return !!this.midiAccess && this.midiAccess.inputs.size > 0;
  }

  private notifyStatus() {
    if (MidiManager.onStatusChange) {
      MidiManager.onStatusChange(this.isConnected);
    }
  }

  async init() {
    // Bind the global interceptor for UI components to use
    (window as any).__MIXIMIDILEARN__ = (action: MidiAction) => {
      console.log('[WebMIDI] UI component clicked for learn:', action);
      useMidiStore.getState().setLearningAction(action);
    };

    if (!navigator.requestMIDIAccess) {
      console.warn('[WebMIDI] API not supported');
      return;
    }
    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      
      if (this.midiAccess) {
        this.midiAccess.inputs.forEach((input: MIDIInput) => {
          this.attachListener(input);
        });
        
        this.notifyStatus();

        this.midiAccess.onstatechange = (e: MIDIConnectionEvent) => {
          const port = e?.port;
          if (!port) return;
          console.log('[WebMIDI] State change:', port.name, port.state);
          if (port.type === 'input' && port.state === 'connected') {
            this.attachListener(port as MIDIInput);
          }
          this.notifyStatus();
        };
        console.log('[WebMIDI] Initialized successfully');
      }
    } catch (err) {
      console.error('[WebMIDI] Access denied or failed', err);
    }
  }

  private attachListener(input: MIDIInput) {
    input.onmidimessage = this.onMidiMessage.bind(this);
  }

  private onMidiMessage(event: MIDIMessageEvent) {
    if (!event.data) return;
    const [status, data1, data2] = event.data;
    
    if (status >= 248) return;

    const command = status >> 4;
    const channel = status & 0xf;
    const isNoteOn = command === 9 && data2 > 0;
    const isCC = command === 11;

    const midiStore = useMidiStore.getState();

    // 1. Midi Learn Interpretation
    if (midiStore.isLearning && midiStore.learningAction) {
      const targetId = (event.target as MIDIInput)?.id || 'unknown';
      if (isNoteOn) {
        midiStore.addMapping({
          portId: targetId,
          type: 'note',
          channel,
          control: data1,
          action: midiStore.learningAction,
        });
      } else if (isCC) {
        midiStore.addMapping({
          portId: targetId,
          type: 'cc',
          channel,
          control: data1,
          action: midiStore.learningAction,
        });
      }
      return; 
    }

    // 2. Midi Execution
    for (const map of midiStore.mappings) {
      // NOTE: We could also filter by map.portId === event.target.id if we want strictly hardware-bound maps.
      // For now, if the channel and control match any controller, we act.
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
    const settings = useSettingsStore.getState();
    const eqRange = EQ_RANGE_PRESETS[settings.eqRange];
    const norm = value / 127;

    switch (action.type) {
      case 'CROSSFADER':
        store.setCrossfader(norm);
        break;
      case 'DECK_VOL':
        if (action.deck) store.setDeckVolume(action.deck, norm);
        break;
      case 'DECK_GAIN':
        if (action.deck) store.setDeckGain(action.deck, (norm * 24) - 12); // -12 to 12
        break;
      case 'DECK_EQ_HIGH': {
        if (action.deck) store.setDeckEq(action.deck, 'high', eqRange.min + norm * (eqRange.max - eqRange.min));
        break;
      }
      case 'DECK_EQ_MID': {
        if (action.deck) store.setDeckEq(action.deck, 'mid', eqRange.min + norm * (eqRange.max - eqRange.min));
        break;
      }
      case 'DECK_EQ_LOW': {
        if (action.deck) store.setDeckEq(action.deck, 'low', eqRange.min + norm * (eqRange.max - eqRange.min));
        break;
      }
      case 'DECK_FILTER': {
        const bipolar = (norm * 2) - 1;
        if (action.deck) store.setDeckColorFx(action.deck, bipolar);
        break;
      }
      case 'DECK_PITCH': {
        if (action.deck) {
          // Assume standard 8% range mapping for now.
          // Some controllers might send inverted (where 127 = slowest).
          // Let's go 0 = up (+8%), 127 = down (-8%). This resembles Pioneer.
          const pitchRange = 0.08;
          const rate = (1 + pitchRange) - (norm * (pitchRange * 2));
          store.setDeckPlaybackRate(action.deck, rate);
        }
        break;
      }
    }
  }

  private executeNoteAction(action: MidiAction, velocity: number) {
    if (velocity === 0) return;
    const store = useMixiStore.getState();
    const velNorm = velocity / 127;
    
    switch (action.type) {
      case 'DECK_PLAY':
        if (action.deck && store.decks[action.deck]) {
          store.setDeckPlaying(action.deck, !store.decks[action.deck].isPlaying);
        }
        break;
      case 'DECK_SYNC':
        if (action.deck && store.decks[action.deck]) {
          if (store.decks[action.deck].isSynced) {
            store.unsyncDeck(action.deck);
          } else {
            store.syncDeck(action.deck);
          }
        }
        break;
      case 'DECK_CUE':
        if (action.deck) {
          store.toggleCue(action.deck);
        }
        break;
      case 'GROOVEBOX_PAD':
        if (action.deck && action.voice) {
          window.dispatchEvent(
            new CustomEvent('MIXIMIDI_GROOVEBOX_PAD', {
              detail: { deck: action.deck, voice: action.voice, velocity: velNorm },
            })
          );
        }
        break;
    }
  }
}
