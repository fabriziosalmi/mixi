/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

import { parseBlob } from 'music-metadata';

export class AudioStreamingBuffer {
  private ctx: AudioContext;
  public rawData: ArrayBuffer;

  // Format info
  public isWav = false;
  public duration = 0;
  public sampleRate = 44100;
  public channels = 2;
  public bitsPerSample = 16;
  public dataOffset = 44;
  public dataSize = 0;

  // Segment cache
  private cache = new Map<number, AudioBuffer>();

  constructor(ctx: AudioContext, rawData: ArrayBuffer) {
    this.ctx = ctx;
    this.rawData = rawData;
  }

  async initialize(): Promise<void> {
    if (this.rawData.byteLength > 12) {
      const view = new DataView(this.rawData);
      // Verify WAV (RIFF...WAVE)
      const isRiff = view.getUint32(0, true) === 0x46464952;
      const isWave = view.getUint32(8, true) === 0x45564157;

      if (isRiff && isWave) {
        this.isWav = true;
        let pos = 12;
        let fmtOffset = -1;

        while (pos + 8 <= this.rawData.byteLength) {
          const chunkId = view.getUint32(pos, false);
          const chunkSize = view.getUint32(pos + 4, true);

          if (chunkId === 0x666d7420) { // "fmt "
            fmtOffset = pos + 8;
          } else if (chunkId === 0x64617461) { // "data"
            this.dataOffset = pos + 8;
            this.dataSize = chunkSize;
            break;
          }
          pos += 8 + chunkSize;
        }

        if (fmtOffset !== -1 && this.dataSize > 0) {
          this.channels = view.getUint16(fmtOffset + 2, true);
          this.sampleRate = view.getUint32(fmtOffset + 4, true);
          this.bitsPerSample = view.getUint16(fmtOffset + 14, true);

          const bytesPerFrame = this.channels * (this.bitsPerSample / 8);
          if (bytesPerFrame > 0 && this.sampleRate > 0) {
            this.duration = this.dataSize / bytesPerFrame / this.sampleRate;
          }
        }
      }
    }

    // Fallback: Parse non-WAV formats using music-metadata
    if (this.duration <= 0) {
      try {
        const blob = new Blob([this.rawData]);
        const metadata = await parseBlob(blob);
        this.duration = metadata.format.duration ?? 0;
        this.sampleRate = metadata.format.sampleRate ?? 44100;
        this.channels = metadata.format.numberOfChannels ?? 2;
      } catch {
        // Safe default fallbacks
        this.duration = 180;
        this.sampleRate = 44100;
        this.channels = 2;
      }
    }
  }

