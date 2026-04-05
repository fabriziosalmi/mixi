/* Denon Prime GO — portable standalone + MIDI, InMusic schema */
import { buildDeckPreset } from './helpers';
export const DENON_PRIME_GO_PRESET = buildDeckPreset({
  chA: 0, chB: 1, chMaster: 15,
  ccA: { eqHigh: 23, eqMid: 24, eqLow: 25, gain: 22, filter: 26, volume: 28, pitch: 119 },
  ccB: { eqHigh: 23, eqMid: 24, eqLow: 25, gain: 22, filter: 26, volume: 28, pitch: 119 },
  btnA: { play: 0, cue: 1, sync: 2 },
  btnB: { play: 0, cue: 1, sync: 2 },
  master: { crossfader: 8 },
});
