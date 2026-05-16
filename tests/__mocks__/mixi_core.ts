// Stub wasm module for unit tests — mixi-core/pkg is only built for production.
// All functions return safe neutral values so tests exercise JS logic, not DSP.

export const detect_bpm = () => ({ bpm: 120.0, confidence: 0.0, first_beat_offset: 0.0 });

export const compute_rms = () => 0.0;

export const compute_rms_multichannel = () => 0.0;

export const normalise = (arr: Float32Array) => arr;

export const peak_level = () => 0.0;

export const compute_blackboard = () => new Float64Array(20);

export const detect_key = () => '';

export const parse_metadata = () => ({
  title: '',
  artist: '',
  album: '',
  duration: 0,
  bpm: 0,
  key: '',
});

export const detect_drops = () => new Float32Array(0);
