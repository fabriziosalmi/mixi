/* Allen & Heath Xone:K2 — latching MIDI mode, all ch 15 */
import { buildDeckPreset } from './helpers';
export const ALLEN_HEATH_XONE_K2_PRESET = buildDeckPreset({
  chA: 14, chB: 14, chMaster: 14,
  ccA: { eqHigh: 4, eqMid: 5, eqLow: 6, filter: 7, volume: 0 },
  ccB: { eqHigh: 8, eqMid: 9, eqLow: 10, filter: 11, volume: 1 },
  btnA: { play: 36, cue: 37 },
  btnB: { play: 40, cue: 41 },
  master: { crossfader: 2, hpMix: 12, hpLevel: 13 },
});
