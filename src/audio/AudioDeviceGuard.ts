/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 * You may not use this file for commercial purposes without explicit permission.
 * For commercial licensing, contact: fabrizio.salmi@gmail.com
 */

// ─────────────────────────────────────────────────────────────
// Mixi – Audio Device Guard (Edge-Case #38)
//
// Monitors hardware audio device connectivity. When the active
// output device disconnects (e.g. USB cable yanked), falls back
// to the OS default output immediately so music never stops.
//
// Uses navigator.mediaDevices.ondevicechange + AudioContext.setSinkId
// (available in Chrome 110+, Edge 110+, Safari 17.4+).
// ─────────────────────────────────────────────────────────────

import { log } from '../utils/logger';

/**
 * Extends AudioContext with the optional setSinkId API.
 * Not all browsers support it yet — we feature-detect at runtime.
 */
interface AudioContextWithSink extends AudioContext {
  sinkId?: string;
  setSinkId?: (sinkId: string) => Promise<void>;
}

export class AudioDeviceGuard {
  private ctx: AudioContextWithSink;
  private onDeviceChange: (() => void) | null = null;
  private destroyed = false;

  /** The device ID we're actively outputting to ('' = OS default). */
  private currentSinkId = '';

  constructor(ctx: AudioContext) {
    this.ctx = ctx as AudioContextWithSink;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /**
   * Start monitoring device changes.
   * Safe to call even if the browser doesn't support setSinkId —
   * we degrade gracefully (log only).
   */
  start(): void {
    if (!navigator.mediaDevices?.addEventListener) return;

    this.onDeviceChange = () => { this.handleDeviceChange(); };
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
    log.info('DeviceGuard', 'Monitoring audio output devices');
  }

  /**
   * Set the active output device. Call this when the user picks
   * a device in settings. Pass '' for the OS default.
   */
  async setOutputDevice(deviceId: string): Promise<void> {
    if (!this.ctx.setSinkId) {
      log.warn('DeviceGuard', 'setSinkId not supported — using default output');
      return;
    }
    try {
      await this.ctx.setSinkId(deviceId);
      this.currentSinkId = deviceId;
      log.info('DeviceGuard', `Output set to ${deviceId || '(default)'}`);
    } catch (err) {
      log.error('DeviceGuard', `Failed to set output device: ${err}`);
      // Fall back to default
      await this.fallbackToDefault();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.onDeviceChange) {
      navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
      this.onDeviceChange = null;
    }
  }

  // ── Internal ───────────────────────────────────────────────

  private async handleDeviceChange(): Promise<void> {
    if (this.destroyed) return;

    // If we're using the OS default, the browser handles fallback itself.
    if (!this.currentSinkId) {
      log.info('DeviceGuard', 'Device change detected (using default — no action needed)');
      return;
    }

    // Check if our current device still exists.
    const stillConnected = await this.isDeviceConnected(this.currentSinkId);
    if (stillConnected) {
      log.info('DeviceGuard', 'Device change detected — current device still connected');
      return;
    }

    log.warn('DeviceGuard', `Output device ${this.currentSinkId} disconnected — falling back to default`);
    await this.fallbackToDefault();

    // Also resume if the context got suspended during the switch.
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* best effort */ }
    }
  }

  private async fallbackToDefault(): Promise<void> {
    if (!this.ctx.setSinkId) return;
    try {
      await this.ctx.setSinkId('');
      this.currentSinkId = '';
      log.warn('DeviceGuard', 'Fallback to default output — music should continue');
    } catch (err) {
      log.error('DeviceGuard', `Fallback to default failed: ${err}`);
    }
  }

  private async isDeviceConnected(deviceId: string): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(
        (d) => d.kind === 'audiooutput' && d.deviceId === deviceId,
      );
    } catch {
      // If we can't enumerate, assume disconnected and fall back.
      return false;
    }
  }
}
