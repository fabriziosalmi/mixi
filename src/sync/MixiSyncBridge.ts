/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// MIXI Sync Bridge — Renderer-Side Controller
//
// Singleton that manages the sync lifecycle:
//   - Publishes heartbeats at 50 Hz (if master)
//   - Receives heartbeats and feeds PhaseLock (if subscriber)
//   - Falls back to BroadcastChannel in browser-only mode
//   - Sends ANNOUNCE at 1 Hz for discovery
// ─────────────────────────────────────────────────────────────

import { useMixiStore } from '../store/mixiStore';
import { MixiEngine } from '../audio/MixiEngine';
import { PhaseLock, type PhaseLockState } from './PhaseLock';
import {
  encodePacket, decodePacket, isNewerSequence,
  phaseToFp, fpToPhase, randomSenderId, packTriggers,
  PacketType, Flags, MIXI_SYNC_VERSION,
  type SyncPacket,
} from './protocol';
import { log } from '../utils/logger';

interface SyncAPI {
  start: () => Promise<{ ok: boolean }>;
  send: (data: ArrayBuffer, broadcast?: boolean, targetIp?: string) => Promise<void>;
  peers: () => Promise<Array<{ id: string; ip: string; port: number; lastSeen: number }>>;
  stop: () => Promise<void>;
  onPacket: (cb: (data: ArrayBuffer) => void) => void;
}

function getSyncAPI(): SyncAPI | null {
  const w = window as any;
  return w?.mixi?.mixiSync ?? null;
}

export class MixiSyncBridge {
  private static instance: MixiSyncBridge | null = null;

  private api: SyncAPI | null;
  private phaseLock = new PhaseLock();
  private senderId = randomSenderId();
  private sequence = 0;
  private epochGeneration = 0;
  private lastReceivedSeq = 0;

  private _active = false;
  private _isMaster = false;
  private lastMasterYieldTime = 0; // #5 cooldown timestamp
  private _schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private _nextHeartbeatTime = 0;
  private _nextAnnounceTime = 0;
  private _nextTickTime = 0;

  // BroadcastChannel fallback (browser-only)
  private broadcastChannel: BroadcastChannel | null = null;

  private constructor() {
    this.api = getSyncAPI();
  }

  static getInstance(): MixiSyncBridge {
    if (!MixiSyncBridge.instance) {
      MixiSyncBridge.instance = new MixiSyncBridge();
    }
    return MixiSyncBridge.instance;
  }

  get isAvailable(): boolean { return this.api !== null || typeof BroadcastChannel !== 'undefined'; }
  get active(): boolean { return this._active; }
  get isMaster(): boolean { return this._isMaster; }
  get phaseLockState(): PhaseLockState { return this.phaseLock.state; }

  // ── Start / Stop ──────────────────────────────────────────

  async startAsPublisher(): Promise<boolean> {
    if (this._active) return true;
    this._isMaster = true;
    this.epochGeneration++;
    return this.start();
  }

  async startAsSubscriber(): Promise<boolean> {
    if (this._active) return true;
    this._isMaster = false;
    this.phaseLock.start();
    return this.start();
  }

