/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

import { log } from './logger';

export interface TelemetryEvent {
  timestamp: string;
  type: 'GLITCH' | 'LOCK_LOSS' | 'LOCK_ACQUIRED' | 'HARDWARE_INFO';
  deck?: string;
  details: Record<string, any>;
}

class TelemetryService {
  private events: TelemetryEvent[] = [];
  private readonly MAX_EVENTS = 200;

  constructor() {
    this.reportHardwareInfo();
  }

  public reportEvent(event: Omit<TelemetryEvent, 'timestamp'>): void {
    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }

    // Structured output for logs forwarding
    console.info(`[MIXI_TELEMETRY] ${JSON.stringify(fullEvent)}`);

    // Log to standard console utilizing custom console badges
    if (event.type === 'GLITCH') {
      log.warn('Telemetry', `Audio underrun/glitch on deck ${event.deck || 'Unknown'}: ${JSON.stringify(event.details)}`);
    } else if (event.type === 'LOCK_LOSS') {
      log.error('Telemetry', `Sync lock lost on deck ${event.deck || 'Unknown'}: ${JSON.stringify(event.details)}`);
    } else if (event.type === 'LOCK_ACQUIRED') {
      log.success('Telemetry', `Sync lock acquired on deck ${event.deck || 'Unknown'}: ${JSON.stringify(event.details)}`);
    }
  }

  public getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  public clear(): void {
    this.events = [];
  }

  private reportHardwareInfo(): void {
    if (typeof navigator !== 'undefined') {
      const details = {
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency || 'unknown',
        memory: (navigator as any).deviceMemory || 'unknown',
        platform: (navigator as any).userAgentData?.platform || 'unknown',
      };
      this.reportEvent({
        type: 'HARDWARE_INFO',
        details,
      });
    }
  }
}

export const telemetry = new TelemetryService();
