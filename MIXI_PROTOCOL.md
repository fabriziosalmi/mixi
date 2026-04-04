# MIXI Sync Protocol — Design Document

> Status: **DRAFT** — Not yet implemented.
> This document defines the MIXI-to-MIXI (and MIXI-to-external) sync protocol.

## Problem

DJs and live performers need multiple MIXI instances (or MIXI + external gear) locked to the same tempo, phase, and bar position. Existing solutions:

| Solution | Limitation |
|----------|-----------|
| MIDI Clock (24 ppqn) | BPM only, no phase/bar, no state, USB latency, no discovery |
| Ableton Link | C++ library, complex integration, no deck state, no cue sync |
| Pioneer Pro DJ Link | Proprietary, needs bridge software, CDJ-only ecosystem |

MIXI Sync solves this with a **Rust-native protocol** that works at two levels:
- **Local** (same machine): shared memory — zero copy, zero latency
- **Remote** (LAN): UDP broadcast — sub-millisecond, auto-discovery

---

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   MIXI Instance A│         │   MIXI Instance B│
│                  │         │                  │
│  MixiEngine ─────┤         ├───── MixiEngine  │
│       │          │         │          │       │
│  SyncPublisher   │         │   SyncSubscriber  │
│       │          │         │          │       │
│       ▼          │         │          ▼       │
│  ┌──────────┐    │         │    ┌──────────┐  │
│  │ Local:   │    │         │    │ Local:   │  │
│  │ SHM ring │◄───┼─────────┼───►│ SHM ring │  │
│  └──────────┘    │         │    └──────────┘  │
│  ┌──────────┐    │  LAN    │    ┌──────────┐  │
│  │ Remote:  │    │         │    │ Remote:  │  │
│  │ UDP :4303│◄───┼─────────┼───►│ UDP :4303│  │
│  └──────────┘    │         │    └──────────┘  │
└─────────────────┘         └─────────────────┘
```

Any instance can be **publisher** (master clock) or **subscriber** (slave), or both.

---

## Transport Layer

### Local: Shared Memory (same machine)

For two MIXI instances on the same machine (e.g., two Electron windows, or Electron + browser):

- **Mechanism**: Memory-mapped file (`/tmp/mixi-sync-{session-id}`)
- **Implementation**: Rust `memmap2` crate via N-API addon
- **Layout**: Fixed-size ring buffer with atomic read/write heads
- **Latency**: ~0µs (direct memory access, no syscall)
- **Fallback**: If shared memory unavailable (browser-only), fall back to UDP localhost

### Remote: UDP Broadcast (LAN)

For MIXI instances on different machines on the same network:

- **Port**: `4303` (UDP, `MIXI` in T9 = 4303)
- **Discovery**: UDP broadcast to `255.255.255.255:4303` every 1 second
- **Data**: Compact binary packets (see Packet Format below)
- **Latency**: <1ms on LAN, <5ms on WiFi
- **No TCP**: UDP is fire-and-forget, no connection state, no head-of-line blocking

---

## Packet Format

All values are little-endian. Every packet is exactly **64 bytes** (fits in one UDP datagram, one cache line).

```
Offset  Size  Type     Field              Description
──────────────────────────────────────────────────────────────
0       4     u8[4]    magic              "MXS\0" (0x4D 0x58 0x53 0x00)
4       1     u8       version            Protocol version (1)
5       1     u8       type               Packet type (see below)
6       2     u16      sender_id          Unique sender ID (random on startup)
8       8     f64      timestamp          Sender's monotonic clock (seconds)
16      4     f32      bpm                Current BPM (0 = stopped)
20      4     f32      beat_phase         Phase within current beat (0.0–1.0)
24      4     u32      beat_count         Absolute beat counter since start
28      4     f32      bar_phase          Phase within current bar (0.0–1.0, 4/4)
32      1     u8       time_sig_num       Time signature numerator (default 4)
33      1     u8       time_sig_den       Time signature denominator (default 4)
34      1     u8       deck_id            Source deck (0=A, 1=B, 0xFF=master)
35      1     u8       flags              Bit flags (see below)
36      4     f32      crossfader         Crossfader position (0.0–1.0)
40      4     f32      master_volume      Master volume (0.0–1.0)
44      4     f32      energy             Total audio energy (0.0–1.0, for VFX sync)
48      8     u8[8]    deck_name          Track name hash (first 8 bytes of SHA-256)
56      8     u8[8]    reserved           Future use (zero-filled)
```

### Packet Types (offset 5)

| Value | Name | Description |
|-------|------|-------------|
| 0x01 | `HEARTBEAT` | Sent every 20ms. Core sync data. |
| 0x02 | `ANNOUNCE` | Sent every 1s on broadcast. "I exist" discovery. |
| 0x03 | `TRANSPORT` | Play/stop/cue event (instant, not periodic). |
| 0x04 | `CUE_POINT` | Hot cue set/delete (shares position with subscribers). |
| 0x05 | `DECK_LOAD` | Track loaded (sends track name hash for UI display). |
| 0x10 | `CUSTOM` | User-defined payload in reserved bytes. |

### Flags (offset 35)

| Bit | Name | Description |
|-----|------|-------------|
| 0 | `PLAYING` | Deck is playing |
| 1 | `MASTER` | This instance is the tempo master |
| 2 | `SYNCED` | This instance is synced to an external master |
| 3 | `RECORDING` | Recording is active |
| 4 | `VFX_ACTIVE` | VFX engine is running (for visual sync) |
| 5-7 | reserved | |

---

## Sync Algorithm

### Phase Lock (subscriber side)

When receiving heartbeats from a master:

```
1. Read master's beat_phase (0.0–1.0)
2. Compute local beat_phase from own AudioContext
3. phase_error = master_phase - local_phase
4. If |phase_error| > 0.02 (>2% of a beat):
     Apply correction: adjust playback rate by ±0.1% for 1 beat
