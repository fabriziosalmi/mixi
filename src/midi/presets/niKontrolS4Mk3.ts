/* Native Instruments Kontrol S4 MK3 — MIDI mode */
import { buildDeckPreset } from './helpers';
export const NI_KONTROL_S4_MK3_PRESET = buildDeckPreset({
  chA: 0, chB: 1,
  ccA: { eqHigh: 4, eqMid: 5, eqLow: 6, gain: 3, filter: 21, volume: 0, pitch: 7 },
  ccB: { eqHigh: 4, eqMid: 5, eqLow: 6, gain: 3, filter: 21, volume: 0, pitch: 7 },
  btnA: { play: 4, cue: 3, sync: 1 },
  btnB: { play: 4, cue: 3, sync: 1 },
  master: { crossfader: 8, masterVol: 10, hpMix: 11, hpLevel: 12 },
});
