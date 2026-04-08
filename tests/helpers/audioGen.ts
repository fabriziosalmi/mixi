/**
 * Shared audio synthesis primitives for BPM & Sync bench tests.
 *
 * All generators produce Float32Array at 44100 Hz.
 * Every function is deterministic (seeded noise optional).
 */

export const SR = 44100;
export const DURATION = 15;
export const SAMPLES = SR * DURATION;

// ── AudioBuffer Mock ─────────────────────────────────────────

export function makeAudioBuffer(samples: Float32Array, sampleRate = SR): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: (ch: number) => {
      if (ch !== 0) throw new Error('Only mono supported in test');
      return samples;
    },
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

// ── Synthesis Primitives ─────────────────────────────────────

export function addClick(buf: Float32Array, pos: number, amplitude = 0.9) {
  const decay = Math.floor(SR * 0.003);
  for (let i = 0; i < decay && pos + i < buf.length; i++) {
    buf[pos + i] += amplitude * Math.exp(-i / (decay * 0.25));
  }
}

export function addKick(buf: Float32Array, pos: number, amplitude = 0.8) {
  const len = Math.floor(SR * 0.08);
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    const freq = 150 * Math.exp(-t * 30) + 50;
    const env = Math.exp(-t * 25);
    buf[pos + i] += amplitude * env * Math.sin(2 * Math.PI * freq * t);
  }
}

export function addHihat(buf: Float32Array, pos: number, amplitude = 0.3) {
  const len = Math.floor(SR * 0.02);
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 200);
    buf[pos + i] += amplitude * env * (Math.random() * 2 - 1);
  }
}

export function addSnare(buf: Float32Array, pos: number, amplitude = 0.5) {
  const len = Math.floor(SR * 0.06);
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 40);
    const body = Math.sin(2 * Math.PI * 200 * t) * 0.5;
    const noise = (Math.random() * 2 - 1) * 0.7;
    buf[pos + i] += amplitude * env * (body + noise);
  }
}

export function addClap(buf: Float32Array, pos: number, amplitude = 0.4) {
  for (let hit = 0; hit < 3; hit++) {
    const start = pos + Math.floor(hit * SR * 0.008);
    const len = Math.floor(SR * 0.005);
    for (let i = 0; i < len && start + i < buf.length; i++) {
      buf[start + i] += amplitude * 0.5 * (Math.random() * 2 - 1);
    }
  }
  const mainStart = pos + Math.floor(SR * 0.025);
  const mainLen = Math.floor(SR * 0.04);
  for (let i = 0; i < mainLen && mainStart + i < buf.length; i++) {
    const t = i / SR;
    buf[mainStart + i] += amplitude * Math.exp(-t * 60) * (Math.random() * 2 - 1);
  }
}

export function addRim(buf: Float32Array, pos: number, amplitude = 0.35) {
  const len = Math.floor(SR * 0.006);
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    buf[pos + i] += amplitude * Math.exp(-t * 400) * Math.sin(2 * Math.PI * 800 * t);
  }
}

export function addBass(buf: Float32Array, pos: number, amplitude = 0.6) {
  const len = Math.floor(SR * 0.12);
  for (let i = 0; i < len && pos + i < buf.length; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 15);
    buf[pos + i] += amplitude * env * Math.sin(2 * Math.PI * 55 * t);
  }
}

export function addPinkNoise(buf: Float32Array, amplitude = 0.05) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < buf.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    buf[i] += amplitude * pink * 0.11;
  }
}

// ── Track Generators ─────────────────────────────────────────

export function generateKickTrack(bpm: number, offsetSec = 0, durationSec = DURATION): Float32Array {
  const samples = Math.floor(SR * durationSec);
  const buf = new Float32Array(samples);
  const beatInterval = (60 / bpm) * SR;
  let pos = Math.floor(offsetSec * SR);
  while (pos < samples) {
    addKick(buf, Math.floor(pos));
    pos += beatInterval;
  }
  return buf;
}

export function generateKickHatTrack(bpm: number, offsetSec = 0): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  let pos = Math.floor(offsetSec * SR);
  while (pos < SAMPLES) {
    addKick(buf, Math.floor(pos));
    const hatPos = Math.floor(pos + beatInterval / 2);
    if (hatPos < SAMPLES) addHihat(buf, hatPos);
    pos += beatInterval;
  }
  return buf;
}

