/* Akai APC40 MK2 — generic MIDI mode (designed for Ableton, adapted for DJ) */
import { buildDeckPreset } from './helpers';
export const AKAI_APC40_MK2_PRESET = buildDeckPreset({
  chA: 0, chB: 0, chMaster: 0,
  ccA: { eqHigh: 48, eqMid: 49, eqLow: 50, volume: 7, filter: 51 },
  ccB: { eqHigh: 52, eqMid: 53, eqLow: 54, volume: 8, filter: 55 },
  btnA: { play: 0, cue: 1, sync: 2 },
  btnB: { play: 3, cue: 4, sync: 5 },
  master: { crossfader: 15, masterVol: 14 },
});