  /**
   * Decodes a specific segment of the track.
   * Returns a promise of the decoded AudioBuffer.
   */
  async decodeSegment(startSec: number, durationSec: number): Promise<AudioBuffer> {
    const roundedStart = Math.max(0, Math.floor(startSec));
    const cacheKey = roundedStart;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let buffer: AudioBuffer;

    if (this.isWav) {
      const bytesPerFrame = this.channels * (this.bitsPerSample / 8);
      const startFrame = Math.floor(roundedStart * this.sampleRate);
      const totalFrames = Math.floor(this.duration * this.sampleRate);
      const numFrames = Math.min(
        totalFrames - startFrame,
        Math.floor(durationSec * this.sampleRate)
      );

      if (numFrames <= 0) {
        return this.ctx.createBuffer(this.channels, 128, this.sampleRate);
      }

      const pcmStartByte = this.dataOffset + startFrame * bytesPerFrame;
      const pcmByteLength = numFrames * bytesPerFrame;
      const safePcmByteLength = Math.min(
        this.rawData.byteLength - pcmStartByte,
        pcmByteLength
      );

      if (safePcmByteLength <= 0) {
        return this.ctx.createBuffer(this.channels, 128, this.sampleRate);
      }

      const pcmSlice = this.rawData.slice(pcmStartByte, pcmStartByte + safePcmByteLength);

      // Reconstruct temporary WAV container
      const fmtSize = 16;
      const headerSize = 28 + fmtSize;
      const wavBuffer = new ArrayBuffer(headerSize + pcmSlice.byteLength);
      const wavView = new DataView(wavBuffer);

      wavView.setUint32(0, 0x52494646, false); // "RIFF"
      wavView.setUint32(4, headerSize + pcmSlice.byteLength - 8, true);
      wavView.setUint32(8, 0x57415645, false); // "WAVE"
      wavView.setUint32(12, 0x666d7420, false); // "fmt "
      wavView.setUint32(16, fmtSize, true);

      // Copy formatting data from original if possible, otherwise write standard PCM
      wavView.setUint16(20, 1, true); // PCM format
      wavView.setUint16(22, this.channels, true);
      wavView.setUint32(24, this.sampleRate, true);
      wavView.setUint32(28, this.sampleRate * this.channels * (this.bitsPerSample / 8), true);
      wavView.setUint16(32, this.channels * (this.bitsPerSample / 8), true);
      wavView.setUint16(34, this.bitsPerSample, true);

      // data chunk
      const dataHeaderOffset = 20 + fmtSize;
      wavView.setUint32(dataHeaderOffset, 0x64617461, false); // "data"
      wavView.setUint32(dataHeaderOffset + 4, pcmSlice.byteLength, true);

      // Copy PCM bytes
      new Uint8Array(wavBuffer, headerSize).set(new Uint8Array(pcmSlice));

      try {
        buffer = await this.ctx.decodeAudioData(wavBuffer);
      } catch {
        // Fallback: create silent buffer
        buffer = this.ctx.createBuffer(this.channels, numFrames, this.sampleRate);
      }
    } else {
      // Non-WAV: Decode full track into cache on first request
      if (this.cache.has(-1)) {
        const fullBuffer = this.cache.get(-1)!;
        return this.sliceAudioBuffer(fullBuffer, roundedStart, durationSec);
      }

      try {
        const fullBuffer = await this.ctx.decodeAudioData(this.rawData.slice(0));
        this.cache.set(-1, fullBuffer);
        return this.sliceAudioBuffer(fullBuffer, roundedStart, durationSec);
      } catch {
        buffer = this.ctx.createBuffer(
          this.channels,
          Math.floor(durationSec * this.sampleRate),
          this.sampleRate
        );
      }
    }

    this.cache.set(cacheKey, buffer);

    // Keep cache size bounded (max 5 segments)
    if (this.cache.size > 5) {
      for (const key of this.cache.keys()) {
        if (key !== cacheKey && key !== -1) {
          this.cache.delete(key);
          break;
        }
      }
    }

    return buffer;
  }

  private sliceAudioBuffer(
    fullBuffer: AudioBuffer,
    startSec: number,
    durationSec: number
  ): AudioBuffer {
    const startSample = Math.floor(startSec * fullBuffer.sampleRate);
    const numSamples = Math.min(
      fullBuffer.length - startSample,
      Math.floor(durationSec * fullBuffer.sampleRate)
    );

    if (numSamples <= 0) {
      return this.ctx.createBuffer(
        fullBuffer.numberOfChannels,
        128,
        fullBuffer.sampleRate
      );
    }

    const slice = this.ctx.createBuffer(
      fullBuffer.numberOfChannels,
      numSamples,
      fullBuffer.sampleRate
    );
    for (let ch = 0; ch < fullBuffer.numberOfChannels; ch++) {
      const data = fullBuffer.getChannelData(ch).subarray(
        startSample,
        startSample + numSamples
      );
      slice.copyToChannel(data, ch);
    }
    return slice;
  }

  /**
   * Release all decoded segment buffers — including the full-track decode
   * cached under key -1 (~105MB for a 5-min non-WAV track). Call on eject so
   * the memory is freed immediately instead of waiting for the next load.
   */
  dispose(): void {
    this.cache.clear();
  }
}
