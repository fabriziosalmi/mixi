/* Numark Mixtrack Pro FX — VERIFIED from Mixxx XML. InMusic CC schema.
   Ch1=DeckA, Ch2=DeckB, Ch15=HP, Ch16=Master. */
import { buildDeckPreset } from './helpers';
export const NUMARK_MIXTRACK_PRO_FX_PRESET = buildDeckPreset({
  chA: 0, chB: 1, chMaster: 15,
  ccA: { eqHigh: 23, eqMid: 24, eqLow: 25, gain: 22, filter: 26, volume: 28, pitch: 9 },
  ccB: { eqHigh: 23, eqMid: 24, eqLow: 25, gain: 22, filter: 26, volume: 28, pitch: 9 },
  btnA: { play: 0, cue: 1, sync: 2 },
  btnB: { play: 0, cue: 1, sync: 2 },
  master: { crossfader: 8 },
});
