# MIXI Sync Protocol

**A Low-Latency Dual-Transport Synchronization Protocol for Distributed Audio Workstations**

---

|   |   |
|---|---|
| **Document** | MIXI Sync Protocol Specification |
| **Version** | 1.0-draft |
| **Date** | 2026-04-05 |
| **Authors** | Fabrizio Salmi |
| **Status** | Pre-implementation draft |
| **License** | PolyForm Noncommercial 1.0.0 |
| **Repository** | github.com/fabriziosalmi/mixi |

---

## Abstract

This document specifies **MIXI Sync**, a binary synchronization protocol designed for real-time tempo, phase, and state coordination between multiple instances of the MIXI audio workstation and external audiovisual equipment. The protocol operates over two transport layers — shared memory (intra-machine, ~0 µs latency) and UDP unicast (inter-machine, <1 ms LAN latency) — and defines a 64-byte fixed-size packet carrying BPM, beat phase, onset triggers, deck state, and clock synchronization data at 50 Hz. A PI-controller phase lock algorithm with hysteresis achieves sub-2 ms beat alignment without audible pitch artifacts. The protocol requires no central server, uses UDP broadcast for peer discovery, and elects a tempo master via a deterministic Dynamic Dictatorship model.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Design Goals](#2-design-goals)
3. [Related Work](#3-related-work)
4. [System Architecture](#4-system-architecture)
5. [Transport Layers](#5-transport-layers)
6. [Packet Format](#6-packet-format)
7. [Clock Synchronization](#7-clock-synchronization)
8. [Phase Lock Algorithm](#8-phase-lock-algorithm)
9. [Master Election](#9-master-election)
10. [Network Resilience](#10-network-resilience)
11. [Visual Synchronization](#11-visual-synchronization)
12. [Web Platform Fallbacks](#12-web-platform-fallbacks)
13. [Security](#13-security)
14. [User Interface Integration](#14-user-interface-integration)
15. [Validation and Testing](#15-validation-and-testing)
16. [Comparison with Existing Protocols](#16-comparison-with-existing-protocols)
17. [Implementation Roadmap](#17-implementation-roadmap)
18. [References](#18-references)

---

## 1. Introduction

### 1.1 Problem Statement

Professional DJ performance and live electronic music production increasingly require synchronization across multiple software instances and hardware devices. A DJ may run two MIXI instances (one per laptop), a drum machine, and a VJ visual system — all locked to the same tempo, beat phase, and bar position.

Existing synchronization standards suffer from significant limitations:

- **MIDI Clock** (MIDI 1.0, 1983) transmits 24 pulses per quarter note with no phase, bar, or state information. It requires physical cabling and offers no peer discovery.
- **Ableton Link** (Ableton, 2016) provides BPM and beat phase sync over IP but carries no deck state, cue points, or visual trigger data. Its consensus-based tempo model introduces complexity unsuited to DJ workflows where one deck is definitively "the master."
- **Pioneer Pro DJ Link** (AlphaTheta, 2009) is a proprietary protocol embedded in CDJ hardware, requiring reverse-engineering efforts for interoperability and offering no web platform support.

### 1.2 Contribution

MIXI Sync addresses these limitations with a protocol that:

1. Carries **tempo, phase, bar position, deck state, onset triggers, and crossfader position** in a single 64-byte packet
2. Operates over **shared memory** (zero-copy, zero-latency) and **UDP** (<1 ms LAN)
3. Provides **automatic peer discovery** via UDP broadcast
4. Implements **deterministic master election** without distributed consensus
5. Includes **onset trigger bits** (kick, snare, hi-hat) for direct VJ integration
6. Supports **web browsers** via BroadcastChannel and WebRTC DataChannel fallbacks
7. Offers **optional HMAC-SHA256 signing** for hostile network environments

---

## 2. Design Goals

| ID | Goal | Constraint |
|----|------|-----------|
| G1 | Beat phase error < 2 ms after lock | PI controller convergence within 8 beats |
| G2 | Zero configuration for LAN sync | UDP broadcast discovery, no manual IP entry |
| G3 | Packet fits one cache line | 64 bytes, one UDP datagram |
| G4 | Master failover < 20 ms | No distributed consensus, deterministic promotion |
| G5 | No audible artifacts during sync | Pitch correction capped at ±2%, snap at >20% error |
| G6 | Web platform support | BroadcastChannel (same-origin), WebRTC (cross-origin) |
| G7 | VJ-ready onset data | Kick/snare/hi-hat trigger bits at 50 Hz |
| G8 | Hostile network tolerance | HMAC signing, sequence numbers, jitter filtering |

---

## 3. Related Work

### 3.1 MIDI Clock (MIDI 1.0 Specification, 1983)

MIDI Clock transmits three system real-time messages: Start (`0xFA`), Stop (`0xFC`), and Timing Clock (`0xF8`, 24 per quarter note). At 120 BPM, this produces a tick every 20.83 ms. The protocol carries no phase information — a slave joining mid-song cannot determine where in the bar the master is. MIDI Clock also lacks discovery; devices must be physically connected.

### 3.2 Ableton Link (Ableton, 2016)

Link uses a peer-to-peer model where all participants converge on a shared tempo via averaging. While elegant for jam sessions, this model is problematic for DJ use cases where Deck A's tempo should override Deck B's. Link provides beat phase but not bar position, track identification, or visual trigger data. The C++ SDK has no web platform implementation.

### 3.3 Pioneer Pro DJ Link (AlphaTheta Corporation)

Pro DJ Link operates over Ethernet using a proprietary binary protocol. It carries BPM, beat position, waveform previews, and track metadata. The protocol is undocumented; the open-source `prolink-connect` project (GitHub: EvanPurkhiser/prolink-connect) provides a partial reverse-engineering. No web or non-Pioneer implementation exists.

---

## 4. System Architecture

```
┌─────────────────────┐              ┌─────────────────────┐
│   MIXI Instance A    │              │   MIXI Instance B    │
│                      │              │                      │
│  AudioContext ───────┤              ├─────── AudioContext  │
│       │              │              │              │       │
│  SyncPublisher       │              │       SyncSubscriber │
│       │              │              │              │       │
│  ┌─────────────┐     │   Shared     │     ┌─────────────┐ │
│  │ SHM Backend │◄────┼──Memory──────┼────►│ SHM Backend │ │
│  └─────────────┘     │              │     └─────────────┘ │
│  ┌─────────────┐     │    LAN       │     ┌─────────────┐ │
│  │ UDP Backend │◄────┼──:4303───────┼────►│ UDP Backend │ │
│  └─────────────┘     │              │     └─────────────┘ │
│       │              │              │              │       │
│  MidiClockBridge ────┤              │              │       │
│       │              │              │              │       │
│  MIDI Out → Hardware │              │              │       │
└─────────────────────┘              └─────────────────────┘
```

**Roles.** Any instance may be a *Publisher* (tempo master), a *Subscriber* (tempo slave), or both (relay). Exactly one instance holds the `MASTER` flag at any time. Role transitions are governed by the Dynamic Dictatorship model (Section 9).

---

## 5. Transport Layers

### 5.1 Shared Memory (Intra-Machine)

For instances on the same operating system (e.g., two Electron windows):

**Discovery.** A fixed, well-known file `/tmp/mixi-sync-discovery` contains a JSON routing table mapping instance IDs to their shared memory segment paths:

```json
{
  "A2F3": "/tmp/mixi-sync-A2F3",
  "7B01": "/tmp/mixi-sync-7B01"
}
```

New instances read this file on startup, register themselves, and connect to existing peers' ring buffers.

**Data transfer.** Each instance maintains a memory-mapped ring buffer (`memmap2` crate in Rust) with atomic `u32` read/write heads. The publisher writes 64-byte packets; subscribers read them. Latency is bounded by cache coherence (~100 ns on modern x86/ARM).

### 5.2 UDP (Inter-Machine)

**Port.** `4303/udp` — the digits of "MIXI" on a T9 telephone keypad.

**Discovery.** `ANNOUNCE` packets are sent via UDP broadcast (`255.255.255.255:4303`) every 1000 ms. These are the *only* broadcast packets. A discovery table caches peer IP addresses; entries expire after 5000 ms without an ANNOUNCE.

**Heartbeat.** `HEARTBEAT` packets are sent via UDP **unicast** to each known peer IP every 20 ms (50 Hz). This avoids broadcast storms on Wi-Fi networks where access points may throttle or drop high-frequency broadcast traffic.

**Interface binding.** The UDP socket is bound to a specific network interface (auto-detected or user-selected in Settings) to prevent confusion on machines with multiple interfaces (Wi-Fi + Ethernet).

---

## 6. Packet Format

All multi-byte fields are **little-endian**. Implementations MUST use explicit conversion functions (Rust: `.to_le_bytes()` / `from_le_bytes()`; JavaScript: `DataView` with `littleEndian = true`). The packet is exactly **64 bytes** — one CPU cache line, one minimal UDP payload.

```
Offset  Bytes  Type     Field            Description
────────────────────────────────────────────────────────────
 0       4     u8[4]    magic            "MXS\0" (0x4D 0x58 0x53 0x00)
 4       1     u8       version          Protocol version (1)
 5       1     u8       type             Packet type (Table 1)
 6       2     u16      sequence         Monotonic packet counter
 8       8     f64      timestamp        Sender's audio clock, epoch-adjusted (§7)
16       4     f32      bpm              Tempo in beats per minute (0.0 = stopped)
20       4     f32      beat_phase       Position within current beat [0.0, 1.0)
24       4     u32      beat_count       Beats elapsed since session epoch
28       1     u8       time_sig_num     Time signature numerator (default 4)
29       1     u8       time_sig_den     Time signature denominator (default 4)
30       1     u8       deck_id          Source: 0x00=A, 0x01=B, 0xFF=master bus
31       1     u8       flags            Bit field (Table 2)
32       4     f32      crossfader       Position [0.0=A, 0.5=center, 1.0=B]
36       4     f32      master_volume    Master output level [0.0, 1.0]
40       1     u8       energy_rms       Audio RMS energy [0, 255]
41       1     u8       triggers         Onset trigger bits (Table 3)
42       2     u16      sender_id        Random instance identifier
44       4     f32      pitch_nudge      Manual pitch bend offset [−1.0, +1.0]
48       8     u8[8]    track_hash       Audio content fingerprint (§6.4)
56       4     f32      net_offset       NTP-derived clock offset in seconds (§7)
60       4     u8[4]    reserved         Zero-filled, future use
```

**Derived fields.** Bar phase is intentionally omitted to save 4 bytes. It is computed by receivers as:

```
bar_phase = (beat_count % time_sig_num + beat_phase) / time_sig_num
```

### Table 1: Packet Types

| Value | Name | Rate | Transport | Description |
|-------|------|------|-----------|-------------|
| `0x01` | HEARTBEAT | 50 Hz | Unicast | Core sync data |
| `0x02` | ANNOUNCE | 1 Hz | Broadcast | Peer discovery |
| `0x03` | TRANSPORT | Event | Unicast | Play/stop/cue transitions |
| `0x04` | CUE_POINT | Event | Unicast | Hot cue creation/deletion |
| `0x05` | DECK_LOAD | Event | Unicast | Track loaded (sends hash) |
| `0x06` | NTP_REQ | On connect | Unicast | Clock sync request (§7) |
| `0x07` | NTP_RESP | On connect | Unicast | Clock sync response |
| `0x08` | DICTATOR | Event | Broadcast | Force master claim (§9) |
| `0x10` | CUSTOM | Variable | Unicast | User-defined extension |

### Table 2: Flags Bit Field

| Bit | Name | Description |
|-----|------|-------------|
| 0 | PLAYING | Deck transport is running |
| 1 | MASTER | This instance is the tempo master |
| 2 | SYNCED | Locked to an external master |
| 3 | RECORDING | Disk recording is active |
| 4 | VFX_ACTIVE | GPU visual engine is running |
| 5 | NUDGING | PI controller is correcting phase |
| 6 | FLYWHEEL | Master lost; free-running on last BPM |
| 7 | DICTATOR | Force-master override is active |

### Table 3: Trigger Bits

| Bit | Instrument | Detection Method |
|-----|-----------|-----------------|
| 0 | Kick drum | FFT bins 1–2 (20–80 Hz), energy derivative > threshold |
| 1 | Snare | FFT bins 6–17 (1–3 kHz), energy derivative > threshold |
| 2 | Hi-hat | FFT bins 46–87 (8–15 kHz), energy derivative > threshold |
| 3–7 | Reserved | |

### 6.4 Track Fingerprint

The `track_hash` field identifies the loaded audio content independently of file name or metadata. It is the first 8 bytes of a SHA-256 digest computed over:

1. The total sample count as a `u64`
2. The sample rate as a `u32`
3. The first 4096 audio samples as `f32` values

This produces a deterministic fingerprint that survives file renaming, re-encoding at the same sample rate, and metadata edits.

---

## 7. Clock Synchronization

### 7.1 The Drift Problem

Digital audio clocks derive from hardware crystal oscillators. Two machines' `AudioContext.currentTime` values drift at rates of 1–50 ppm (parts per million), accumulating 0.06–3.0 ms of error per minute. For phase-lock accuracy of <2 ms, clock offset must be measured and compensated.

### 7.2 Mini-NTP Exchange

On initial connection, the subscriber initiates a 4-round clock synchronization exchange:

```
Round i:
  1. Subscriber records local time T1, sends NTP_REQ{T1}
  2. Master receives at local time T2, sends NTP_RESP{T1, T2, T3=now}
  3. Subscriber receives at local time T4
  4. Round-trip time:  RTT_i = (T4 - T1) - (T3 - T2)
  5. Clock offset:     Θ_i = ((T2 - T1) + (T3 - T4)) / 2
```

The final offset is the **median** of {Θ₁, Θ₂, Θ₃, Θ₄}, rejecting outliers from network jitter. This offset is stored in the `net_offset` field of outgoing packets and used by receivers to translate timestamps into their local clock domain.

### 7.3 Session Epoch

The first instance to publish defines `epoch₀ = AudioContext.currentTime` at the moment of its first HEARTBEAT. All `beat_count` values are relative to this epoch. NTP offsets map the epoch across machines, establishing a shared linear time base.

---

## 8. Phase Lock Algorithm

### 8.1 PI Controller

The subscriber maintains a Proportional-Integral (PI) controller that computes a playback rate correction from the phase error:

```
e[n]        = master_phase − local_phase        (phase error)
I[n]        = I[n−1] + e[n]                     (integral accumulator)
I[n]        = clamp(I[n], −1.0, +1.0)           (anti-windup)
correction  = Kp · e[n] + Ki · I[n]             (PI output)
correction  = clamp(correction, −0.02, +0.02)   (audibility limit, §8.3)
```

Default gains: **Kp = 0.8**, **Ki = 0.05**. These converge within 4–8 beats for typical phase errors of 5–15%.

### 8.2 Hysteresis

To prevent oscillation at the lock boundary:

- **Unlock threshold**: correction activates when `|e| > 0.02` (2% of a beat)
- **Lock threshold**: correction deactivates when `|e| < 0.002` (0.2% of a beat)
- **Dead zone**: between 0.002 and 0.02, the controller maintains its current state (locked or unlocked)

This 10:1 hysteresis ratio eliminates jitter at the lock boundary caused by network timing variance.

### 8.3 Audibility Limit

Pitch correction of >2% is perceptible as key shift. If the phase error exceeds 20% of a beat (indicating a sync restart or large disruption), the controller does **not** attempt gradual nudging. Instead, it performs a **phase snap**: seeking the audio playback position with a 10 ms crossfade to mask the discontinuity.

### 8.4 Flywheel Mode

If no HEARTBEAT is received within 150 ms:

| Elapsed | Action |
|---------|--------|
| 0–50 ms | Normal network jitter; no action |
| 50–100 ms | Increase jitter filter smoothing (trust local clock) |
| 100–150 ms | Set FLYWHEEL flag; UI warning (yellow blink) |
| >150 ms | Declare master dead; maintain last BPM free-running |
| >200 ms | Auto-promote to master if `PLAYING` flag is set |

The flywheel ensures audio never stops or glitches due to network interruption.

---

## 9. Master Election

### 9.1 Dynamic Dictatorship

MIXI Sync uses a non-consensus model:

1. The first instance to set `PLAYING` becomes master and sets the `MASTER` flag
2. If the master stops playing, the subscriber with `PLAYING` and `volume > 0` auto-promotes within one heartbeat interval (20 ms)
3. Tie-break: lowest `sender_id` wins
4. No voting, no quorum, no split-brain — exactly one master at all times

### 9.2 Force Override

A user may press "Force Master" in the UI, which sends a `DICTATOR` packet (type `0x08`) via broadcast. All instances receiving this packet that currently hold `MASTER` must yield immediately — clearing their `MASTER` flag and transitioning to subscriber mode within one heartbeat.

---

## 10. Network Resilience

### 10.1 Jitter Filtering

Raw phase measurements from UDP packets contain network jitter (typically 0.5–5 ms on LAN, 10–50 ms on Wi-Fi). A first-order exponential moving average filter smooths the input:

```
filtered_phase = α · raw_phase + (1 − α) · filtered_phase
```

Default **α = 0.15** (heavy smoothing). This acts as a flywheel: the local clock free-runs between heartbeats, with periodic corrections from the master.

### 10.2 Sequence Ordering

Each packet carries a monotonic `u16` sequence number. The receiver discards packets where:

```
diff = incoming_seq − last_seq    (wrapping subtraction)
discard if: diff == 0 OR diff ≥ 32768
```

This handles both duplicates and reordering within a half-sequence window (32768 packets ≈ 10.9 minutes at 50 Hz).

### 10.3 Broadcast Storm Prevention

Only `ANNOUNCE` packets use broadcast (1 Hz). All `HEARTBEAT` packets use unicast to discovered peer IPs. This prevents Wi-Fi access points from throttling or dropping high-frequency broadcast traffic.

---

## 11. Visual Synchronization

### 11.1 Energy and Triggers

The `energy_rms` field (u8, 0–255) carries the master's audio RMS level at 50 Hz — sufficient for smooth VFX intensity modulation.

The `triggers` field carries per-instrument onset detection bits, updated each heartbeat. External VJ software (Resolume, TouchDesigner, custom WebGPU shaders) can listen on UDP port 4303 and extract these bits to drive beat-reactive visuals **without performing any audio analysis**.

### 11.2 VJ Integration Example

```python
# Resolume / TouchDesigner OSC bridge (example)
import socket, struct

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', 4303))

while True:
    data, addr = sock.recvfrom(64)
    if data[:4] != b'MXS\0': continue
    bpm      = struct.unpack_from('<f', data, 16)[0]
    phase    = struct.unpack_from('<f', data, 20)[0]
    energy   = data[40]
    triggers = data[41]
    kick     = bool(triggers & 0x01)
    snare    = bool(triggers & 0x02)
    hihat    = bool(triggers & 0x04)
    # → Forward to OSC, MIDI, or GPU shader uniforms
```

---

## 12. Web Platform Fallbacks

When the Rust/N-API transport is unavailable (browser-only deployment), the protocol degrades gracefully:

### Priority Order

| Priority | Transport | Scope | Latency | Phase Lock |
|----------|-----------|-------|---------|-----------|
| 1 | Shared Memory | Same OS | ~0 µs | Full |
| 2 | UDP Unicast | LAN | <1 ms | Full |
| 3 | BroadcastChannel | Same origin | ~0 µs | Full |
| 4 | WebRTC DataChannel | Cross-origin | 1–10 ms | Full |
| 5 | WebSocket | Any | 30–50 ms | BPM-follow only |

### BroadcastChannel (same-origin tabs)

```typescript
const channel = new BroadcastChannel('mixi-sync');
// Transfer raw ArrayBuffer — zero JSON serialization, zero GC pressure
channel.postMessage(packet.buffer);
```

### WebRTC DataChannel (cross-origin browsers)

```typescript
const dc = peerConnection.createDataChannel('mixi-sync', {
    ordered: false,     // UDP-like: no head-of-line blocking
    maxRetransmits: 0,  // Fire and forget
});
```

This is the only web-standard mechanism for cross-machine phase-lock quality sync without native code.

### WebSocket (degraded mode)

Via the Python sidecar (`ws://localhost:8000/ws/sync`). TCP + Python introduce 30–50 ms of jitter. Suitable **only** for `TRANSPORT` and `CUE_POINT` packets — never for `HEARTBEAT`.

---

## 13. Security

### 13.1 Threat Model

In a club or festival environment, the LAN may be shared with untrusted devices. An attacker on the same network could:

- Inject `DICTATOR` packets to seize tempo master
- Inject `TRANSPORT` packets to stop playback
- Flood `HEARTBEAT` packets with incorrect BPM to desync the set

### 13.2 HMAC-SHA256 Packet Signing

When enabled (Settings → Sync → Session Key), packets are extended to 96 bytes:

```
[64 bytes: standard packet][32 bytes: HMAC-SHA256(packet, shared_secret)]
```

Receivers compute the HMAC over the first 64 bytes using the configured shared secret. Packets with invalid signatures are silently discarded. The shared secret is entered identically on all participating instances.

**No encryption** is applied — sync data (BPM, phase, flags) is not sensitive, and AES would add unnecessary CPU overhead to the 50 Hz packet path.

### 13.3 Identifier Collision

The `sender_id` field is a random `u16` (65536 values), sufficient for LAN deployments. For future internet-tunneled deployments (MIXI Cloud), the `reserved` bytes may be repurposed to extend the identifier to 48 or 64 bits.

---

## 14. User Interface Integration

### 14.1 Sync Status Indicator

The SYNC button on the main interface uses color to communicate state:

| Color | Animation | State | Meaning |
|-------|-----------|-------|---------|
| Gray | None | OFF | Sync disabled |
| Yellow | Blink 2 Hz | FLYWHEEL | Master lost, free-running |
| Cyan | Solid | LOCKED | Phase error < 0.2%, perfectly synced |
| Green | Pulse | NUDGING | PI controller actively correcting |
| Red | Solid | DICTATOR | Force Master override active |

### 14.2 Sync Radar

Settings → System → Sync panel displays a circular radar:
- Center dot = this instance
- Peer dots positioned by measured network latency (closer = lower RTT)
- Dot color reflects peer state (playing, stopped, master, synced)
- Dot label shows peer name + BPM

### 14.3 Network Offset Compensation

Settings → Sync → `Network Sync Offset: [−50 ms ... +50 ms]`

Compensates for physical audio latency when playback is monitored from another machine's speakers. The offset shifts the phase lock target by the configured amount.

---

## 15. Validation and Testing

### 15.1 Chaos Monkey

Before release, the protocol implementation must survive a stress test that sends malformed packets to `127.0.0.1:4303`:

| Test | Payload |
|------|---------|
| Corrupted magic | `"XXX\0"` + 60 random bytes |
| Negative BPM | `bpm = −500.0` |
| NaN timestamp | `timestamp = f64::NAN` |
| Future version | `version = 99` |
| Reversed sequence | Sequence numbers 1000, 999, 998, ... |
| DICTATOR flood | 100 × DICTATOR packets in 100 ms |
| Extreme BPM | `bpm = 999.0` |
| Zero-length packet | 0 bytes |
| Oversized packet | 65535 bytes |
| All-zeros packet | 64 × `0x00` |

**Pass criteria.** The AudioWorklet continues playback without interruption. The sync engine logs warnings but does not crash, panic, or produce audio artifacts.

### 15.2 Phase Lock Accuracy

Test with two instances on the same machine (shared memory transport):
1. Instance A plays at 128 BPM
2. Instance B subscribes with 500 ms initial phase offset
3. Measure convergence time to `|error| < 0.002`
4. Expected: <8 beats (3.75 seconds at 128 BPM)

### 15.3 Failover Timing

1. Instance A is master, playing at 140 BPM
2. Kill Instance A's process (SIGKILL)
3. Measure time until Instance B promotes to master
4. Expected: <200 ms, with no audible tempo discontinuity

---

## 16. Comparison with Existing Protocols

| Feature | MIDI Clock | Ableton Link | Pro DJ Link | **MIXI Sync** |
|---------|-----------|--------------|-------------|---------------|
| Tempo sync | 24 ppqn | Yes | Yes | **Yes** |
| Beat phase | No | Yes | Yes | **Yes (PI lock)** |
| Bar position | No | No | Yes | **Yes (derived)** |
| Deck state | No | No | Partial | **Full (8-bit flags)** |
| Crossfader | No | No | No | **Yes** |
| VFX triggers | No | No | No | **Yes (3 onsets)** |
| Cue points | No | No | No | **Yes** |
| Track ID | No | No | Yes | **Yes (audio hash)** |
| Pitch nudge state | No | No | No | **Yes** |
| Discovery | Manual | mDNS | Proprietary | **UDP broadcast** |
| Latency (local) | ~1 ms | ~1 ms | ~5 ms | **~0 µs (SHM)** |
| Latency (LAN) | N/A | ~1 ms | ~5 ms | **<1 ms (unicast)** |
| Jitter handling | None | PLL | Unknown | **EMA + hysteresis** |
| Master model | Fixed | Consensus | Fixed | **Dynamic Dictatorship** |
| Web support | WebMIDI | No | No | **3 fallbacks** |
| Security | None | None | None | **HMAC-SHA256** |
| Implementation | Hardware | C++ | Proprietary | **Rust** |
| Packet size | 1 byte | ~40 bytes | ~100 bytes | **64 bytes** |

---

## 17. Implementation Roadmap

| Phase | Deliverable | Key Requirements |
|-------|-------------|-----------------|
| **v1.0** | UDP heartbeat + phase lock | NTP sync, PI controller, jitter filter, sequence numbers |
| **v1.0** | Peer discovery | UDP broadcast ANNOUNCE, discovery table, interface binding |
| **v1.0** | Flywheel + failover | 150 ms timeout, auto-promote, BPM hold |
| **v1.0** | Settings UI | Sync radar, status colors, offset slider |
| **v1.0** | Chaos Monkey | All 10 test vectors passing |
| **v1.1** | Shared memory backend | Discovery file, memmap2 ring buffer |
| **v1.1** | MIDI Clock bridge | Auto-generate 24 ppqn from sync heartbeat |
| **v1.1** | DICTATOR override | Force-master packet, immediate yield |
| **v1.1** | HMAC signing | 96-byte signed packets, shared secret |
| **v2.0** | Cue point sharing | Packet type 0x04, bidirectional |
| **v2.0** | BroadcastChannel fallback | ArrayBuffer transfer, zero serialization |
| **v2.0** | WebRTC DataChannel | Unordered, unreliable, peer-to-peer |
| **v3.0** | MIXI Cloud tunneling | Extended sender_id, STUN/TURN relay |

---

## 18. References

1. MIDI Manufacturers Association. *MIDI 1.0 Detailed Specification*. 1983.
2. Ableton AG. *Link: A technology for synchronizing musical beat, tempo, and phase across multiple applications*. 2016. https://ableton.github.io/link/
3. EvanPurkhiser. *prolink-connect: Library for communicating with Pioneer DJ equipment*. GitHub. https://github.com/EvanPurkhiser/prolink-connect
4. Mills, D. *Network Time Protocol Version 4: Protocol and Algorithms Specification*. RFC 5905, IETF, 2010.
5. Web Audio API. W3C Recommendation. https://www.w3.org/TR/webaudio/
6. WebRTC 1.0: Real-Time Communication Between Browsers. W3C Recommendation. https://www.w3.org/TR/webrtc/
7. WebMIDI API. W3C Working Draft. https://www.w3.org/TR/webmidi/

---

*Document generated from the MIXI project repository. For the latest version, see `MIXI_PROTOCOL.md` in the source tree.*
