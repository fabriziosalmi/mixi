import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Blackboard } from '../../src/ai/Blackboard';
import type { DeckState } from '../../src/types';
import { LoopRollBuildupIntent, resetLoopRollState } from '../../src/ai/intents/LoopRollBuildupIntent';
import { DoubleDropAlignIntent } from '../../src/ai/intents/DoubleDropAlignIntent';
import { BuildUpTensionIntent, resetBuildUpTensionState } from '../../src/ai/intents/BuildUpTensionIntent';
import { EqAmnesiaIntent, resetEqAmnesiaState } from '../../src/ai/intents/EqAmnesiaIntent';
import { IsolatorSweepIntent, resetIsolatorSweepState } from '../../src/ai/intents/IsolatorSweepIntent';
import { FilterWashoutIntent } from '../../src/ai/intents/FilterWashoutIntent';
import { LpfMudDiveIntent } from '../../src/ai/intents/LpfMudDiveIntent';
import { FilterWobbleIntent } from '../../src/ai/intents/FilterWobbleIntent';
import { AudioStreamingBuffer } from '../../src/audio/AudioStreamingBuffer';

function makeDeck(overrides: Partial<DeckState> = {}): DeckState {
  return {
    id: 'A',
    isTrackLoaded: true,
    trackName: 'Test',
    isPlaying: true,
    duration: 240,
    bpm: 140,
    originalBpm: 140,
    bpmConfidence: 1,
    firstBeatOffset: 0,
    playbackRate: 1,
    volume: 1,
    gain: 0,
    eq: { high: 0, mid: 0, low: 0 },
    colorFx: 0,
    isSynced: false,
    cueActive: false,
    quantize: true,
    keyLock: false,
    slipMode: false,
    activeLoop: null,
    hotCues: [null, null, null, null, null, null, null, null],
    musicalKey: '8A',
    dropBeats: [],
    ...overrides,
  } as DeckState;
}

function makeBb(overrides: Partial<Blackboard> = {}): Blackboard {
  const masterState = overrides.masterState ?? makeDeck({ id: 'A', bpm: 140, originalBpm: 140 });
  const incomingState = overrides.incomingState ?? makeDeck({ id: 'B', bpm: 140, originalBpm: 128, playbackRate: 140 / 128 });
  return {
    tick: 100,
    timestamp: 1000,
    masterDeck: 'A',
    incomingDeck: 'B',
    masterState,
    masterCurrentTime: 60,
    masterCurrentBeat: 120,
    masterTotalBeats: 560,
    beatsToOutroMaster: 20,
    beatsToEndMaster: 40,
    masterBpm: 140,
    masterBeatPeriod: 60 / 140,
    incomingState,
    incomingCurrentTime: 10,
    incomingCurrentBeat: 20,
    incomingBpm: 140,
    incomingIsReady: true,
    bothPlaying: true,
    isPhaseAligned: true,
    phaseDeltaMs: 0,
    bassClash: false,
    midClash: false,
    masterHasLoop: false,
    deadAirImminent: false,
    masterBeatInPhrase: 4,
    masterBeatsToPhrase: 12,
    incomingBeatInPhrase: 4,
    masterOnDownbeat: false,
    isBlending: true,
    incomingBassKilled: true,
    masterBassKilled: false,
    masterBassKilledTicks: 0,
    incomingBassKilledTicks: 0,
    masterHasFilter: false,
    masterDropBeat: null,
    incomingDropBeat: null,
    beatsToIncomingDrop: null,
    masterKey: '8A',
    incomingKey: '8A',
    isHarmonicMatch: true,
    crossfader: 0.5,
    masterVolume: 1,
    ...overrides,
  };
}

function makeMockStore() {
  return {
    setAutoLoop: vi.fn(),
    exitLoop: vi.fn(),
    setDeckPlaybackRate: vi.fn(),
    setDeckColorFx: vi.fn(),
    setDeckEq: vi.fn(),
    setDeckVolume: vi.fn(),
  } as any;
}

