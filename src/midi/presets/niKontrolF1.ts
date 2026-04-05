/* Native Instruments Kontrol F1 — MIDI mode (remix/stems controller) */
import { buildDeckPreset } from './helpers';
export const NI_KONTROL_F1_PRESET = buildDeckPreset({
  chA: 0, chB: 0, chMaster: 0,
  ccA: { eqHigh: 2, eqMid: 3, eqLow: 4, filter: 1, volume: 0 },
  ccB: { eqHigh: 6, eqMid: 7, eqLow: 8, filter: 5, volume: 9 },
  btnA: { play: 36, cue: 37 },
  btnB: { play: 40, cue: 41 },
  master: {},
});
