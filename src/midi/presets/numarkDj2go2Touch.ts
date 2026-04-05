/* Numark DJ2GO2 Touch — InMusic schema. Ultra-compact: no EQ/gain/filter knobs. */
import { buildDeckPreset } from './helpers';
export const NUMARK_DJ2GO2_TOUCH_PRESET = buildDeckPreset({
  chA: 0, chB: 1, chMaster: 15,
  ccA: { eqHigh: 23, eqMid: 24, eqLow: 25, volume: 28, pitch: 9 },
  ccB: { eqHigh: 23, eqMid: 24, eqLow: 25, volume: 28, pitch: 9 },
  btnA: { play: 0, cue: 1, sync: 2 },
  btnB: { play: 0, cue: 1, sync: 2 },
  master: { crossfader: 8 },
});