export function generateHouseTrack(bpm: number, offsetSec = 0): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  let pos = Math.floor(offsetSec * SR);
  let beat = 0;
  while (pos < SAMPLES) {
    addKick(buf, Math.floor(pos));
    if (beat % 2 === 1) addClap(buf, Math.floor(pos));
    addHihat(buf, Math.floor(pos), 0.12);
    const hatOff = Math.floor(pos + beatInterval / 2);
    if (hatOff < SAMPLES) addHihat(buf, hatOff, 0.18);
    pos += beatInterval;
    beat++;
  }
  return buf;
}

export function generateTechnoTrack(bpm: number): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  let pos = 0;
  while (pos < SAMPLES) {
    addKick(buf, Math.floor(pos), 0.9);
    const rimPos = Math.floor(pos + beatInterval / 2);
    if (rimPos < SAMPLES) addRim(buf, rimPos);
    for (let i = 0; i < 4; i++) {
      const p = Math.floor(pos + beatInterval * i / 4);
      if (p < SAMPLES) addHihat(buf, p, 0.1 + (i % 2) * 0.08);
    }
    pos += beatInterval;
  }
  return buf;
}

export function generateSyncopatedTrack(bpm: number, offsetSec = 0): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  let pos = Math.floor(offsetSec * SR);
  let beat = 0;
  while (pos < SAMPLES) {
    const beatInBar = beat % 4;
    if (beatInBar === 0 || beatInBar === 2) addKick(buf, Math.floor(pos));
    if (beatInBar === 1 || beatInBar === 3) addSnare(buf, Math.floor(pos));
    addHihat(buf, Math.floor(pos), 0.15);
    const hatOff = Math.floor(pos + beatInterval / 2);
    if (hatOff < SAMPLES) addHihat(buf, hatOff, 0.2);
    if (beatInBar === 3) {
      const ghost = Math.floor(pos + beatInterval * 0.75);
      if (ghost < SAMPLES) addSnare(buf, ghost, 0.15);
    }
    pos += beatInterval;
    beat++;
  }
  addPinkNoise(buf, 0.03);
  return buf;
}

export function generateNoisyTrack(bpm: number, offsetSec = 0, noiseLevel = 0.05): Float32Array {
  const buf = generateKickHatTrack(bpm, offsetSec);
  addPinkNoise(buf, noiseLevel);
  return buf;
}

export function generateMixedTrack(bpmA: number, bpmB: number, mixRatio = 0.5): Float32Array {
  const trackA = generateKickHatTrack(bpmA, 0);
  const trackB = generateKickHatTrack(bpmB, 0.1);
  const buf = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    buf[i] = trackA[i] * (1 - mixRatio) + trackB[i] * mixRatio;
  }
  addPinkNoise(buf, 0.02);
  return buf;
}

export function generateDnbTrack(bpm: number): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  let barStart = 0;
  while (barStart < SAMPLES) {
    addKick(buf, Math.floor(barStart));
    addSnare(buf, Math.floor(barStart + beatInterval));
    addKick(buf, Math.floor(barStart + beatInterval * 2.5));
    addSnare(buf, Math.floor(barStart + beatInterval * 3));
    for (let i = 0; i < 16; i++) {
      const p = Math.floor(barStart + beatInterval * i * 0.25);
      if (p < SAMPLES) addHihat(buf, p, 0.08 + (i % 4 === 0 ? 0.1 : 0));
    }
    barStart += beatInterval * 4;
  }
  return buf;
}

export function generateBreakbeat(bpm: number): Float32Array {
  const buf = new Float32Array(SAMPLES);
  const beatInterval = (60 / bpm) * SR;
  let barStart = 0;
  while (barStart < SAMPLES) {
    addKick(buf, Math.floor(barStart));
    addSnare(buf, Math.floor(barStart + beatInterval * 1.5));
    addKick(buf, Math.floor(barStart + beatInterval * 2.75));
    addSnare(buf, Math.floor(barStart + beatInterval * 3));
    for (let i = 0; i < 8; i++) {
      const p = Math.floor(barStart + beatInterval * i * 0.5);
      if (p < SAMPLES) addHihat(buf, p, 0.15);
    }
    barStart += beatInterval * 4;
  }
  return buf;
}

// ── BPM comparison helpers ───────────────────────────────────

export function bpmMatchesExact(detected: number, expected: number, toleranceBpm = 1.5): boolean {
  return Math.abs(detected - expected) <= toleranceBpm;
}

export function bpmMatchesOctave(detected: number, expected: number, toleranceBpm = 1.5): boolean {
  return [expected, expected * 2, expected / 2].some(c => Math.abs(detected - c) <= toleranceBpm);
}
