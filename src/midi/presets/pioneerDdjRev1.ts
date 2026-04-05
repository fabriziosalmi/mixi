/* Pioneer DDJ-REV1 — DERIVED (identical MIDI codes to DDJ-400) */
import { buildDeckPreset } from './helpers';
export const PIONEER_DDJ_REV1_PRESET = buildDeckPreset({
  chA: 0, chB: 1, chMaster: 6,
  ccA: { eqHigh: 7, eqMid: 11, eqLow: 15, gain: 4, filter: 23, volume: 19, pitch: 0 },
  ccB: { eqHigh: 7, eqMid: 11, eqLow: 15, gain: 4, filter: 24, volume: 19, pitch: 0 },
  btnA: { play: 11, cue: 12, sync: 88 },
  btnB: { play: 11, cue: 12, sync: 88 },
  master: { crossfader: 31, hpMix: 12 },
});
