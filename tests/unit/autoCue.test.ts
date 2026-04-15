import { describe, it, expect, vi } from 'vitest';
import { findAutoCuePoint } from '../../src/audio/autoCue';

/**
 * Create a mock AudioBuffer with energy at specific beat positions.
 * @param sr         – Sample rate
 * @param durationS  – Total duration in seconds
 * @param bpm        – Track BPM
 * @param offset     – First beat offset
 * @param energyBeats – Beat numbers that have energy (rest is silence)
 */
function makeMockBuffer(
  sr: number,
  durationS: number,
  bpm: number,
  offset: number,
  energyBeats: number[],
): AudioBuffer {
  const length = Math.ceil(sr * durationS);
  const data = new Float32Array(length);
  const beatPeriod = 60 / bpm;

  for (const beatNum of energyBeats) {
    const beatTime = offset + beatNum * beatPeriod;
    const startSample = Math.max(0, Math.floor((beatTime - 0.005) * sr));
    const endSample = Math.min(length, Math.ceil((beatTime + 0.050) * sr));
    // Fill with a kick-like signal (amplitude 0.5)
    for (let i = startSample; i < endSample; i++) {
      data[i] = 0.5 * Math.sin(2 * Math.PI * 80 * (i - startSample) / sr);
    }
  }

  return {
    duration: durationS,
    length,
    sampleRate: sr,
    numberOfChannels: 1,
    getChannelData: vi.fn().mockReturnValue(data),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

describe('Auto-Cue — Grid-Snapped First Downbeat', () => {
  const SR = 44100;
  const BPM = 128;
  const OFFSET = 0.1; // first beat at 100ms
  const BEAT_PERIOD = 60 / BPM;

  it('finds the first energetic beat and snaps to nearest downbeat', () => {
    // Energy starts at beat 3 → should snap to downbeat 4 (beat 0 of bar 2)
    const buffer = makeMockBuffer(SR, 30, BPM, OFFSET, [3, 4, 5, 6, 7, 8]);
    const cue = findAutoCuePoint(buffer, BPM, OFFSET);

    // Beat 3 is close to downbeat 4, so it should snap to 4
    const expectedDownbeat = OFFSET + 4 * BEAT_PERIOD;
    expect(cue).toBeCloseTo(expectedDownbeat, 2);
  });

  it('returns first beat offset when track starts on a downbeat', () => {
    // Energy from beat 0 (which IS a downbeat)
    const buffer = makeMockBuffer(SR, 30, BPM, OFFSET, [0, 1, 2, 3, 4]);
    const cue = findAutoCuePoint(buffer, BPM, OFFSET);
    expect(cue).toBeCloseTo(OFFSET, 2);
  });

  it('skips silent intro and finds the first energetic downbeat', () => {
    // 16 beats of silence, then energy from beat 16 onward
    const beats = Array.from({ length: 32 }, (_, i) => 16 + i);
    const buffer = makeMockBuffer(SR, 60, BPM, OFFSET, beats);
    const cue = findAutoCuePoint(buffer, BPM, OFFSET);

    // Beat 16 is a downbeat (16 % 4 === 0)
    const expected = OFFSET + 16 * BEAT_PERIOD;
    expect(cue).toBeCloseTo(expected, 2);
  });

  it('handles fully silent track → returns firstBeatOffset', () => {
    const buffer = makeMockBuffer(SR, 30, BPM, OFFSET, []);
    const cue = findAutoCuePoint(buffer, BPM, OFFSET);
    expect(cue).toBeCloseTo(OFFSET, 5);
  });

  it('handles zero BPM → returns firstBeatOffset', () => {
    const buffer = makeMockBuffer(SR, 30, 0, OFFSET, [0, 1, 2]);
    const cue = findAutoCuePoint(buffer, 0, OFFSET);
    expect(cue).toBe(OFFSET);
  });

  it('cue point is never negative', () => {
    // Very early offset
    const buffer = makeMockBuffer(SR, 30, BPM, 0.0, [0, 1, 2, 3, 4]);
    const cue = findAutoCuePoint(buffer, BPM, 0.0);
    expect(cue).toBeGreaterThanOrEqual(0);
  });

  it('finds downbeat when first energy is on an offbeat', () => {
    // Energy only at beat 1 (offbeat) — nearest downbeat is 0 or 4
    // Beat 1 is within 1 beat of downbeat 0, which is < SNAP_TOLERANCE?
    // Actually snap tolerance is 100ms time, so beat 1 at 128BPM is ~468ms away → too far
    // Should search forward to next downbeat (beat 4)
    const buffer = makeMockBuffer(SR, 30, BPM, OFFSET, [1, 4, 5, 6, 7, 8]);
    const cue = findAutoCuePoint(buffer, BPM, OFFSET);

    // Beat 1 is far from downbeat 0 (468ms > 100ms) → searches forward
    // Next downbeat with energy is beat 4
    const expected4 = OFFSET + 4 * BEAT_PERIOD;
    expect(cue).toBeCloseTo(expected4, 2);
  });

  it('works with different BPMs', () => {
    const bpm = 174; // DnB
    const buffer = makeMockBuffer(SR, 30, bpm, OFFSET, [0, 1, 2, 3, 4, 5]);
    const cue = findAutoCuePoint(buffer, bpm, OFFSET);

    // Beat 0 is a downbeat with energy → should find it
    expect(cue).toBeCloseTo(OFFSET, 2);
  });
});
