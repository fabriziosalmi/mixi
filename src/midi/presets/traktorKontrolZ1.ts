/* Traktor Kontrol Z1 — compact 2-ch mixer controller */
import { buildDeckPreset } from './helpers';
export const TRAKTOR_KONTROL_Z1_PRESET = buildDeckPreset({
  chA: 0, chB: 0, chMaster: 0,
  ccA: { eqHigh: 3, eqMid: 4, eqLow: 5, filter: 6, volume: 0 },
  ccB: { eqHigh: 8, eqMid: 9, eqLow: 10, filter: 11, volume: 1 },
  btnA: { play: 0, cue: 1 },
  btnB: { play: 2, cue: 3 },
  master: { crossfader: 2, hpMix: 13, hpLevel: 14 },
});
