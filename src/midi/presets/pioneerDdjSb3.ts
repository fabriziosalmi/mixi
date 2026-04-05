/* Pioneer DDJ-SB3 — Pioneer DDJ family CC schema */
import { buildDeckPreset } from './helpers';
export const PIONEER_DDJ_SB3_PRESET = buildDeckPreset({
  chA: 0, chB: 1, chMaster: 6,
  ccA: { eqHigh: 7, eqMid: 11, eqLow: 15, gain: 4, filter: 23, volume: 19, pitch: 0 },
  ccB: { eqHigh: 7, eqMid: 11, eqLow: 15, gain: 4, filter: 24, volume: 19, pitch: 0 },
  btnA: { play: 11, cue: 12, sync: 88 },
  btnB: { play: 11, cue: 12, sync: 88 },
  master: { crossfader: 31, hpMix: 12, hpLevel: 13 },
});
