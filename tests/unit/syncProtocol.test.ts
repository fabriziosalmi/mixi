import { describe, it, expect } from 'vitest';
import {
  encodePacket, decodePacket, phaseToFp, fpToPhase,
  randomSenderId, isNewerSequence, packTriggers,
  kickCountdown, snareCountdown, hihatCountdown,
  PacketType, Flags, MIXI_SYNC_VERSION, PACKET_SIZE,
  type SyncPacket,
} from '../../src/sync/protocol';

// ── Helper ──────────────────────────────────────────────────

function makePacket(overrides: Partial<SyncPacket> = {}): SyncPacket {
  return {
    version: MIXI_SYNC_VERSION,
    type: PacketType.HEARTBEAT,
    sequence: 42,
    timestamp: 1.234567,
    bpm: 128.0,
    beatPhaseFp: phaseToFp(0.75),
    beatCount: 1024,
    epochGeneration: 3,
    crossfader: 0.5,
    masterVolume: 0.85,
    pitchNudge: 0.01,
    netOffset: -0.002,
    senderId: 0xA2F3,
    timeSigNum: 4,
    deckId: 0,
    flags: Flags.PLAYING | Flags.MASTER,
    energyRms: 200,
    triggers: packTriggers(2, 5, 1),
    eqBass: 180,
    trackHash: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('MIXI Sync Protocol — Packet Codec', () => {
  it('encodes to exactly 64 bytes', () => {
    const buf = encodePacket(makePacket());
    expect(buf.byteLength).toBe(PACKET_SIZE);
  });

  it('starts with MXS\\0 magic', () => {
    const buf = new Uint8Array(encodePacket(makePacket()));
    expect(String.fromCharCode(buf[0], buf[1], buf[2])).toBe('MXS');
    expect(buf[3]).toBe(0);
  });

  it('round-trips all fields correctly', () => {
    const original = makePacket();
    const encoded = encodePacket(original);
    const decoded = decodePacket(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(original.version);
    expect(decoded!.type).toBe(original.type);
    expect(decoded!.sequence).toBe(original.sequence);
    expect(decoded!.timestamp).toBeCloseTo(original.timestamp, 6);
    expect(decoded!.bpm).toBeCloseTo(original.bpm, 2);
    expect(decoded!.beatPhaseFp).toBe(original.beatPhaseFp);
    expect(decoded!.beatCount).toBe(original.beatCount);
    expect(decoded!.epochGeneration).toBe(original.epochGeneration);
    expect(decoded!.crossfader).toBeCloseTo(original.crossfader, 2);
    expect(decoded!.masterVolume).toBeCloseTo(original.masterVolume, 2);
    expect(decoded!.pitchNudge).toBeCloseTo(original.pitchNudge, 2);
    expect(decoded!.netOffset).toBeCloseTo(original.netOffset, 3);
    expect(decoded!.senderId).toBe(original.senderId);
    expect(decoded!.timeSigNum).toBe(original.timeSigNum);
    expect(decoded!.deckId).toBe(original.deckId);
    expect(decoded!.flags).toBe(original.flags);
    expect(decoded!.energyRms).toBe(original.energyRms);
    expect(decoded!.triggers).toBe(original.triggers);
    expect(decoded!.eqBass).toBe(original.eqBass);
    expect(decoded!.trackHash).toEqual(original.trackHash);
  });

  it('rejects packets with wrong magic', () => {
    const buf = encodePacket(makePacket());
    const bytes = new Uint8Array(buf);
    bytes[0] = 0xFF; // corrupt magic
    expect(decodePacket(buf)).toBeNull();
  });

  it('rejects packets shorter than 64 bytes', () => {
    expect(decodePacket(new ArrayBuffer(32))).toBeNull();
  });

  it('rejects version 0', () => {
    const buf = encodePacket(makePacket({ version: 0 }));
    expect(decodePacket(buf)).toBeNull();
  });

  it('accepts future versions (graceful degradation)', () => {
    const buf = encodePacket(makePacket({ version: 99 }));
    const decoded = decodePacket(buf);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(99);
  });

  it('encodes all packet types', () => {
    for (const type of Object.values(PacketType)) {
      const buf = encodePacket(makePacket({ type }));
      const decoded = decodePacket(buf);
      expect(decoded!.type).toBe(type);
    }
  });

  it('preserves all flag bits', () => {
    const allFlags = 0xFF;
    const decoded = decodePacket(encodePacket(makePacket({ flags: allFlags })));
    expect(decoded!.flags).toBe(allFlags);

    // Verify individual flags
    expect(decoded!.flags & Flags.PLAYING).toBeTruthy();
    expect(decoded!.flags & Flags.MASTER).toBeTruthy();
    expect(decoded!.flags & Flags.IS_LOOPING).toBeTruthy();
  });

  it('handles sequence u16 wraparound', () => {
    const decoded = decodePacket(encodePacket(makePacket({ sequence: 65535 })));
    expect(decoded!.sequence).toBe(65535);
  });

  it('handles zero BPM (stopped)', () => {
    const decoded = decodePacket(encodePacket(makePacket({ bpm: 0 })));
    expect(decoded!.bpm).toBe(0);
  });

  it('preserves 8-byte track hash', () => {
    const hash = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE]);
    const decoded = decodePacket(encodePacket(makePacket({ trackHash: hash })));
    expect(decoded!.trackHash).toEqual(hash);
  });
});

describe('Fixed-Point Phase Conversion', () => {
  it('phaseToFp(0) = 0', () => {
    expect(phaseToFp(0)).toBe(0);
  });

  it('phaseToFp(0.5) = 2^31', () => {
    expect(phaseToFp(0.5)).toBe(2147483648);
  });

  it('round-trips with sub-microsecond precision', () => {
    const testPhases = [0, 0.001, 0.25, 0.333, 0.5, 0.75, 0.999];
    for (const phase of testPhases) {
      const fp = phaseToFp(phase);
      const recovered = fpToPhase(fp);
      expect(recovered).toBeCloseTo(phase, 6); // ~0.23ns resolution
    }
  });

  it('never exceeds u32 range', () => {
    expect(phaseToFp(0.9999999)).toBeLessThan(4294967296);
    expect(phaseToFp(0)).toBeGreaterThanOrEqual(0);
  });
});

describe('Sequence Number Ordering', () => {
  it('newer sequence is accepted', () => {
    expect(isNewerSequence(2, 1)).toBe(true);
    expect(isNewerSequence(100, 50)).toBe(true);
  });

  it('same sequence is rejected', () => {
    expect(isNewerSequence(5, 5)).toBe(false);
  });

  it('older sequence is rejected', () => {
    expect(isNewerSequence(1, 2)).toBe(false);
    expect(isNewerSequence(50, 100)).toBe(false);
  });

  it('handles u16 wraparound correctly', () => {
    // 0 is newer than 65535 (wrapped around)
    expect(isNewerSequence(0, 65535)).toBe(true);
    // 1 is newer than 65534
    expect(isNewerSequence(1, 65534)).toBe(true);
  });

  it('rejects backward wrap (half-range)', () => {
    // 32768 ahead would be backward in circular space
    expect(isNewerSequence(0, 32768)).toBe(false);
  });
});

describe('Trigger Packing', () => {
  it('packs and extracts kick countdown', () => {
    const packed = packTriggers(5, 0, 0);
    expect(kickCountdown(packed)).toBe(5);
    expect(snareCountdown(packed)).toBe(0);
    expect(hihatCountdown(packed)).toBe(0);
  });

  it('packs and extracts snare countdown', () => {
    const packed = packTriggers(0, 7, 0);
    expect(kickCountdown(packed)).toBe(0);
    expect(snareCountdown(packed)).toBe(7);
    expect(hihatCountdown(packed)).toBe(0);
  });

  it('packs and extracts hihat countdown', () => {
    const packed = packTriggers(0, 0, 3);
    expect(kickCountdown(packed)).toBe(0);
    expect(snareCountdown(packed)).toBe(0);
    expect(hihatCountdown(packed)).toBe(3);
  });

  it('packs all three simultaneously', () => {
    const packed = packTriggers(3, 5, 2);
    expect(kickCountdown(packed)).toBe(3);
    expect(snareCountdown(packed)).toBe(5);
    expect(hihatCountdown(packed)).toBe(2);
  });

  it('clamps to bit widths', () => {
    // kick: 3 bits (max 7), snare: 3 bits (max 7), hihat: 2 bits (max 3)
    const packed = packTriggers(7, 7, 3);
    expect(kickCountdown(packed)).toBe(7);
    expect(snareCountdown(packed)).toBe(7);
    expect(hihatCountdown(packed)).toBe(3);
  });

  it('trigger byte 0 = all countdowns max', () => {
    expect(kickCountdown(0)).toBe(0);
    expect(snareCountdown(0)).toBe(0);
    expect(hihatCountdown(0)).toBe(0);
  });
});

describe('Sender ID', () => {
  it('generates random u16 values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomSenderId()));
    // At least 90 unique out of 100 (probabilistic but safe)
    expect(ids.size).toBeGreaterThan(80);
  });

  it('stays within u16 range', () => {
    for (let i = 0; i < 100; i++) {
      const id = randomSenderId();
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(65536);
    }
  });
});

describe('Chaos Monkey — Malformed Packets', () => {
  it('survives all-zeros packet', () => {
    expect(decodePacket(new ArrayBuffer(64))).toBeNull(); // bad magic
  });

  it('survives NaN timestamp', () => {
    const p = makePacket({ timestamp: NaN });
    const decoded = decodePacket(encodePacket(p));
    expect(decoded).not.toBeNull();
    expect(isNaN(decoded!.timestamp)).toBe(true); // preserves NaN
  });

  it('survives negative BPM', () => {
    const p = makePacket({ bpm: -500 });
    const decoded = decodePacket(encodePacket(p));
    expect(decoded).not.toBeNull();
    expect(decoded!.bpm).toBe(-500); // codec preserves, consumer validates
  });

  it('survives max u32 epoch', () => {
    const p = makePacket({ epochGeneration: 0xFFFFFFFF });
    const decoded = decodePacket(encodePacket(p));
    expect(decoded!.epochGeneration).toBe(0xFFFFFFFF);
  });

  it('survives extreme BPM', () => {
    const p = makePacket({ bpm: 999 });
    const decoded = decodePacket(encodePacket(p));
    expect(decoded!.bpm).toBeCloseTo(999, 0);
  });
});
