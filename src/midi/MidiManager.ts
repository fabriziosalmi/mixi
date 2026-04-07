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
import { log } from '../utils/logger';
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
  | { type: 'MASTER_VOL' }
  | { type: 'HEADPHONE_MIX' }
  | { type: 'HEADPHONE_LEVEL' }
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

  // ── MIDI Clock Out ────────────────────────────────────────
  // Sends 24 ppqn clock ticks synced to the active deck's BPM.
  // 0xFA = Start, 0xFC = Stop, 0xF8 = Clock tick (24 per beat).
  private _clockEnabled = false;
  private _clockSchedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private _clockNextTickTime = 0;
  private _clockOutputs: MIDIOutput[] = [];
  // Look-ahead scheduler constants (ms)
  private static readonly CLOCK_LOOK_AHEAD = 25;   // schedule 25ms into the future
  private static readonly CLOCK_SCHEDULER_MS = 10;  // check every 10ms

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
      log.debug('MIDI', `UI learn requested: ${action.type}`);
      useMidiStore.getState().setLearningAction(action);
    };

    if (!navigator.requestMIDIAccess) {
      log.warn('MIDI', 'WebMIDI API not supported in this browser');
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
          log.debug('MIDI', `State change: ${port.name} → ${port.state}`);
          if (port.type === 'input') {
            if (port.state === 'connected') {
              this.attachListener(port as MIDIInput);
            } else if (port.state === 'disconnected') {
              (port as MIDIInput).onmidimessage = null;
            }
          }
          this.notifyStatus();
        };
        log.info('MIDI', 'Initialized successfully');
      }
    } catch (err) {
      log.error('MIDI', `Access denied or failed: ${err}`);
    }
  }

  private attachListener(input: MIDIInput) {
    input.onmidimessage = this.onMidiMessage.bind(this);
  }

  private onMidiMessage(event: MIDIMessageEvent) {
    if (!event.data) return;
    const [status, data1, data2] = event.data;
    
    // Handle MIDI real-time messages (clock, start, stop)
    if (status === 0xF8) { this.handleClockTick(); return; }
    if (status === 0xFA) { this._externalClockTicks = []; log.info('MIDI', 'External clock: START'); return; }
    if (status === 0xFC) { this._externalBpm = 0; this._externalClockTicks = []; log.info('MIDI', 'External clock: STOP'); return; }
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
      case 'MASTER_VOL':
        store.setMasterVolume(norm);
        break;
      case 'HEADPHONE_MIX':
        store.setHeadphoneMix(norm);
        break;
      case 'HEADPHONE_LEVEL':
        store.setHeadphoneLevel(norm);
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
          const pitchRange = useSettingsStore.getState().pitchRange;
          const rate = (1 + pitchRange) - (norm * (pitchRange * 2));
          store.setDeckPlaybackRate(action.deck, rate);
        }
        break;
      }
    }
  }

  // ── MIDI Clock Output ──────────────────────────────────────
  // 24 ppqn (pulses per quarter note) synced to active deck BPM.
  // Standard MIDI timing messages: 0xFA Start, 0xFC Stop, 0xF8 Tick.

  get clockEnabled(): boolean { return this._clockEnabled; }

  startClock(): void {
    if (this._clockEnabled) return;
    if (!this.midiAccess) return;

    // Collect all available MIDI outputs
    this._clockOutputs = [];
    this.midiAccess.outputs.forEach((output: MIDIOutput) => {
      this._clockOutputs.push(output);
    });

    if (this._clockOutputs.length === 0) {
      log.warn('MIDI', 'No MIDI outputs available for clock');
      return;
    }

    this._clockEnabled = true;

    // Send MIDI Start (0xFA)
    this.sendToAllOutputs([0xFA]);
    log.info('MIDI', `Clock started → ${this._clockOutputs.map(o => o.name).join(', ')}`);

    // Tick loop: calculate interval from BPM, send 24 ppqn
    this.scheduleClockTicks();
  }

  stopClock(): void {
    if (!this._clockEnabled) return;
    this._clockEnabled = false;

    if (this._clockSchedulerTimer) {
      clearTimeout(this._clockSchedulerTimer);
      this._clockSchedulerTimer = null;
    }

    // Send MIDI Stop (0xFC)
    this.sendToAllOutputs([0xFC]);
    this._clockOutputs = [];
    log.info('MIDI', 'Clock stopped');
  }

  /**
   * Look-ahead scheduler: schedules MIDI clock ticks into the future
   * using hardware timestamps (MIDIOutput.send(data, timestamp)).
   * The OS MIDI driver delivers messages at the exact timestamp,
   * independent of JS main-thread scheduling jitter.
   *
   * Recalculates tick interval each iteration to follow live BPM changes.
   */
  private scheduleClockTicks(): void {
    this._clockNextTickTime = performance.now();
    this.clockSchedulerLoop();
  }

  private clockSchedulerLoop(): void {
    if (!this._clockEnabled) return;

    const now = performance.now();
    const tickInterval = this.getTickIntervalMs();
    const deadline = now + MidiManager.CLOCK_LOOK_AHEAD;

    // Schedule all ticks that fall within the look-ahead window
    while (this._clockNextTickTime < deadline) {
      const timestamp = Math.max(this._clockNextTickTime, now);
      this.sendToAllOutputsAt([0xF8], timestamp);
      this._clockNextTickTime += tickInterval;
    }

    this._clockSchedulerTimer = setTimeout(
      () => this.clockSchedulerLoop(),
      MidiManager.CLOCK_SCHEDULER_MS,
    );
  }

  private getTickIntervalMs(): number {
    const state = useMixiStore.getState();
    const deckA = state.decks.A;
    const deckB = state.decks.B;
    let bpm = 120;
    if (deckA.isPlaying && deckA.bpm > 0) bpm = deckA.bpm;
    else if (deckB.isPlaying && deckB.bpm > 0) bpm = deckB.bpm;
    return 60000 / (bpm * 24); // ms per tick at 24 ppqn
  }

  private sendToAllOutputs(data: number[]): void {
    const msg = new Uint8Array(data);
    for (const output of this._clockOutputs) {
      try { output.send(msg); } catch { /* output may have disconnected */ }
    }
  }

  /** Send with hardware timestamp — OS MIDI driver delivers at exact time. */
  private sendToAllOutputsAt(data: number[], timestamp: number): void {
    const msg = new Uint8Array(data);
    for (const output of this._clockOutputs) {
      try { output.send(msg, timestamp); } catch { /* output may have disconnected */ }
    }
  }

  // ── MIDI Clock Input (receive external clock) ─────────────
  // When receiving 0xF8 ticks, calculate external BPM and expose it.

  private _externalClockTicks: number[] = [];
  private _externalBpm = 0;

  get externalBpm(): number { return this._externalBpm; }
  get hasExternalClock(): boolean { return this._externalBpm > 0; }

  private handleClockTick(): void {
    const now = performance.now();
    this._externalClockTicks.push(now);

    // Keep last 48 ticks (2 beats worth)
    if (this._externalClockTicks.length > 48) {
      this._externalClockTicks.shift();
    }

    if (this._externalClockTicks.length >= 24) {
      // Average interval over last 24 ticks (1 beat)
      const ticks = this._externalClockTicks;
      const span = ticks[ticks.length - 1] - ticks[ticks.length - 24];
      const avgTickMs = span / 23;
      this._externalBpm = 60000 / (avgTickMs * 24);
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
