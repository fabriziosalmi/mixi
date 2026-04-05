/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI — PolyForm Noncommercial License 1.0.0.
 */

import type { MidiMapping } from '../MidiManager';

const PORT = '';

export function cc(ch: number, ctrl: number, action: MidiMapping['action']): MidiMapping {
  return { portId: PORT, type: 'cc', channel: ch, control: ctrl, action };
}

export function note(ch: number, n: number, action: MidiMapping['action']): MidiMapping {
  return { portId: PORT, type: 'note', channel: ch, control: n, action };
}

/** Standard 2-deck DJ controller mapping template.
 *  Most controllers follow similar patterns — this helper generates
 *  a full mapping from channel/CC/note assignments. */
export interface DeckCCMap {
  eqHigh: number;
  eqMid: number;
  eqLow: number;
  gain?: number;
  filter?: number;
  volume: number;
  pitch?: number;
}

export interface ButtonMap {
  play: number;
  cue?: number;
  sync?: number;
}

export interface MasterMap {
  crossfader?: number;
  masterVol?: number;
  hpMix?: number;
  hpLevel?: number;
}

/** Build a standard 2-deck mapping from structured config. */
export function buildDeckPreset(opts: {
  chA: number;         // MIDI channel for deck A controls
  chB: number;         // MIDI channel for deck B controls
  chMaster?: number;   // MIDI channel for master controls (defaults to chA)
  ccA: DeckCCMap;
  ccB: DeckCCMap;
  btnA: ButtonMap;
  btnB: ButtonMap;
  btnChA?: number;     // button channel for deck A (defaults to chA)
  btnChB?: number;     // button channel for deck B (defaults to chB)
  master?: MasterMap;
}): MidiMapping[] {
  const m: MidiMapping[] = [];
  const { chA, chB, ccA, ccB, btnA, btnB, master } = opts;
  const chM = opts.chMaster ?? chA;
  const bchA = opts.btnChA ?? chA;
  const bchB = opts.btnChB ?? chB;

  // Deck A CCs
  m.push(cc(chA, ccA.eqHigh, { type: 'DECK_EQ_HIGH', deck: 'A' }));
  m.push(cc(chA, ccA.eqMid, { type: 'DECK_EQ_MID', deck: 'A' }));
  m.push(cc(chA, ccA.eqLow, { type: 'DECK_EQ_LOW', deck: 'A' }));
  if (ccA.gain != null) m.push(cc(chA, ccA.gain, { type: 'DECK_GAIN', deck: 'A' }));
  if (ccA.filter != null) m.push(cc(chA, ccA.filter, { type: 'DECK_FILTER', deck: 'A' }));
  m.push(cc(chA, ccA.volume, { type: 'DECK_VOL', deck: 'A' }));
  if (ccA.pitch != null) m.push(cc(chA, ccA.pitch, { type: 'DECK_PITCH', deck: 'A' }));

  // Deck B CCs
  m.push(cc(chB, ccB.eqHigh, { type: 'DECK_EQ_HIGH', deck: 'B' }));
  m.push(cc(chB, ccB.eqMid, { type: 'DECK_EQ_MID', deck: 'B' }));
  m.push(cc(chB, ccB.eqLow, { type: 'DECK_EQ_LOW', deck: 'B' }));
  if (ccB.gain != null) m.push(cc(chB, ccB.gain, { type: 'DECK_GAIN', deck: 'B' }));
  if (ccB.filter != null) m.push(cc(chB, ccB.filter, { type: 'DECK_FILTER', deck: 'B' }));
  m.push(cc(chB, ccB.volume, { type: 'DECK_VOL', deck: 'B' }));
  if (ccB.pitch != null) m.push(cc(chB, ccB.pitch, { type: 'DECK_PITCH', deck: 'B' }));

  // Deck A buttons
  m.push(note(bchA, btnA.play, { type: 'DECK_PLAY', deck: 'A' }));
  if (btnA.cue != null) m.push(note(bchA, btnA.cue, { type: 'DECK_CUE', deck: 'A' }));
  if (btnA.sync != null) m.push(note(bchA, btnA.sync, { type: 'DECK_SYNC', deck: 'A' }));

  // Deck B buttons
  m.push(note(bchB, btnB.play, { type: 'DECK_PLAY', deck: 'B' }));
  if (btnB.cue != null) m.push(note(bchB, btnB.cue, { type: 'DECK_CUE', deck: 'B' }));
  if (btnB.sync != null) m.push(note(bchB, btnB.sync, { type: 'DECK_SYNC', deck: 'B' }));

  // Master
  if (master) {
    if (master.crossfader != null) m.push(cc(chM, master.crossfader, { type: 'CROSSFADER' }));
    if (master.masterVol != null) m.push(cc(chM, master.masterVol, { type: 'MASTER_VOL' }));
    if (master.hpMix != null) m.push(cc(chM, master.hpMix, { type: 'HEADPHONE_MIX' }));
    if (master.hpLevel != null) m.push(cc(chM, master.hpLevel, { type: 'HEADPHONE_LEVEL' }));
  }

  return m;
}
