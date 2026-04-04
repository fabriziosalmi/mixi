# MIXI Sync Protocol — Engineering Specification

> Status: **DRAFT v2** — Hardened with 30 engineering directives.
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
- **Remote** (LAN): UDP unicast — sub-millisecond, auto-discovery

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

**Dynamic Dictatorship**: one Master, zero consensus. If Master dies, the playing Slave auto-promotes in <20ms.

---

## Transport Layer

### Local: Shared Memory (same machine)

- **Discovery file**: `/tmp/mixi-sync-discovery` (fixed, well-known name)
  - Contains a routing table: `[InstanceA: /tmp/mixi-sync-A, InstanceB: /tmp/mixi-sync-B]`
  - New instances read the discovery file, find others, connect to their ring buffers
  - No collisions, no localhost UDP needed (#2)
- **Implementation**: Rust `memmap2` crate via N-API addon
- **Layout**: Fixed-size ring buffer with atomic read/write heads
- **Latency**: ~0µs (direct memory access, no syscall)
- **Fallback**: If shared memory unavailable (browser-only), fall back to UDP localhost

### Remote: UDP (LAN)

- **Port**: `4303` (UDP, `MIXI` in T9)
- **Discovery**: UDP **broadcast** to `255.255.255.255:4303` every 1 second (ANNOUNCE only)
- **Heartbeat**: UDP **unicast** to discovered peer IPs every 20ms (#7 — no broadcast storms)
- **Latency**: <1ms on Ethernet, <5ms on WiFi
- **Network binding**: Socket explicitly bound to primary interface (or user-selected in Settings) (#8)

---

## Packet Format (v1)

All values little-endian (`.to_le_bytes()` / `from_le_bytes()` always — #10).
Every packet is exactly **64 bytes** (one cache line, one UDP datagram).

```
Offset  Size  Type     Field              Description
──────────────────────────────────────────────────────────────
0       4     u8[4]    magic              "MXS\0" (0x4D 0x58 0x53 0x00)
4       1     u8       version            Protocol version (1)
5       1     u8       type               Packet type (see below)
6       2     u16      sequence           Packet sequence number (#14)
8       8     f64      timestamp          Sender's audio clock mapped to network epoch (#1, #28)
16      4     f32      bpm                Current BPM (0 = stopped)
20      4     f32      beat_phase         Phase within current beat (0.0–1.0)
24      4     u32      beat_count         Absolute beat counter since session epoch
28      1     u8       time_sig_num       Time signature numerator (default 4)
29      1     u8       time_sig_den       Time signature denominator (default 4)
30      1     u8       deck_id            Source deck (0=A, 1=B, 0xFF=master)
31      1     u8       flags              Bit flags (see below)
32      4     f32      crossfader         Crossfader position (0.0–1.0)
36      4     f32      master_volume      Master volume (0.0–1.0)
40      1     u8       energy_rms         Audio RMS energy 0–255 (#4)
41      1     u8       triggers           Onset triggers: bit0=kick, bit1=snare, bit2=hihat (#4)
42      2     u16      sender_id          Unique sender ID (random on startup)
44      4     f32      pitch_nudge        Current manual pitch bend state (#12)
48      8     u8[8]    track_hash         Waveform/length hash, NOT filename (#13)
56      4     f32      net_offset         NTP-style network clock offset (#1)
60      4     u8[4]    reserved           Future use (zero-filled)
```

### Changes from v1 draft (#11, #12, #14):
- `bar_phase` removed — derivable: `(beat_count % time_sig_num + beat_phase) / time_sig_num`
- `pitch_nudge` added — master jog wheel state for slave phase tracking
- `sequence` added — discard out-of-order packets (never compute time backwards)
- `energy` split into `energy_rms` (u8) + `triggers` (3 onset bits) — VJ killer feature
- `sender_id` moved to free up alignment for `pitch_nudge`
- `net_offset` added for NTP-style clock synchronization

### Packet Types (offset 5)

| Value | Name | Description |
|-------|------|-------------|
| 0x01 | `HEARTBEAT` | Sent every 20ms (unicast). Core sync data. |
| 0x02 | `ANNOUNCE` | Sent every 1s (broadcast). "I exist" discovery. |
| 0x03 | `TRANSPORT` | Play/stop/cue event (instant, not periodic). |
| 0x04 | `CUE_POINT` | Hot cue set/delete (shares position with peers). |
| 0x05 | `DECK_LOAD` | Track loaded (sends waveform hash). |
| 0x06 | `NTP_REQ` | Clock sync request (mini-NTP, #1). |
| 0x07 | `NTP_RESP` | Clock sync response with local timestamp. |
| 0x08 | `DICTATOR` | Force Master claim (#24). All other masters yield. |
| 0x10 | `CUSTOM` | User-defined payload in reserved bytes. |

### Flags (offset 31)

| Bit | Name | Description |
|-----|------|-------------|
| 0 | `PLAYING` | Deck is playing |
| 1 | `MASTER` | This instance is the tempo master |
| 2 | `SYNCED` | This instance is synced to external master |
| 3 | `RECORDING` | Recording is active |
| 4 | `VFX_ACTIVE` | VFX engine is running (for visual sync) |
| 5 | `NUDGING` | Currently applying phase correction |
| 6 | `FLYWHEEL` | Master lost, maintaining last known BPM (#9) |
| 7 | `DICTATOR` | Force Master override active (#24) |

---

## Clock Synchronization (#1, #28)

### The Problem

`AudioContext.currentTime` drifts between machines (different audio hardware clocks).
`performance.now()` drifts between machines (different OS clocks).
Neither is directly comparable across a network.

### The Solution: Mini-NTP

Before sync begins, instances run a 4-round NTP exchange:

```
1. Slave sends NTP_REQ with local timestamp T1
2. Master receives at T2, sends NTP_RESP with {T1, T2, T3=now}
3. Slave receives at T4
4. Round-trip: RTT = (T4 - T1) - (T3 - T2)
5. Clock offset: offset = ((T2 - T1) + (T3 - T4)) / 2
```

After 4 rounds, the median offset is stored. All subsequent `timestamp` fields are adjusted by this offset. The slave knows exactly where in its own `AudioContext.currentTime` the master's beat phase fell.

### Session Epoch (#28)

When the first instance starts publishing, it defines `epoch = AudioContext.currentTime`. All `beat_count` values are relative to this epoch. NTP offsets map the epoch across machines.

---

## Phase Lock Algorithm (#15–#18)

### PI Controller (not fixed nudge) (#16)

```rust
struct PhaseLock {
    kp: f32,           // Proportional gain (default 0.8)
    ki: f32,           // Integral gain (default 0.05)
    error_integral: f32,
    locked: bool,
    
    // Hysteresis thresholds (#18)
    lock_threshold: f32,   // 0.002 — below this = locked
    unlock_threshold: f32, // 0.02  — above this = unlocked
}

fn compute_correction(&mut self, phase_error: f32) -> f32 {
    // Hysteresis: don't jitter between lock/unlock
    if self.locked && phase_error.abs() > self.unlock_threshold {
        self.locked = false;
    }
    if !self.locked && phase_error.abs() < self.lock_threshold {
        self.locked = true;
        self.error_integral = 0.0;
    }
    
    if self.locked { return 0.0; }
    
    self.error_integral += phase_error;
    self.error_integral = self.error_integral.clamp(-1.0, 1.0);
    
    let correction = (phase_error * self.kp) + (self.error_integral * self.ki);
    
    // Clamp to ±2% — beyond this, audio pitch shift is audible (#17)
    correction.clamp(-0.02, 0.02)
}
```

### Snap Threshold (#17)

If `|phase_error| > 0.20` (20% of a beat), don't nudge — it would take too long and sound wrong. Instead:
- Use `AudioBufferSourceNode.start()` with offset to seek to correct position
- Apply 10ms crossfade to mask the jump
- Log: `"Phase snap: error was {x}%, jumped to lock"`

### Flywheel Mode (#9)

If no heartbeat received for 150ms:
1. Declare master dead
2. Maintain last known BPM (free-running)
3. Set `FLYWHEEL` flag
4. If this instance is playing: auto-promote to Master after 200ms
5. UI: sync indicator turns yellow blinking (#23)

---

## Network Resilience (#6–#9)

### Jitter Filter (#6)

Don't react to every heartbeat naively. Use a **Phase-Locked Loop** (PLL) or Kalman filter:

```rust
struct JitterFilter {
    filtered_phase: f32,
    alpha: f32,  // 0.1 = heavy smoothing, 0.5 = responsive
}

fn update(&mut self, raw_phase: f32) -> f32 {
    self.filtered_phase = self.alpha * raw_phase + (1.0 - self.alpha) * self.filtered_phase;
    self.filtered_phase
}
```

The local clock acts as a **heavy flywheel**: follows the master, but ignores network micro-jitter.

### Packet Ordering (#14)

```rust
fn should_process(last_seq: u16, incoming_seq: u16) -> bool {
    // Handle u16 wraparound
    let diff = incoming_seq.wrapping_sub(last_seq);
    diff > 0 && diff < 32768  // forward, within half the range
}
```

Never compute time backwards. Discard stale packets instantly.

### Ghost Master Timeout (#9)

```
Master silent for:
  0–50ms:    Normal jitter, ignore
  50–100ms:  Increase jitter filter alpha (trust local clock more)
  100–150ms: Set FLYWHEEL flag, warn UI
  >150ms:    Declare master dead, auto-promote if playing
```

### Broadcast Storm Prevention (#7)

- `ANNOUNCE` packets: **broadcast** `255.255.255.255:4303`, 1/second
- `HEARTBEAT` packets: **unicast** to each discovered peer IP, 50/second
- Discovery table caches peer IPs; expires after 5s without ANNOUNCE
- On WiFi: optionally reduce heartbeat to 25/second (40ms) in Settings

### Network Interface Binding (#8)

```rust
// Bind to specific interface, not 0.0.0.0
let socket = UdpSocket::bind(SocketAddr::new(
    selected_interface_ip,  // from Settings, or auto-detect primary
    4303
))?;
```

Settings UI: dropdown with available network interfaces.

---

## Visual Sync — Energy & Triggers (#4)

The `energy_rms` (u8) and `triggers` (u8) fields are the **VJ killer feature**.

### energy_rms (offset 40)
- `u8` 0–255 = total audio RMS mapped from 0.0–1.0
- Updated every heartbeat (20ms = 50Hz, enough for smooth VFX)

### triggers (offset 41)
Bit field for onset detection — VJ software reads these directly:

| Bit | Trigger | Source |
|-----|---------|--------|
| 0 | Kick onset | FFT bins 1-2 (20-80Hz) derivative > threshold |
| 1 | Snare onset | FFT bins 6-17 (1-3kHz) derivative > threshold |
| 2 | Hihat onset | FFT bins 46-87 (8-15kHz) derivative > threshold |
| 3-7 | reserved | |

External VJ software (Resolume, TouchDesigner, custom WGSL shaders) can listen on UDP :4303 and drive visuals from these triggers without any audio analysis of their own.

---

## Track Identification (#13)

The `track_hash` field (8 bytes) is NOT a hash of the filename (filenames change). It's:

```rust
fn compute_track_hash(samples: &[f32], sample_rate: u32) -> [u8; 8] {
    // Hash the audio content, not the metadata
    let length_samples = samples.len() as u64;
    let mut hasher = Sha256::new();
    hasher.update(length_samples.to_le_bytes());
    hasher.update(sample_rate.to_le_bytes());
    // Sample first 4096 samples (deterministic fingerprint)
    for &s in samples.iter().take(4096) {
        hasher.update(s.to_le_bytes());
    }
    let hash = hasher.finalize();
    hash[..8].try_into().unwrap()
}
```

This identifies the actual audio content regardless of filename or metadata changes.

---

## Master Election

### Dynamic Dictatorship (#3)

1. The instance that **first starts playing** becomes master (sends `MASTER` flag)
2. If master stops playing, the slave with `PLAYING` flag and `volume > 0` auto-promotes in <20ms
3. **Force Master** (#24): user presses button → sends `DICTATOR` packet → all other masters yield immediately, zero negotiation
4. Tie-break: lowest `sender_id` wins
5. No consensus algorithm — simple, deterministic, fast

---

## MIDI Clock Bridge (#5)

MIXI Sync automatically generates MIDI Clock output as a separate module:

```
SyncSubscriber → receives HEARTBEAT at 50Hz
  → MidiClockBridge → computes 24 ppqn timing
    → navigator.requestMIDIAccess().outputs → 0xF8 ticks
```

The bridge runs in the Node/Electron process. Any synth or drum machine connected via USB MIDI goes to tempo without any configuration in MIXI. The user just enables "MIDI Clock Out" in Settings — the sync protocol feeds it automatically.

---

## Web Fallbacks (#19–#21)

### Priority Order

`SharedMemory > UDP > BroadcastChannel > WebSocket > WebRTC`

### BroadcastChannel (same machine, browser tabs) (#19)

```typescript
const channel = new BroadcastChannel('mixi-sync');
// Send raw ArrayBuffer — zero JSON serialization, zero GC pressure
channel.postMessage(packetBuffer);  // ArrayBuffer, NOT JSON
```

### WebSocket Relay (#20)

Via Python sidecar (`ws://localhost:8000/ws/sync`):
- **Only for** `TRANSPORT` (play/stop) and `CUE_POINT` packets
- **Never for** `HEARTBEAT` — Python + TCP WebSocket adds 30-50ms jitter, useless for phase lock
- Degrades to BPM-follow without phase lock

### WebRTC DataChannel (#21)

For two browsers on different machines:
```typescript
const dc = peerConnection.createDataChannel('mixi-sync', {
    ordered: false,        // like UDP
    maxRetransmits: 0,     // fire and forget
});
```

This is the **only way** to do phase-lock quality sync between browsers without Electron.

---

## UI Integration (#22–#25)

### Sync Status Colors (#23)

| Color | State | Meaning |
|-------|-------|---------|
| Gray | OFF | Sync disabled |
| Yellow blink | FLYWHEEL | Master lost, free-running on last BPM |
| Cyan solid | LOCKED | Phase error < 0.002, perfectly synced |
| Green pulse | NUDGING | PI controller actively correcting phase |
| Red solid | DICTATOR | Force Master override active |

### Sync Radar (#22)

Settings → System tab: circular radar display.
- Center = this instance
- Peer dots positioned by network latency (closer = lower ping)
- Dot color = peer state (playing/stopped/master/synced)
- Dot label = peer name + BPM

### Network Offset Slider (#25)

Settings → Sync → `Network Sync Offset: [-50ms ... +50ms]`

For hardware latency compensation: if audio comes from another machine's speakers, the DJ can shift the phase by ear. Stored per-session.

---

## Security (#26–#27)

### HMAC-SHA256 Signing (#26)

Optional (enabled in Settings with a shared passphrase):

```
Packet: [64 bytes payload] + [32 bytes HMAC-SHA256]
Total: 96 bytes (still fits in one UDP datagram)
```

- No encryption (unnecessary for BPM/phase data, saves CPU)
- Prevents injection attacks (rogue script on club WiFi sending fake STOP packets)
- Shared secret set in Settings → Sync → "Session Key"

### Sender ID (#27)

- v1: `u16` (65536 values) — sufficient for LAN
- Future (MIXI Cloud/tunneling): extend to UUID-64 using the reserved bytes

---

## Protocol Versioning (#29)

The `version` byte (offset 4) enables backwards compatibility:

```rust
fn parse_packet(data: &[u8]) -> Result<Packet, ParseError> {
    if data.len() < 64 { return Err(ParseError::TooShort); }
    if &data[0..4] != b"MXS\0" { return Err(ParseError::BadMagic); }
    
    let version = data[4];
    match version {
        1 => parse_v1(data),
        2.. => {
            // Unknown future version — extract only v1 fields
            // Graceful degradation, not crash
            parse_v1(data)  // v1 fields are always at the same offsets
        }
        0 => Err(ParseError::InvalidVersion),
    }
}
```

Future versions MUST keep v1 field offsets stable. New fields go in reserved bytes or extend the packet.

---

## Testing: Chaos Monkey (#30)

Before v1 release, validate with:

```rust
// chaos_monkey.rs — stress test
fn main() {
    let socket = UdpSocket::bind("0.0.0.0:0").unwrap();
    let target = "127.0.0.1:4303";
    
    // 1. Corrupted magic bytes
    send_garbage(socket, target, b"XXX\0...");
    
    // 2. Negative BPM
    send_packet(socket, target, bpm: -500.0, ...);
    
    // 3. NaN timestamp
    send_packet(socket, target, timestamp: f64::NAN, ...);
    
    // 4. Future version (v99)
    send_packet(socket, target, version: 99, ...);
    
    // 5. Out-of-order sequence flood
    for seq in (0..1000).rev() {
        send_packet(socket, target, sequence: seq, ...);
    }
    
    // 6. Rapid master election spam
    for _ in 0..100 {
        send_packet(socket, target, type: DICTATOR, ...);
    }
    
    // 7. Maximum BPM (999)
    send_packet(socket, target, bpm: 999.0, ...);
    
    // 8. Zero-length and oversized packets
    socket.send_to(&[], target);
    socket.send_to(&[0u8; 65535], target);
}
```

**Pass criteria**: The AudioWorklet continues playing without interruption. The sync engine logs warnings but does not crash, panic, or produce audio artifacts.

---

## Comparison

| Feature | MIDI Clock | Ableton Link | Pro DJ Link | **MIXI Sync** |
|---------|-----------|--------------|-------------|---------------|
| BPM sync | 24 ppqn | Yes | Yes | **Yes** |
| Beat phase | No | Yes | Yes | **Yes (PI controller)** |
| Bar position | No | No | Yes | **Yes (derived)** |
| Deck state | No | No | Partial | **Full (flags byte)** |
| Crossfader | No | No | No | **Yes** |
| VFX triggers | No | No | No | **Yes (kick/snare/hihat)** |
| Cue points | No | No | No | **Yes (packet type)** |
| Track ID | No | No | Yes | **Yes (audio hash)** |
| Pitch nudge | No | No | No | **Yes** |
| Discovery | Manual | mDNS | ProLink | **UDP broadcast** |
| Latency (local) | ~1ms USB | ~1ms | ~5ms | **~0µs (SHM)** |
| Latency (LAN) | N/A | ~1ms | ~5ms | **<1ms (UDP unicast)** |
| Jitter handling | None | PLL | Unknown | **Kalman/PLL (#6)** |
| Network resilience | N/A | Good | Good | **Flywheel + hysteresis** |
| Language | Hardware | C++ | Proprietary | **Rust** |
| Web support | WebMIDI | No | No | **Yes (3 fallbacks)** |
| VJ integration | No | No | No | **Native (UDP triggers)** |
| Security | None | None | None | **HMAC-SHA256 optional** |

---

## Implementation Milestones

| Phase | What | Key Directives |
|-------|------|----------------|
| **v1** | UDP heartbeat + BPM/phase sync | #1 (NTP), #6 (jitter), #7 (unicast), #14 (sequence) |
| **v1** | Discovery (announce/listen) | #2 (fixed SHM name), #8 (interface binding) |
| **v1** | PI phase lock + flywheel | #15-18 (controller), #9 (timeout) |
| **v1** | Settings UI (enable/master/peers) | #22 (radar), #23 (colors), #25 (offset) |
| **v1** | Chaos Monkey test suite | #30 |
| **v2** | Shared memory local backend | #2 (discovery file) |
| **v2** | MIDI Clock bridge (auto) | #5 |
| **v2** | Master election + DICTATOR | #3, #24 |
| **v2** | HMAC signing | #26 |
| **v3** | Cue point sharing | Packet type 0x04 |
| **v3** | Web fallback (BroadcastChannel) | #19 |
| **v3** | WebRTC DataChannel | #21 |
| **v4** | MIXI Cloud tunneling | #27 (UUID-64) |
