import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMixiStore } from '../../src/store/mixiStore';
import { linearRegressionSlope } from '../../src/audio/PhaseLockLoop';
import { AudioStreamingBuffer } from '../../src/audio/AudioStreamingBuffer';
import { smoothParam } from '../../src/audio/utils/paramSmooth';

/** Build a minimal valid WAV header + PCM payload with configurable format tag (1=int, 3=IEEE float). */
function makeWavBuffer(audioFormat: number, sampleRate = 44100, channels = 2, bitsPerSample = 32, numFrames = 64): ArrayBuffer {
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const dataSize = numFrames * bytesPerFrame;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);
  return buf;
}

describe('Tier 1 Fixes — Break-Tests', () => {
  beforeEach(() => {
    const s = useMixiStore.getState();
    s.ejectDeck('A');
    s.ejectDeck('B');
  });

  // ── LG-01: originalBpm used for beatgrid math on pitched decks ──

  it('LG-01: setHotCue quantizes on originalBpm (buffer time), not pitched bpm', () => {
    const store = useMixiStore.getState();
    store.setDeckTrackLoaded('A', true);
    store.setDeckWaveform('A', [], 180);
    store.setDeckBpm('A', 120, 0, 1); // originalBpm = 120 → beatPeriod = 0.500s
    store.setDeckPlaybackRate('A', 1.25); // pitched bpm = 150 → pitched period = 0.400s
    store.setQuantize('A', true);

    // 0.48s is closest to beat 1 at 0.500s (120 BPM), NOT 0.400s (150 BPM).
    store.setHotCue('A', 0, 0.48);
    expect(useMixiStore.getState().decks.A.hotCues[0]).toBeCloseTo(0.5, 5);
  });

  it('LG-01: shiftGrid shifts by originalBpm beat period on pitched decks', () => {
    const store = useMixiStore.getState();
    store.setDeckTrackLoaded('A', true);
    store.setDeckWaveform('A', [], 180);
    store.setDeckBpm('A', 120, 1.0, 1);
    store.setDeckPlaybackRate('A', 1.25); // pitched bpm = 150

    store.shiftGrid('A', 1);
    // 1 beat at originalBpm (120) = 0.5s → 1.0 + 0.5 = 1.5s (not 1.4s).
    expect(useMixiStore.getState().decks.A.firstBeatOffset).toBeCloseTo(1.5, 5);
  });

  // ── LG-07: syncDeck clears activeLoop in store ──

  it('LG-07: syncDeck clears activeLoop in store so seek cannot re-enable a ghost loop', () => {
    const store = useMixiStore.getState();
    store.setDeckTrackLoaded('A', true);
    store.setDeckTrackLoaded('B', true);
    store.setDeckBpm('A', 128, 0, 1);
    store.setDeckBpm('B', 128, 0, 1);
    useMixiStore.setState((s) => ({
      decks: {
        ...s.decks,
        A: { ...s.decks.A, activeLoop: { start: 4, end: 8, lengthInBeats: 8 } },
      },
    }));

    store.syncDeck('A');
    expect(useMixiStore.getState().decks.A.activeLoop).toBeNull();
  });

  // ── LG-05: PhaseLockLoop ring buffer linear regression ──

  it('LG-05: linearRegressionSlope handles wrapped circular ring buffer chronologically', () => {
    // True chronological series: 0, 1, 2, ..., 99 (exact slope = +1.0)
    // Stored wrapped in a 100-element ring buffer with oldest sample at startIdx = 40.
    const n = 100;
    const startIdx = 40;
    const ring = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      ring[(startIdx + i) % n] = i;
    }

    const slopeWrapped = linearRegressionSlope(ring, startIdx);
    expect(slopeWrapped).toBeCloseTo(1.0, 6);

    // Break-check: reading without startIdx (the old bug) yields a wrong negative slope.
    const slopeBuggy = linearRegressionSlope(ring, 0);
    expect(slopeBuggy).toBeLessThan(0);
  });

  // ── LG-03: AudioStreamingBuffer WAV float32 + error propagation + duration update ──

  it('LG-03: AudioStreamingBuffer preserves WAV IEEE float format tag (3) when slicing', async () => {
    let capturedFormatTag = -1;
    const fakeCtx = {
      decodeAudioData: vi.fn(async (ab: ArrayBuffer) => {
        capturedFormatTag = new DataView(ab).getUint16(20, true);
        return { duration: 1, sampleRate: 44100, numberOfChannels: 2, length: 64 } as unknown as AudioBuffer;
      }),
    } as unknown as AudioContext;

    const wav = makeWavBuffer(3, 44100, 2, 32, 64);
    const sb = new AudioStreamingBuffer(fakeCtx, wav);
    await sb.initialize();
    expect(sb.isWav).toBe(true);
    expect(sb.audioFormat).toBe(3);

    await sb.decodeSegment(0, 1);
    expect(capturedFormatTag).toBe(3);
  });

  it('LG-03: AudioStreamingBuffer propagates decodeAudioData errors instead of returning silence', async () => {
    const fakeCtx = {
      decodeAudioData: vi.fn(async () => {
        throw new Error('EncodingError: unable to decode audio data');
      }),
    } as unknown as AudioContext;

    const corruptBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
    const sb = new AudioStreamingBuffer(fakeCtx, corruptBytes);
    await sb.initialize();

    await expect(sb.decodeSegment(0, 10)).rejects.toThrow(/unable to decode audio data/i);
  });

  it('LG-03: AudioStreamingBuffer updates duration from decoded AudioBuffer for non-WAV tracks', async () => {
    const realDuration = 425.5; // 7m 05.5s (would previously be stuck at 180s fallback)
    const fakeBuf = {
      duration: realDuration,
      sampleRate: 48000,
      numberOfChannels: 2,
      length: Math.floor(realDuration * 48000),
      getChannelData: () => new Float32Array(Math.floor(realDuration * 48000)),
    } as unknown as AudioBuffer;
    const fakeCtx = {
      decodeAudioData: vi.fn(async () => fakeBuf),
      createBuffer: vi.fn((ch: number, len: number, sr: number) => ({
        duration: len / sr,
        sampleRate: sr,
        numberOfChannels: ch,
        length: len,
        copyToChannel: vi.fn(),
      })),
    } as unknown as AudioContext;

    const sb = new AudioStreamingBuffer(fakeCtx, new Uint8Array([1, 2, 3, 4]).buffer);
    await sb.initialize();
    await sb.decodeSegment(0, 300);
    expect(sb.duration).toBeCloseTo(realDuration, 3);
    expect(sb.sampleRate).toBe(48000);
  });

  // ── SE-11: smoothParam uses cancelAndHoldAtTime ──

  it('SE-11: smoothParam calls cancelAndHoldAtTime before setTargetAtTime', () => {
    const order: string[] = [];
    const param = {
      value: 0.2,
      cancelAndHoldAtTime: vi.fn(() => order.push('cancelAndHoldAtTime')),
      cancelScheduledValues: vi.fn(() => order.push('cancelScheduledValues')),
      setValueAtTime: vi.fn(() => order.push('setValueAtTime')),
      setTargetAtTime: vi.fn(() => order.push('setTargetAtTime')),
    } as unknown as AudioParam;
    const ctx = { currentTime: 1.5 } as AudioContext;

    smoothParam(param, 0.8, ctx, 0.012);
    expect(order).toEqual(['cancelAndHoldAtTime', 'setTargetAtTime']);
  });

  it('SE-11: smoothParam falls back to cancelScheduledValues + setValueAtTime when cancelAndHoldAtTime is missing', () => {
    const order: string[] = [];
    const param = {
      value: 0.2,
      cancelScheduledValues: vi.fn(() => order.push('cancelScheduledValues')),
      setValueAtTime: vi.fn(() => order.push('setValueAtTime')),
      setTargetAtTime: vi.fn(() => order.push('setTargetAtTime')),
    } as unknown as AudioParam;
    const ctx = { currentTime: 2.0 } as AudioContext;

    smoothParam(param, 0.9, ctx, 0.012);
    expect(order).toEqual(['cancelScheduledValues', 'setValueAtTime', 'setTargetAtTime']);
  });
});
