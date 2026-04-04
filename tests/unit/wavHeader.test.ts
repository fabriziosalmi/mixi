import { describe, it, expect } from 'vitest';

// We test the WAV header logic without importing the Node.js module directly.
// The header is 44 bytes with known structure.

const WAV_HEADER_SIZE = 44;
const WAV_DATA_SIZE_SENTINEL = 0xFFFFFFFF;

function createWavHeader(sampleRate: number, channels: number, dataSizeBytes: number): ArrayBuffer {
  const buf = new ArrayBuffer(WAV_HEADER_SIZE);
  const view = new DataView(buf);
  const bitsPerSample = 32;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const riffSize = dataSizeBytes === WAV_DATA_SIZE_SENTINEL ? WAV_DATA_SIZE_SENTINEL : dataSizeBytes + WAV_HEADER_SIZE - 8;

  // RIFF header
  new Uint8Array(buf, 0, 4).set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  view.setUint32(4, riffSize, true);
  new Uint8Array(buf, 8, 4).set([0x57, 0x41, 0x56, 0x45]); // "WAVE"

  // fmt sub-chunk
  new Uint8Array(buf, 12, 4).set([0x66, 0x6d, 0x74, 0x20]); // "fmt "
  view.setUint32(16, 16, true);        // chunk size
  view.setUint16(20, 3, true);         // IEEE float
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  new Uint8Array(buf, 36, 4).set([0x64, 0x61, 0x74, 0x61]); // "data"
  view.setUint32(40, dataSizeBytes, true);

  return buf;
}

describe('WAV Header', () => {
  it('creates a valid 44-byte header', () => {
    const header = createWavHeader(44100, 2, 1000);
    expect(new Uint8Array(header).length).toBe(44);
  });

  it('starts with RIFF magic', () => {
    const header = new Uint8Array(createWavHeader(44100, 2, 1000));
    expect(String.fromCharCode(...header.slice(0, 4))).toBe('RIFF');
  });

  it('contains WAVE format', () => {
    const header = new Uint8Array(createWavHeader(44100, 2, 1000));
    expect(String.fromCharCode(...header.slice(8, 12))).toBe('WAVE');
  });

  it('uses IEEE float format (3)', () => {
    const view = new DataView(createWavHeader(44100, 2, 1000));
    expect(view.getUint16(20, true)).toBe(3);
  });

  it('stores correct sample rate', () => {
    const view = new DataView(createWavHeader(48000, 2, 0));
    expect(view.getUint32(24, true)).toBe(48000);
  });

  it('stores correct channels', () => {
    const view = new DataView(createWavHeader(44100, 1, 0));
    expect(view.getUint16(22, true)).toBe(1);
  });

  it('calculates correct byte rate for stereo 32-bit float', () => {
    const view = new DataView(createWavHeader(44100, 2, 0));
    expect(view.getUint32(28, true)).toBe(44100 * 2 * 4);
  });

  it('stores data size correctly', () => {
    const view = new DataView(createWavHeader(44100, 2, 12345));
    expect(view.getUint32(40, true)).toBe(12345);
  });

  it('uses sentinel for orphan detection', () => {
    const view = new DataView(createWavHeader(44100, 2, WAV_DATA_SIZE_SENTINEL));
    expect(view.getUint32(40, true)).toBe(0xFFFFFFFF);
  });

  it('RIFF size = data size + 36 for known sizes', () => {
    const dataSize = 88200;
    const view = new DataView(createWavHeader(44100, 2, dataSize));
    expect(view.getUint32(4, true)).toBe(dataSize + 36);
  });

  it('RIFF size = sentinel when data size is sentinel', () => {
    const view = new DataView(createWavHeader(44100, 2, WAV_DATA_SIZE_SENTINEL));
    expect(view.getUint32(4, true)).toBe(WAV_DATA_SIZE_SENTINEL);
  });

  it('block align = channels × bytes per sample', () => {
    const view = new DataView(createWavHeader(44100, 2, 0));
    expect(view.getUint16(32, true)).toBe(8); // 2ch × 4B
  });

  it('bits per sample = 32', () => {
    const view = new DataView(createWavHeader(44100, 2, 0));
    expect(view.getUint16(34, true)).toBe(32);
  });
});