describe('Wave A Audit Regression Suite', () => {
  beforeEach(() => {
    resetLoopRollState();
    resetBuildUpTensionState();
    resetEqAmnesiaState();
    resetIsolatorSweepState();
  });

  it('AUD-04: LoopRollBuildupIntent progresses on wall-clock beats and exits loop instead of trapping forever', () => {
    const store = makeMockStore();
    const beatMs = (60 / 120) * 1000; // 500ms per beat
    // Start at btp = 12 beats
    const bbStart = makeBb({
      timestamp: 0,
      masterBpm: 120,
      masterBeatPeriod: 0.5,
      masterBeatsToPhrase: 12,
      beatsToOutroMaster: 20,
      beatsToEndMaster: 40,
    });
    expect(LoopRollBuildupIntent.evaluate(bbStart)).toBeGreaterThan(0);
    LoopRollBuildupIntent.execute(bbStart, store);
    expect(store.setAutoLoop).toHaveBeenCalledWith('A', 4);

    // Simulate 11.7 beats elapsed in wall-clock while masterBeatsToPhrase is FROZEN at 12 due to the 4-beat loop
    const bbEnd = makeBb({
      timestamp: 11.7 * beatMs,
      masterBpm: 120,
      masterBeatPeriod: 0.5,
      masterBeatsToPhrase: 12,
      masterHasLoop: true,
      masterState: makeDeck({ activeLoop: { start: 10, end: 12, lengthInBeats: 4 } }),
      beatsToEndMaster: 40,
    });
    expect(LoopRollBuildupIntent.evaluate(bbEnd)).toBeGreaterThan(0);
    LoopRollBuildupIntent.execute(bbEnd, store);
    expect(store.exitLoop).toHaveBeenCalledWith('A');
  });

  it('AUD-05: DoubleDropAlignIntent clamps and restores around synced baseRate (not hardcoded 1.0)', () => {
    const store = makeMockStore();
    const syncedRate = 140 / 128; // 1.09375
    const bb = makeBb({
      masterBpm: 140,
      masterCurrentBeat: 100,
      masterDropBeat: 132, // 32 beats to master drop
      incomingDropBeat: 56,
      beatsToIncomingDrop: 36, // 4 beats misalignment
      incomingState: makeDeck({ id: 'B', bpm: 140, originalBpm: 128, playbackRate: syncedRate }),
    });
    expect(DoubleDropAlignIntent.evaluate(bb)).toBeGreaterThan(0);
    DoubleDropAlignIntent.execute(bb, store);
    expect(store.setDeckPlaybackRate).toHaveBeenCalledTimes(1);
    const appliedRate = store.setDeckPlaybackRate.mock.calls[0][1];
    // Must stay within ±2% of syncedRate (~1.072..1.116), NEVER slammed down to 1.02!
    expect(appliedRate).toBeGreaterThan(1.07);
    expect(appliedRate).toBeLessThan(1.12);
  });

  it('AUD-10: BuildUpTensionIntent keeps ownership past 0.3 colorFx and resets filters to 0 at drop', () => {
    const store = makeMockStore();
    const bbMid = makeBb({ beatsToIncomingDrop: 10, masterHasFilter: false });
    expect(BuildUpTensionIntent.evaluate(bbMid)).toBeGreaterThan(0);
    BuildUpTensionIntent.execute(bbMid, store);
    expect(store.setDeckColorFx).toHaveBeenCalled();

    // Next tick: masterHasFilter is now true because WE moved colorFx > 0.3
    const bbLate = makeBb({ beatsToIncomingDrop: 5, masterHasFilter: true });
    expect(BuildUpTensionIntent.evaluate(bbLate)).toBeGreaterThan(0);
    BuildUpTensionIntent.execute(bbLate, store);

    // Drop hits (< 4 beats): must score and reset both decks to 0
    const bbDrop = makeBb({ beatsToIncomingDrop: 3.5, masterHasFilter: true });
    expect(BuildUpTensionIntent.evaluate(bbDrop)).toBeGreaterThan(0);
    BuildUpTensionIntent.execute(bbDrop, store);
    expect(store.setDeckColorFx).toHaveBeenLastCalledWith('B', 0);
  });

  it('AUD-10: EqAmnesiaIntent continues recovering bass past -15 dB all the way to 0 dB', () => {
    const store = makeMockStore();
    const bbStart = makeBb({
      bothPlaying: false,
      isBlending: false,
      masterBassKilled: true,
      masterBassKilledTicks: 40,
      masterState: makeDeck({ eq: { high: 0, mid: 0, low: -16 } }),
    });
    expect(EqAmnesiaIntent.evaluate(bbStart)).toBeGreaterThan(0);
    EqAmnesiaIntent.execute(bbStart, store);
    expect(store.setDeckEq).toHaveBeenCalledWith('A', 'low', -15);

    // Next tick: eq.low is now -15 so masterBassKilled is false, yet recovery must continue!
    const bbNext = makeBb({
      bothPlaying: false,
      isBlending: false,
      masterBassKilled: false,
      masterBassKilledTicks: 0,
      masterState: makeDeck({ eq: { high: 0, mid: 0, low: -15 } }),
    });
    expect(EqAmnesiaIntent.evaluate(bbNext)).toBeGreaterThan(0);
    EqAmnesiaIntent.execute(bbNext, store);
    expect(store.setDeckEq).toHaveBeenCalledWith('A', 'low', -14);
  });

  it('AUD-10: IsolatorSweepIntent keeps ownership after EQ drops below -3 dB', () => {
    const store = makeMockStore();
    const bb1 = makeBb({
      tick: 5000,
      bothPlaying: false,
      masterBeatsToPhrase: 6,
      masterState: makeDeck({ eq: { high: 0, mid: 0, low: 0 } }),
    });
    expect(IsolatorSweepIntent.evaluate(bb1)).toBeGreaterThan(0);
    IsolatorSweepIntent.execute(bb1, store);

    // Next tick: EQ is now -6 dB (beyond initial ±3 dB entry guard)
    const bb2 = makeBb({
      tick: 5001,
      bothPlaying: false,
      masterBeatsToPhrase: 4,
      masterState: makeDeck({ eq: { high: -6, mid: -6, low: -6 } }),
    });
    expect(IsolatorSweepIntent.evaluate(bb2)).toBeGreaterThan(0);
  });

  it('AUD-14: Conflicting colorFx dynamics intents are mutually exclusive', () => {
    expect(FilterWashoutIntent.exclusive).toBe(true);
    expect(LpfMudDiveIntent.exclusive).toBe(true);
    expect(FilterWobbleIntent.exclusive).toBe(true);
  });

  it('AUD-19: AudioStreamingBuffer handles odd-sized RIFF metadata chunk and WAVE_FORMAT_EXTENSIBLE (0xFFFE)', async () => {
    // Build a valid WAV with:
    // - 12-byte RIFF header
    // - JUNK chunk with odd size = 5 (+ 1 pad byte = 14 bytes total)
    // - fmt  chunk (40 bytes, WAVE_FORMAT_EXTENSIBLE 0xFFFE with SubFormat = 3 IEEE float)
    // - data chunk (16 bytes = 2 stereo f32 frames)
    const totalSize = 12 + (8 + 5 + 1) + (8 + 40) + (8 + 16);
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    let p = 0;

    view.setUint32(p, 0x52494646, false); p += 4; // RIFF
    view.setUint32(p, totalSize - 8, true); p += 4;
    view.setUint32(p, 0x57415645, false); p += 4; // WAVE

    // Odd-sized JUNK chunk (5 bytes + 1 word-alignment pad byte)
    view.setUint32(p, 0x4a554e4b, false); p += 4; // JUNK
    view.setUint32(p, 5, true); p += 4;
    p += 6; // 5 payload + 1 pad

    // fmt  chunk (40 bytes, extensible)
    view.setUint32(p, 0x666d7420, false); p += 4; // fmt 
    view.setUint32(p, 40, true); p += 4;
    const fmtStart = p;
    view.setUint16(fmtStart, 0xfffe, true); // WAVE_FORMAT_EXTENSIBLE
    view.setUint16(fmtStart + 2, 2, true); // stereo
    view.setUint32(fmtStart + 4, 48000, true); // 48 kHz
    view.setUint32(fmtStart + 8, 48000 * 8, true);
    view.setUint16(fmtStart + 12, 8, true);
    view.setUint16(fmtStart + 14, 32, true); // 32-bit
    view.setUint16(fmtStart + 24, 3, true); // SubFormat = 3 (IEEE float)
    p += 40;

    // data chunk
    view.setUint32(p, 0x64617461, false); p += 4; // data
    view.setUint32(p, 16, true); p += 4;

    const fakeCtx = {} as AudioContext;
    const stream = new AudioStreamingBuffer(fakeCtx, buf);
    await stream.initialize();

    expect(stream.sampleRate).toBe(48000);
    expect(stream.channels).toBe(2);
    expect(stream.duration).toBeCloseTo(2 / 48000, 8);
  });
});
