/* Reloop Terminal Mix 4 — MIDI mode */
import { buildDeckPreset } from './helpers';
export const RELOOP_TERMINAL_MIX_4_PRESET = buildDeckPreset({
  chA: 0, chB: 1,
  ccA: { eqHigh: 4, eqMid: 5, eqLow: 6, gain: 3, filter: 7, volume: 0, pitch: 8 },
  ccB: { eqHigh: 4, eqMid: 5, eqLow: 6, gain: 3, filter: 7, volume: 0, pitch: 8 },
  btnA: { play: 0, cue: 1, sync: 2 },
  btnB: { play: 0, cue: 1, sync: 2 },
  master: { crossfader: 10, masterVol: 11, hpMix: 12 },
});
