/* Behringer CMD Studio 4a — MIDI mode (ch 1-4) */
import { buildDeckPreset } from './helpers';
export const BEHRINGER_CMD_STUDIO_4A_PRESET = buildDeckPreset({
  chA: 0, chB: 1,
  ccA: { eqHigh: 14, eqMid: 15, eqLow: 16, gain: 13, filter: 17, volume: 18, pitch: 12 },
  ccB: { eqHigh: 14, eqMid: 15, eqLow: 16, gain: 13, filter: 17, volume: 18, pitch: 12 },
  btnA: { play: 1, cue: 2, sync: 3 },
  btnB: { play: 1, cue: 2, sync: 3 },
  master: { crossfader: 7, masterVol: 8, hpMix: 9, hpLevel: 10 },
  chMaster: 4,
});