5. If |phase_error| < 0.005:
     Locked — no correction needed
```

This is the same approach as Ableton Link: **gradual nudge**, never hard-jump.

### BPM Follow

```
1. If master BPM changed by > 0.1:
     Smooth-ramp local BPM to match over 2 beats
2. If master BPM changed by > 5.0 (track change):
     Instant jump to new BPM
```

### Master Election

When multiple MIXI instances are on the network:

1. The instance that **first starts playing** becomes master (sends `MASTER` flag)
2. If master stops, the next playing instance auto-promotes
3. Manual override: user can force-claim master via UI button
4. Tie-break: lowest `sender_id` wins

---

## Implementation Plan

### Rust Crate: `mixi-sync`

```
mixi-sync/
  Cargo.toml
  src/
    lib.rs          — N-API exports
    protocol.rs     — Packet encode/decode
    publisher.rs    — Send heartbeats (timer thread)
    subscriber.rs   — Receive + phase lock
    discovery.rs    — UDP broadcast announce/listen
    shm.rs          — Shared memory backend (memmap2)
    udp.rs          — UDP socket backend
```

### Electron Integration

Same pattern as `mixi-native` (cpal addon):

```
electron/
  sync/
    index.js        — N-API loader (platform detection)

electron/preload.ts:
  mixiSync: {
    startPublisher: (config) => ipcRenderer.invoke('mixi-sync:start-pub', config),
    startSubscriber: () => ipcRenderer.invoke('mixi-sync:start-sub'),
    stop: () => ipcRenderer.invoke('mixi-sync:stop'),
    getStatus: () => ipcRenderer.invoke('mixi-sync:status'),
    onHeartbeat: (cb) => ipcRenderer.on('mixi-sync:heartbeat', cb),
  }