  private async start(): Promise<boolean> {
    // Try Electron UDP first
    if (this.api) {
      const result = await this.api.start();
      if (!result.ok) {
        log.warn('Sync', 'UDP start failed, trying BroadcastChannel');
      } else {
        // Listen for incoming packets
        this.api.onPacket((data) => this.onPacket(data));
        this._active = true;
        this.startTimers();
        log.success('Sync', `Started as ${this._isMaster ? 'MASTER' : 'SUBSCRIBER'} (UDP :4303)`);
        return true;
      }
    }

    // Fallback: BroadcastChannel (same-origin tabs)
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel('mixi-sync');
      this.broadcastChannel.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.onPacket(e.data);
      };
      this._active = true;
      this.startTimers();
      log.success('Sync', `Started as ${this._isMaster ? 'MASTER' : 'SUBSCRIBER'} (BroadcastChannel)`);
      return true;
    }

    log.warn('Sync', 'No transport available');
    return false;
  }

  stop(): void {
    if (!this._active) return;

    // Send DYING packet
    if (this._isMaster) {
      this.sendPacket(PacketType.DYING);
    }

    this.stopTimers();
    this.phaseLock.stop();
    this.api?.stop();
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
    this._active = false;
    this._isMaster = false;
    log.info('Sync', 'Stopped');
  }

  // ── Unified Scheduler ─────────────────────────────────────
  // Single setTimeout loop replaces 3 independent setInterval timers.
  // Uses drift-compensated absolute timestamps — no cumulative drift.

  private startTimers(): void {
    const now = performance.now();
    this._nextHeartbeatTime = now;
    this._nextTickTime = now;
    this._nextAnnounceTime = now + 1000;
    this.schedulerLoop();
  }

  private stopTimers(): void {
    if (this._schedulerTimer) { clearTimeout(this._schedulerTimer); this._schedulerTimer = null; }
  }

  private schedulerLoop(): void {
    if (!this._active) return;
    const now = performance.now();

    // Master: publish heartbeats at 50 Hz
    if (this._isMaster && now >= this._nextHeartbeatTime) {
      this.publishHeartbeat();
      this._nextHeartbeatTime += 20;
      // Catch up if we fell behind (GC pause, tab throttle)
      if (this._nextHeartbeatTime < now - 40) this._nextHeartbeatTime = now + 20;
    }

    // Subscriber: PID tick at 50 Hz
    if (!this._isMaster && now >= this._nextTickTime) {
      this.subscriberTick();
      this._nextTickTime += 20;
      if (this._nextTickTime < now - 40) this._nextTickTime = now + 20;
    }

    // Announce at 1 Hz (both)
    if (now >= this._nextAnnounceTime) {
      this.sendPacket(PacketType.ANNOUNCE, true);
      this._nextAnnounceTime += 1000;
    }

    // Sleep until the earliest next event
    const nextEvent = Math.min(
      this._isMaster ? this._nextHeartbeatTime : this._nextTickTime,
      this._nextAnnounceTime,
    );
    const sleepMs = Math.max(1, Math.min(20, nextEvent - performance.now()));
    this._schedulerTimer = setTimeout(() => this.schedulerLoop(), sleepMs);
  }

  // ── Publishing (Master) ───────────────────────────────────

  private publishHeartbeat(): void {
    this.sendPacket(PacketType.HEARTBEAT);
  }

  private sendPacket(type: number, broadcast = false): void {
    const state = useMixiStore.getState();
    const engine = MixiEngine.getInstance();
    const ctx = engine.isInitialized ? engine.getAudioContext() : null;

    // Determine active deck
    const deckA = state.decks.A;
    const deckB = state.decks.B;
    const activeDeck = deckA.isPlaying ? deckA : deckB;
    const bpm = activeDeck.bpm || 0;

    // Compute beat phase
    let beatPhase = 0;
    let beatCount = 0;
    if (ctx && bpm > 0 && activeDeck.firstBeatOffset !== undefined) {
      const beatPeriod = 60 / bpm;
      const elapsed = ctx.currentTime - activeDeck.firstBeatOffset;
      beatPhase = ((elapsed / beatPeriod) % 1 + 1) % 1;
      beatCount = Math.floor(elapsed / beatPeriod);
    }

    // Build flags
    let flags = 0;
    if (deckA.isPlaying || deckB.isPlaying) flags |= Flags.PLAYING;
    if (this._isMaster) flags |= Flags.MASTER;
    if (this.phaseLock.locked) flags |= Flags.SYNCED;
    if (this.phaseLock.mode === 'flywheel') flags |= Flags.FLYWHEEL;
    if (Math.abs(this.phaseLock.correction) > 0.001) flags |= Flags.NUDGING;

    const packet: SyncPacket = {
      version: MIXI_SYNC_VERSION,
      type: type as any,
      sequence: this.sequence++ & 0xFFFF,
      timestamp: ctx?.currentTime ?? performance.now() / 1000,
      bpm,
      beatPhaseFp: phaseToFp(beatPhase),
      beatCount: beatCount >>> 0,
      epochGeneration: this.epochGeneration,
      crossfader: state.crossfader,
      masterVolume: state.master.volume,
      pitchNudge: 0,
      netOffset: 0,
      senderId: this.senderId,
      timeSigNum: 4,
      deckId: deckA.isPlaying ? 0 : 1,
      flags,
      energyRms: 0, // TODO: compute from analyser
      triggers: packTriggers(0, 0, 0), // TODO: predictive onsets
      eqBass: 128, // 0dB
      trackHash: new Uint8Array(8),
    };

    const buf = encodePacket(packet);

    if (this.api) {
      this.api.send(buf, broadcast);
    } else if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(buf);
    }
  }

  // ── Receiving ─────────────────────────────────────────────

  // #1 Drain-to-Newest: if OS scheduler freezes the thread and multiple
  // heartbeats queue up, only the newest is processed by the PID controller.
  // Prevents Kd explosion from 5 consecutive heartbeats in 1 nanosecond.
  private packetQueue: SyncPacket[] = [];
  private drainScheduled = false;

  private onPacket(data: ArrayBuffer): void {
    const packet = decodePacket(data);
    if (!packet) return;

    // Ignore own packets
    if (packet.senderId === this.senderId) return;

    // Sequence check: discard old/duplicate
    if (packet.type === PacketType.HEARTBEAT) {
      if (!isNewerSequence(packet.sequence, this.lastReceivedSeq)) return;
      this.lastReceivedSeq = packet.sequence;
      // Queue heartbeats, process only newest in next microtask
      this.packetQueue.push(packet);
      if (!this.drainScheduled) {
        this.drainScheduled = true;
        queueMicrotask(() => {
          // Drain: keep only the packet with highest sequence per sender
          const newest = this.packetQueue.reduce((a, b) =>
            isNewerSequence(b.sequence, a.sequence) ? b : a
          );
          this.packetQueue.length = 0;
          this.drainScheduled = false;
          this.processPacket(newest);
        });
      }
      return;
    }

    this.processPacket(packet);
  }

  private processPacket(packet: SyncPacket): void {
    switch (packet.type) {
      case PacketType.HEARTBEAT:
        this.onHeartbeat(packet);
        break;
      case PacketType.ANNOUNCE:
        // Peer discovered (handled by main process for UDP)
        break;
      case PacketType.DICTATOR:
        // #4 Epoch Poisoning guard: reject jumps > 1 generation
        // (prevents 0xFFFFFFFF attack that would lock the network forever)
        if (packet.epochGeneration > this.epochGeneration + 1) {
          log.warn('Sync', `Rejected epoch jump: ${packet.epochGeneration} (current: ${this.epochGeneration})`);
          break;
        }
        // Someone claimed master — yield if we're master
        if (this._isMaster && packet.epochGeneration > this.epochGeneration) {
          this._isMaster = false;
          this.epochGeneration = packet.epochGeneration;
          this.lastMasterYieldTime = Date.now(); // #5 cooldown
          this.stopTimers();
          this.phaseLock.start();
          this.startTimers();
          log.info('Sync', 'Yielded master to peer');
        }
        break;
      case PacketType.DYING:
        // Master is shutting down — consider auto-promote
        // #5 Cooldown: don't re-claim master within 2s of yielding
        if (!this._isMaster && (Date.now() - this.lastMasterYieldTime > 2000)) {
          const state = useMixiStore.getState();
          if (state.decks.A.isPlaying || state.decks.B.isPlaying) {
            this._isMaster = true;
            this.epochGeneration = packet.epochGeneration + 1;
            this.stopTimers();
            this.phaseLock.stop();
            this.startTimers();
            log.info('Sync', 'Auto-promoted to master (peer dying)');
          }
        }
        break;
    }
  }

  private onHeartbeat(packet: SyncPacket): void {
    if (this._isMaster) return; // masters don't follow

    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const state = useMixiStore.getState();
    const activeDeck = state.decks.A.isPlaying ? state.decks.A : state.decks.B;
    const ctx = engine.getAudioContext();

    // Compute local phase
    let localPhase = 0;
    if (activeDeck.bpm > 0 && activeDeck.firstBeatOffset !== undefined) {
      const beatPeriod = 60 / activeDeck.bpm;
      const elapsed = ctx.currentTime - activeDeck.firstBeatOffset;
      localPhase = ((elapsed / beatPeriod) % 1 + 1) % 1;
    }

    const masterPhase = fpToPhase(packet.beatPhaseFp);
    const slaveVolume = Math.max(state.decks.A.volume, state.decks.B.volume);

    this.phaseLock.onHeartbeat(
      masterPhase, packet.bpm,
      localPhase, activeDeck.bpm || packet.bpm,
      slaveVolume, 0, // jitter estimate TODO
    );

    // #3 Feed-Forward: if master is manually nudging (jog wheel),
    // replicate the nudge instantly instead of letting PID filter it.
    if (Math.abs(packet.pitchNudge) > 0.001) {
      const deckId = state.decks.A.isPlaying ? 'A' : 'B';
      const currentRate = state.decks[deckId].playbackRate;
      state.setDeckPlaybackRate(deckId, currentRate * (1 + packet.pitchNudge * 0.02));
    }
  }

  private subscriberTick(): void {
    const engine = MixiEngine.getInstance();
    if (!engine.isInitialized) return;

    const state = useMixiStore.getState();
    const activeDeck = state.decks.A.isPlaying ? state.decks.A : state.decks.B;
    const ctx = engine.getAudioContext();

    let localPhase = 0;
    if (activeDeck.bpm > 0 && activeDeck.firstBeatOffset !== undefined) {
      const beatPeriod = 60 / activeDeck.bpm;
      const elapsed = ctx.currentTime - activeDeck.firstBeatOffset;
      localPhase = ((elapsed / beatPeriod) % 1 + 1) % 1;
    }

    this.phaseLock.tick(localPhase, activeDeck.bpm || 0);

    // Apply correction to playback rate
    const correction = this.phaseLock.correction;
    if (Math.abs(correction) > 0.0001) {
      const deckId = state.decks.A.isPlaying ? 'A' : 'B';
      const currentRate = state.decks[deckId].playbackRate;
      const correctedRate = currentRate * (1 + correction);
      state.setDeckPlaybackRate(deckId, correctedRate);
    }

    // Follow master BPM
    const targetBpm = this.phaseLock.getTargetBpm();
    if (targetBpm > 0 && activeDeck.bpm > 0 && Math.abs(targetBpm - activeDeck.bpm) > 0.5) {
      const deckId = state.decks.A.isPlaying ? 'A' : 'B';
      const ratio = targetBpm / (activeDeck.originalBpm || activeDeck.bpm);
      state.setDeckPlaybackRate(deckId, ratio);
    }
  }
}
