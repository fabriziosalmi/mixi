/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

import { getAllSamples, saveSample, SampleEntity } from '../store/sampleDb';
import { log } from '../utils/logger';

export class SampleManager {
  private static instance: SampleManager;
  private audioCtx: AudioContext | null = null;
  
  // Decoded buffers kept in RAM for absolute zero-latency playback.
  private bufferCache: Map<string, AudioBuffer> = new Map();
  // Store the names to display them in the UI.
  private nameCache: Map<string, string> = new Map();
  private listeners: (() => void)[] = [];

  private constructor() {}

  public subscribe(fn: () => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  public static getInstance(): SampleManager {
    if (!SampleManager.instance) {
      SampleManager.instance = new SampleManager();
    }
    return SampleManager.instance;
  }

  /**
   * Supply the AudioContext to the SampleManager.
   * This is usually called by MixiEngine when the app boots or context starts.
   */
  public setContext(ctx: AudioContext) {
    this.audioCtx = ctx;
  }

  /**
   * Boot the SampleManager: fetches all samples from IndexedDB and decodes them into RAM.
   */
  public async boot(): Promise<void> {
    if (!this.audioCtx) {
      log.warn('SampleManager booted without AudioContext. Decoding will fail.', 'SampleManager');
      return;
    }
    
    try {
      const allSamples = await getAllSamples();
      const decodePromises = allSamples.map(async (sample) => {
        try {
          // slice(0) clones it so we don't accidentally consume/detach the array buffer
          const bufferCopy = sample.buffer.slice(0);
          const decoded = await this.audioCtx!.decodeAudioData(bufferCopy);
          this.bufferCache.set(sample.id, decoded);
          this.nameCache.set(sample.id, sample.name);
          log.info('SampleManager', `Loaded sample for pad ${sample.id}: ${sample.name}`);
        } catch (e) {
          log.error('SampleManager', `Failed to decode sample ${sample.id}: ${e}`);
        }
      });
      await Promise.all(decodePromises);
      this.notify();
      log.info('SampleManager', `Booted ${allSamples.length} samples into RAM.`);
    } catch (e) {
      log.error('SampleManager', `Failed to boot samples: ${e}`);
    }
  }

  /**
   * Retrieves a loaded AudioBuffer directly from RAM (zero-latency).
   */
  public getBuffer(id: string): AudioBuffer | undefined {
    return this.bufferCache.get(id);
  }

  /**
   * Retrieves the name of a loaded sample.
   */
  public getSampleName(id: string): string | undefined {
    return this.nameCache.get(id);
  }

  /**
   * Import a File (e.g. dropped by the user), save to IndexedDB, and decode to RAM.
   */
  public async importFile(id: string, file: File): Promise<void> {
    if (!this.audioCtx) {
      throw new Error('AudioContext missing. Cannot decode file.');
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // Save original binary to persistent storage
      const entity: SampleEntity = {
        id,
        name: file.name,
        buffer: arrayBuffer
      };
      await saveSample(entity);

      // Extract & Decode for immediate RAM usage
      const bufferCopy = arrayBuffer.slice(0);
      const decoded = await this.audioCtx.decodeAudioData(bufferCopy);
      
      this.bufferCache.set(id, decoded);
      this.nameCache.set(id, file.name);
      
      this.notify();
      log.info('SampleManager', `Imported and loaded ${file.name} into slot ${id}`);
    } catch (e) {
      log.error('SampleManager', `Failed to import file for slot ${id}: ${e}`);
      throw e;
    }
  }
}