```

### Renderer Bridge

```typescript
// src/sync/MixiSyncBridge.ts
export class MixiSyncBridge {
  static getInstance(): MixiSyncBridge
  isAvailable(): boolean
  startAsPublisher(): Promise<void>
  startAsSubscriber(): Promise<void>
  stop(): void
  get status(): SyncStatus
  get peers(): SyncPeer[]
  get isMaster(): boolean
  onSync?: (packet: SyncPacket) => void
}
```

### Settings UI

Settings → System tab:

```
MIXI Sync
  [x] Enable Sync        (toggle)
  [ ] Force Master        (toggle)
  Mode: ● Auto  ○ Publish  ○ Subscribe
  
  Peers:
    MIXI-A2F3  172.16.0.5  128.0 BPM  PLAYING  [MASTER]
    MIXI-7B01  172.16.0.8  128.0 BPM  SYNCED
```

---

## Web-Only Fallback

For browser-only instances (no Electron, no N-API addon):

- **WebRTC DataChannel**: peer-to-peer, low latency, works through NAT
- **WebSocket relay**: via the Python sidecar (`ws://localhost:8000/ws/sync`)
- **BroadcastChannel API**: same-origin tab-to-tab sync (zero latency)

Priority: `SharedMemory > UDP > BroadcastChannel > WebSocket > WebRTC`

---

## Comparison

| Feature | MIDI Clock | Ableton Link | Pro DJ Link | MIXI Sync |
|---------|-----------|--------------|-------------|-----------|
| BPM sync | 24 ppqn | Yes | Yes | Yes |
| Beat phase | No | Yes | Yes | Yes |
| Bar position | No | No | Yes | Yes |
| Deck state | No | No | Partial | Full |
| Crossfader | No | No | No | Yes |
| Energy (VFX) | No | No | No | Yes |
| Cue points | No | No | No | Yes |
| Track info | No | No | Yes | Yes (hash) |
| Discovery | Manual | mDNS | ProLink | UDP broadcast |
| Latency (local) | ~1ms USB | ~1ms | ~5ms | ~0µs (SHM) |
| Latency (LAN) | N/A | ~1ms | ~5ms | <1ms (UDP) |
| Language | Hardware | C++ | Proprietary | Rust |
| Web support | WebMIDI | No | No | Yes (fallbacks) |

---

## Security

- **No auth by default** (LAN broadcast, same as Ableton Link)
- **Optional**: HMAC-SHA256 on packets using a shared secret (set in Settings)
- **No encryption**: sync data is not sensitive (BPM, phase, flags)
- **Scope**: LAN only — no WAN routing, no internet exposure

---

## Open Questions

1. **Shared memory naming**: `/tmp/mixi-sync-{session-id}` — how to discover the session ID between instances? Use a fixed well-known name (`/tmp/mixi-sync`) or generate and share via UDP?

2. **Clock source**: Should the master's `timestamp` field use `performance.now()` (browser monotonic) or `AudioContext.currentTime` (audio clock)? Audio clock is more accurate for phase lock but not comparable across processes.

3. **Multi-master**: Should we support multiple masters (one per deck) or single global master? Ableton Link uses a consensus model; we could start simpler.

4. **MIDI Clock bridge**: Should MIXI Sync automatically generate MIDI Clock output from the sync data? This would make MIXI Sync a superset of MIDI Clock — any external gear works without configuration.

5. **Visual sync**: The `energy` field enables VFX sync across instances. Is this worth the bandwidth? (1 float per 20ms heartbeat = trivial)

---

## Milestones

| Phase | What | Depends On |
|-------|------|-----------|
| **v1** | UDP heartbeat + BPM/phase sync | `mixi-sync` Rust crate |
| **v1** | Discovery (announce/listen) | UDP backend |
| **v1** | Settings UI (enable/master/peers) | N-API addon |
| **v2** | Shared memory local backend | `memmap2` |
| **v2** | Phase lock algorithm (gradual nudge) | AudioContext integration |
| **v2** | Master election | Discovery |
| **v3** | Cue point sharing | Extended packet types |
| **v3** | Web fallback (BroadcastChannel) | Browser-only path |
| **v4** | WebRTC DataChannel | NAT traversal |
| **v4** | MIDI Clock bridge | MIDI Clock Out (done) |
