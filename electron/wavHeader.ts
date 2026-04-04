/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – WAV Header Utility (IEEE 754 32-bit Float PCM)
//
// Generates and patches 44-byte WAV headers for crash-proof
// disk recording. Written with a sentinel data-size initially;
// patched on graceful stop or crash recovery.
// ─────────────────────────────────────────────────────────────

import { Buffer } from 'buffer';

export const WAV_HEADER_SIZE = 44;
export const WAV_DATA_SIZE_SENTINEL = 0xFFFFFFFF;

/**
 * Create a 44-byte WAV header for IEEE 754 32-bit float PCM.
 *
 * @param sampleRate  — e.g. 44100
 * @param channels    — e.g. 2 (stereo)
 * @param dataSizeBytes — size of PCM data in bytes, or WAV_DATA_SIZE_SENTINEL
 */
export function createWavHeader(
  sampleRate: number,
  channels: number,
  dataSizeBytes: number = WAV_DATA_SIZE_SENTINEL,
): Buffer {
  const bitsPerSample = 32;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  // RIFF chunk size = file size - 8 (excludes "RIFF" + size field itself)
  const riffSize = dataSizeBytes === WAV_DATA_SIZE_SENTINEL
    ? WAV_DATA_SIZE_SENTINEL
    : dataSizeBytes + WAV_HEADER_SIZE - 8;

  const buf = Buffer.alloc(WAV_HEADER_SIZE);

  // RIFF header
  buf.write('RIFF', 0, 'ascii');                     // ChunkID
  buf.writeUInt32LE(riffSize, 4);                     // ChunkSize
  buf.write('WAVE', 8, 'ascii');                      // Format

  // fmt sub-chunk
  buf.write('fmt ', 12, 'ascii');                     // Subchunk1ID
  buf.writeUInt32LE(16, 16);                          // Subchunk1Size (16 for PCM/float)
  buf.writeUInt16LE(3, 20);                           // AudioFormat: 3 = IEEE float
  buf.writeUInt16LE(channels, 22);                    // NumChannels
  buf.writeUInt32LE(sampleRate, 24);                  // SampleRate
  buf.writeUInt32LE(byteRate, 28);                    // ByteRate
  buf.writeUInt16LE(blockAlign, 32);                  // BlockAlign
  buf.writeUInt16LE(bitsPerSample, 34);               // BitsPerSample

  // data sub-chunk
  buf.write('data', 36, 'ascii');                     // Subchunk2ID
  buf.writeUInt32LE(dataSizeBytes, 40);               // Subchunk2Size

  return buf;
}

/**
 * Patch the WAV header size fields in-place via file descriptor.
 * Used on graceful recording stop and crash recovery.
 *
 * @param fd — open file descriptor (must be writable)
 * @param totalFileSize — total file size in bytes (including header)
 */
export function patchWavHeaderSize(
  fd: number,
  totalFileSize: number,
  fsModule: { writeSync: (fd: number, buf: Buffer, offset: number, length: number, position: number) => void },
): void {
  const dataSize = totalFileSize - WAV_HEADER_SIZE;
  const riffSize = totalFileSize - 8;

  const buf4 = Buffer.alloc(4);

  // Patch RIFF chunk size at offset 4
  buf4.writeUInt32LE(riffSize, 0);
  fsModule.writeSync(fd, buf4, 0, 4, 4);

  // Patch data sub-chunk size at offset 40
  buf4.writeUInt32LE(dataSize, 0);
  fsModule.writeSync(fd, buf4, 0, 4, 40);
}

/**
 * Check if a WAV file has the sentinel data-size (i.e. was not finalized).
 * Used for orphan detection on app startup.
 */
export function isOrphanWav(headerBytes: Buffer): boolean {
  if (headerBytes.length < WAV_HEADER_SIZE) return false;

  // Check RIFF/WAVE magic
  if (headerBytes.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (headerBytes.toString('ascii', 8, 12) !== 'WAVE') return false;

  // Check if data-size field is the sentinel
  const dataSize = headerBytes.readUInt32LE(40);
  return dataSize === WAV_DATA_SIZE_SENTINEL;
}
