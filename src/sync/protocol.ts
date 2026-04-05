/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// MIXI Sync Protocol — Packet Codec (v1.1)
//
// 64-byte cache-line-aligned binary packet.
// Fields ordered by descending alignment (f64, f32, u32, u16, u8).
// All multi-byte values little-endian.
// ─────────────────────────────────────────────────────────────

export const MIXI_SYNC_MAGIC = 0x0053584D; // "MXS\0" as u32 LE
export const MIXI_SYNC_PORT = 4303;
export const MIXI_SYNC_VERSION = 1;
export const PACKET_SIZE = 64;

// ── Packet Types ────────────────────────────────────────────

export const PacketType = {
  HEARTBEAT: 0x01,
  ANNOUNCE:  0x02,
  TRANSPORT: 0x03,
  CUE_POINT: 0x04,
  DECK_LOAD: 0x05,
  NTP_REQ:   0x06,
  NTP_RESP:  0x07,
  DICTATOR:  0x08,
  DYING:     0x09,
  CUSTOM:    0x10,
} as const;

export type PacketTypeValue = typeof PacketType[keyof typeof PacketType];

// ── Flags ───────────────────────────────────────────────────

export const Flags = {
  PLAYING:    0x01,
  MASTER:     0x02,
  SYNCED:     0x04,
  RECORDING:  0x08,
  VFX_ACTIVE: 0x10,
  NUDGING:    0x20,
  FLYWHEEL:   0x40,
  IS_LOOPING: 0x80,
} as const;

// ── Packet Structure ────────────────────────────────────────

export interface SyncPacket {
  // Header
  version: number;
  type: PacketTypeValue;
  sequence: number;

  // Timing (f64 first for alignment)
  timestamp: number;

  // Sync data (f32)
  bpm: number;
  crossfader: number;
  masterVolume: number;
  pitchNudge: number;
  netOffset: number;

  // Counters (u32)
  beatPhaseFp: number;   // fixed-point [0, 2^32)
  beatCount: number;
  epochGeneration: number;

  // Small fields (u16, u8)
  senderId: number;
  timeSigNum: number;
  deckId: number;        // 0=A, 1=B, 0xFF=master
  flags: number;
  energyRms: number;
  triggers: number;
  eqBass: number;

  // Track hash
  trackHash: Uint8Array; // 8 bytes
}

// ── Encode ──────────────────────────────────────────────────

export function encodePacket(p: SyncPacket): ArrayBuffer {
  const buf = new ArrayBuffer(PACKET_SIZE);
  const view = new DataView(buf);

  // magic "MXS\0"
  view.setUint8(0, 0x4D);  // M
  view.setUint8(1, 0x58);  // X
  view.setUint8(2, 0x53);  // S
  view.setUint8(3, 0x00);  // \0

  view.setUint8(4, p.version);
  view.setUint8(5, p.type);
  view.setUint16(6, p.sequence, true);

  // f64 — timestamp at offset 8
  view.setFloat64(8, p.timestamp, true);

  // f32 fields — offsets 16..47
  view.setFloat32(16, p.bpm, true);
  view.setUint32(20, p.beatPhaseFp, true);
  view.setUint32(24, p.beatCount, true);
  view.setUint32(28, p.epochGeneration, true);
  view.setFloat32(32, p.crossfader, true);
  view.setFloat32(36, p.masterVolume, true);
  view.setFloat32(40, p.pitchNudge, true);
  view.setFloat32(44, p.netOffset, true);

  // u16, u8 fields — offsets 48..55
  view.setUint16(48, p.senderId, true);
  view.setUint8(50, p.timeSigNum);
  view.setUint8(51, p.deckId);
  view.setUint8(52, p.flags);
  view.setUint8(53, p.energyRms);
  view.setUint8(54, p.triggers);
  view.setUint8(55, p.eqBass);

  // track hash — offsets 56..63
  const bytes = new Uint8Array(buf);
  bytes.set(p.trackHash.subarray(0, 8), 56);

  return buf;
}

// ── Decode ──────────────────────────────────────────────────

export function decodePacket(buf: ArrayBuffer): SyncPacket | null {
  if (buf.byteLength < PACKET_SIZE) return null;

  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Validate magic
  if (bytes[0] !== 0x4D || bytes[1] !== 0x58 || bytes[2] !== 0x53 || bytes[3] !== 0x00) {
    return null;
  }

  const version = view.getUint8(4);
  if (version === 0) return null;

  return {
    version,
    type: view.getUint8(5) as PacketTypeValue,
    sequence: view.getUint16(6, true),

    timestamp: view.getFloat64(8, true),

    bpm: view.getFloat32(16, true),
    beatPhaseFp: view.getUint32(20, true),
    beatCount: view.getUint32(24, true),
    epochGeneration: view.getUint32(28, true),
    crossfader: view.getFloat32(32, true),
    masterVolume: view.getFloat32(36, true),
    pitchNudge: view.getFloat32(40, true),
    netOffset: view.getFloat32(44, true),

    senderId: view.getUint16(48, true),
    timeSigNum: view.getUint8(50),
    deckId: view.getUint8(51),
    flags: view.getUint8(52),
    energyRms: view.getUint8(53),
    triggers: view.getUint8(54),
    eqBass: view.getUint8(55),

    trackHash: bytes.slice(56, 64),
  };
}

// ── Helpers ─────────────────────────────────────────────────

/** Convert float phase [0, 1) to fixed-point u32. */
export function phaseToFp(phase: number): number {
  return (phase * 4294967296) >>> 0;
}

/** Convert fixed-point u32 to float phase [0, 1). */
export function fpToPhase(fp: number): number {
  return (fp >>> 0) / 4294967296;
}

/** Generate a random sender ID (u16). */
export function randomSenderId(): number {
  return Math.floor(Math.random() * 65536);
}

/** Check if a sequence number is newer (handles u16 wraparound). */
export function isNewerSequence(incoming: number, last: number): boolean {
  const diff = (incoming - last) & 0xFFFF;
  return diff > 0 && diff < 32768;
}

/** Extract kick countdown from triggers byte (bits 0-2). */
export function kickCountdown(triggers: number): number { return triggers & 0x07; }

/** Extract snare countdown from triggers byte (bits 3-5). */
export function snareCountdown(triggers: number): number { return (triggers >> 3) & 0x07; }

/** Extract hihat countdown from triggers byte (bits 6-7). */
export function hihatCountdown(triggers: number): number { return (triggers >> 6) & 0x03; }

/** Pack onset countdowns into triggers byte. */
export function packTriggers(kick: number, snare: number, hihat: number): number {
  return (kick & 0x07) | ((snare & 0x07) << 3) | ((hihat & 0x03) << 6);
}
