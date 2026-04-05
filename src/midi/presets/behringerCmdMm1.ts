/* Behringer CMD MM-1 — 4-ch MIDI mixer controller */
import { buildDeckPreset } from './helpers';
export const BEHRINGER_CMD_MM1_PRESET = buildDeckPreset({
  chA: 0, chB: 0, chMaster: 0,
  ccA: { eqHigh: 1, eqMid: 2, eqLow: 3, volume: 4 },
  ccB: { eqHigh: 5, eqMid: 6, eqLow: 7, volume: 8 },
  btnA: { play: 0, cue: 1 },
  btnB: { play: 2, cue: 3 },
  master: { crossfader: 9, masterVol: 10 },
});
