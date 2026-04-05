/* Reloop Buddy — community-verified, Pioneer-like CC schema */
import { buildDeckPreset } from './helpers';
export const RELOOP_BUDDY_PRESET = buildDeckPreset({
  chA: 0, chB: 1,
  ccA: { eqHigh: 7, eqMid: 11, eqLow: 15, filter: 23, volume: 19, pitch: 0 },
  ccB: { eqHigh: 7, eqMid: 11, eqLow: 15, filter: 24, volume: 19, pitch: 0 },
  btnA: { play: 11, cue: 12, sync: 88 },
  btnB: { play: 11, cue: 12, sync: 88 },
  master: { crossfader: 31 },
});
