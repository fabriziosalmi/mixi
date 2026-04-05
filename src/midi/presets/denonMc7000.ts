/* Denon MC7000 — VERIFIED from Mixxx Denon-MC7000.midi.xml
   Ch1-4=Decks, Ch16=Master. InMusic CC schema. */
import { buildDeckPreset } from './helpers';
export const DENON_MC7000_PRESET = buildDeckPreset({
  chA: 0, chB: 1, chMaster: 15,
  ccA: { eqHigh: 23, eqMid: 24, eqLow: 25, gain: 22, filter: 26, volume: 28, pitch: 119 },
  ccB: { eqHigh: 23, eqMid: 24, eqLow: 25, gain: 22, filter: 26, volume: 28, pitch: 119 },
  btnA: { play: 0, cue: 1, sync: 2 },
  btnB: { play: 0, cue: 1, sync: 2 },
  master: { crossfader: 8 },
});
