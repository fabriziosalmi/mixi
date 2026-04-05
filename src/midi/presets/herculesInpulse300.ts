/* Hercules DJControl Inpulse 300 — Hercules Inpulse family */
import { buildDeckPreset } from './helpers';
export const HERCULES_INPULSE_300_PRESET = buildDeckPreset({
  chA: 0, chB: 1, chMaster: 2,
  ccA: { eqHigh: 4, eqMid: 3, eqLow: 2, gain: 5, filter: 1, volume: 0, pitch: 8 },
  ccB: { eqHigh: 4, eqMid: 3, eqLow: 2, gain: 5, filter: 1, volume: 0, pitch: 8 },
  btnA: { play: 7, cue: 6, sync: 5 },
  btnB: { play: 7, cue: 6, sync: 5 },
  master: { crossfader: 9 },
});
