/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Native Audio Bridge (Renderer Side)
//
// Provides a type-safe interface to communicate with the
// mixi-native N-API addon running in the Electron main process.
//
// When running in the browser (web version), all methods
// gracefully return fallback values — no errors thrown.
// ─────────────────────────────────────────────────────────────

export interface NativeAudioDevice {
  id: string;
  name: string;
  maxChannels: number;
  defaultSampleRate: number;
  isDefault: boolean;
}

interface NativeAudioAPI {
  isAvailable: () => Promise<boolean>;
  getHostName: () => Promise<string>;
  getDevices: () => Promise<NativeAudioDevice[]>;
  openStream: (args: {
    deviceIndex: number;
    sampleRate: number;
    bufferSize: number;
    ringBuffer: SharedArrayBuffer;
    ringCapacityFrames: number;
    ringChannels: number;
  }) => Promise<void>;
  closeStream: () => Promise<void>;
}

/** Check if we're running inside Electron with native audio support. */
function getNativeAudioAPI(): NativeAudioAPI | null {
  const w = window as any;
  if (w?.mixi?.nativeAudio) {
    return w.mixi.nativeAudio as NativeAudioAPI;
  }
  return null;
}

/**
 * NativeAudioBridge — Zero-copy audio output via cpal.
 *
 * Usage:
 *   const bridge = NativeAudioBridge.getInstance();
 *   if (await bridge.isAvailable()) {
 *     const devices = await bridge.getDevices();
 *     await bridge.openStream(0, 44100, 128, sharedBuffer, 4096, 2);
 *   }
 */
export class NativeAudioBridge {
  private static instance: NativeAudioBridge | null = null;
  private api: NativeAudioAPI | null;

  private constructor() {
    this.api = getNativeAudioAPI();
  }

  static getInstance(): NativeAudioBridge {
    if (!NativeAudioBridge.instance) {
      NativeAudioBridge.instance = new NativeAudioBridge();
    }
    return NativeAudioBridge.instance;
  }

  /** Whether the native audio addon is loaded and hardware is available. */
  async isAvailable(): Promise<boolean> {
    if (!this.api) return false;
    try {
      return await this.api.isAvailable();
    } catch {
      return false;
    }
  }

  /** Get the audio host backend name (CoreAudio, WASAPI, ALSA). */
  async getHostName(): Promise<string> {
    if (!this.api) return 'WebAudio';
    return this.api.getHostName();
  }

  /** Enumerate available audio output devices. */
  async getDevices(): Promise<NativeAudioDevice[]> {
    if (!this.api) return [];
    return this.api.getDevices();
  }

  /**
   * Open a native audio output stream.
   *
   * @param deviceIndex — Device index from getDevices()
   * @param sampleRate — e.g. 44100
   * @param bufferSize — e.g. 128 (frames per callback)
   * @param ringBuffer — SharedArrayBuffer (SPSC ring)
   * @param ringCapacityFrames — Ring capacity in frames
   * @param ringChannels — 2 for stereo, 4 for master+cue
   */
  async openStream(
    deviceIndex: number,
    sampleRate: number,
    bufferSize: number,
    ringBuffer: SharedArrayBuffer,
    ringCapacityFrames: number,
    ringChannels: number,
  ): Promise<void> {
    if (!this.api) throw new Error('Native audio not available');
    return this.api.openStream({
      deviceIndex,
      sampleRate,
      bufferSize,
      ringBuffer,
      ringCapacityFrames,
      ringChannels,
    });
  }

  /** Close the active native audio stream. */
  async closeStream(): Promise<void> {
    if (!this.api) return;
    return this.api.closeStream();
  }
}
