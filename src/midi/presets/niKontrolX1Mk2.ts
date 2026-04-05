/* Native Instruments Kontrol X1 MK2 — MIDI mode (FX/browse controller) */
import { buildDeckPreset } from './helpers';
export const NI_KONTROL_X1_MK2_PRESET = buildDeckPreset({
  chA: 0, chB: 0, chMaster: 0,
  ccA: { eqHigh: 4, eqMid: 5, eqLow: 6, filter: 7, volume: 0 },
  ccB: { eqHigh: 8, eqMid: 9, eqLow: 10, filter: 11, volume: 1 },
  btnA: { play: 12, cue: 13, sync: 14 },
  btnB: { play: 15, cue: 16, sync: 17 },
  master: {},
});
