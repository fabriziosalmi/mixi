# MIXI Sync Protocol

**A Low-Latency Dual-Transport Synchronization Protocol for Distributed Audio Workstations**

---

|   |   |
|---|---|
| **Document** | MIXI Sync Protocol Specification |
| **Version** | v0.2.6-draft |
| **Date** | 2026-04-05 |
| **Authors** | Fabrizio Salmi |
| **Status** | Pre-implementation draft |
| **License** | PolyForm Noncommercial 1.0.0 |
| **Repository** | github.com/fabriziosalmi/mixi |

---

## Abstract

This document specifies **MIXI Sync**, a binary synchronization protocol designed for real-time tempo, phase, and state coordination between multiple instances of the MIXI audio workstation and external audiovisual equipment. The protocol operates over two transport layers — shared memory with Seqlock (intra-machine, ~0 us latency) and UDP unicast (inter-machine, <1 ms LAN latency) — and defines a 64-byte cache-line-aligned packet carrying BPM, beat phase (fixed-point u32), predictive onset triggers, deck state, and continuous NTP clock synchronization data at 50 Hz. A PID-controller phase lock algorithm with hysteresis and gain scheduling achieves sub-2 ms beat alignment without audible pitch artifacts. The protocol requires no central server, uses UDP broadcast for peer discovery, and elects a tempo master via a deterministic Dynamic Dictatorship model with epoch-generation split-brain resolution.

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
15. [Graceful Degradation](#15-graceful-degradation)
16. [Validation and Testing](#16-validation-and-testing)
17. [Comparison with Existing Protocols](#17-comparison-with-existing-protocols)
18. [Implementation Roadmap](#18-implementation-roadmap)
19. [References](#19-references)

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

1. Carries **tempo, phase, bar position, deck state, predictive onset triggers, EQ state, and crossfader position** in a single 64-byte packet
2. Operates over **shared memory with Seqlock** (zero-copy, zero-latency) and **UDP unicast** (<1 ms LAN)
3. Provides **automatic peer discovery** via UDP broadcast
4. Implements **deterministic master election** with epoch-generation split-brain resolution
5. Includes **predictive onset countdown** (kick, snare, hi-hat) for frame-accurate VJ integration
6. Supports **web browsers** via BroadcastChannel and WebRTC DataChannel fallbacks
7. Offers **optional HMAC-SHA256 signing** with anti-replay sliding window for hostile network environments
8. Uses **continuous NTP** with Cristian's intersection algorithm for sub-millisecond clock drift compensation
9. Employs a **PID controller** with gain scheduling for inaudible phase correction

---

## 2. Design Goals

| ID | Goal | Constraint |
|----|------|-----------|
| G1 | Beat phase error < 2 ms after lock | PID controller convergence within 8 beats |
| G2 | Zero configuration for LAN sync | UDP broadcast discovery, no manual IP entry |
| G3 | Packet fits one cache line | 64 bytes, memory-aligned, one UDP datagram |
| G4 | Master failover < 20 ms | Dynamic Dictatorship with epoch generation |
| G5 | No audible artifacts during sync | Gain scheduling: aggressive when silent, gentle when audible |
| G6 | Web platform support | BroadcastChannel (same-origin), WebRTC (cross-origin) |
| G7 | VJ-ready predictive onset data | Countdown triggers at 50 Hz, not reactive |
| G8 | Hostile network tolerance | HMAC + anti-replay window + rate limiting |
| G9 | Continuous clock drift compensation | Background NTP every 5s, slew-only adjustment |
| G10 | Hours-long stability | Fixed-point phase (u32), monotonic beat_count |

---

## 3. Related Work

### 3.1 MIDI Clock (MIDI 1.0 Specification, 1983)

MIDI Clock transmits three system real-time messages: Start (`0xFA`), Stop (`0xFC`), and Timing Clock (`0xF8`, 24 per quarter note). At 120 BPM, this produces a tick every 20.83 ms. The protocol carries no phase information — a slave joining mid-song cannot determine where in the bar the master is. MIDI Clock also lacks discovery; devices must be physically connected.

### 3.2 Ableton Link (Ableton, 2016)

Link uses a peer-to-peer model where all participants converge on a shared tempo via averaging. While elegant for jam sessions, this model is problematic for DJ use cases where Deck A's tempo should override Deck B's. Link provides beat phase but not bar position, track identification, or visual trigger data. The C++ SDK has no web platform implementation.

### 3.3 Pioneer Pro DJ Link (AlphaTheta Corporation)

Pro DJ Link operates over Ethernet using a proprietary binary protocol. It carries BPM, beat position, waveform previews, and track metadata. The protocol is undocumented; the open-source `prolink-connect` project provides a partial reverse-engineering. No web or non-Pioneer implementation exists.

---

## 4. System Architecture

```
+---------------------+              +---------------------+
|   MIXI Instance A    |              |   MIXI Instance B    |
|                      |              |                      |
|  AudioContext -------|              |------- AudioContext  |
|       |              |              |              |       |
|  SyncPublisher       |              |       SyncSubscriber |
|       |              |              |              |       |
|  +-------------+     |   Shared     |     +-------------+ |
|  | SHM+Seqlock |<----|--Memory------|---->| SHM+Seqlock | |
|  +-------------+     |              |     +-------------+ |
|  +-------------+     |    LAN       |     +-------------+ |
|  | UDP Backend |<----|--:4303-------|---->| UDP Backend | |
|  +-------------+     |              |     +-------------+ |
|       |              |              |              |       |
|  MidiClockBridge ----|              |              |       |
|       |              |              |              |       |
|  MIDI Out -> Gear    |              |              |       |
+---------------------+              +---------------------+
```

**Roles.** Any instance may be a *Publisher* (tempo master), a *Subscriber* (tempo slave), or both (relay). Exactly one instance holds the `MASTER` flag at any time, identified by the highest `epoch_generation` value. Role transitions are governed by the Dynamic Dictatorship model (Section 9).

---

## 5. Transport Layers

### 5.1 Shared Memory (Intra-Machine)

**Discovery.** A fixed, well-known file `/tmp/mixi-sync-discovery` contains a JSON routing table mapping instance IDs to their shared memory segment paths.

**Seqlock (Amendment #14).** The ring buffer uses a Sequence Lock instead of a mutex to prevent data tearing without blocking:

```
Publisher:
  1. Increment atomic counter to ODD (signals "writing in progress")
  2. Write 64-byte packet
  3. Increment atomic counter to EVEN (signals "write complete")

Subscriber:
  1. Read counter (must be EVEN)
  2. Read 64-byte packet
  3. Read counter again
  4. If counter changed or was ODD: discard, retry
```

Latency is bounded by cache coherence (~100 ns). No mutex, no blocking, no priority inversion.

**Cache Line Alignment (Amendment #15).** The ring buffer head and tail pointers MUST be separated by at least 64 bytes of padding (`#[repr(align(64))]` in Rust) to prevent false sharing between CPU cores.

### 5.2 UDP (Inter-Machine)

**Port.** `4303/udp` — the digits of "MIXI" on a T9 telephone keypad.

**Discovery.** `ANNOUNCE` packets are sent via UDP broadcast (`255.255.255.255:4303`) every 1000 ms. These are the *only* broadcast packets.

**Heartbeat.** `HEARTBEAT` packets are sent via UDP **unicast** to each known peer IP every 20 ms (50 Hz). This avoids broadcast storms on Wi-Fi networks.

**Interface binding (Amendment #8 from v1).** The UDP socket is bound to a specific network interface (auto-detected or user-selected in Settings).

---

## 6. Packet Format

All multi-byte fields are **little-endian**. Implementations MUST use explicit `.to_le_bytes()` / `from_le_bytes()` conversion. Fields are ordered by **descending alignment requirement** (f64 first, then f32, then u32, u16, u8) to ensure natural memory alignment on all architectures including ARM and Wasm (Amendment #12).

The packet is exactly **64 bytes** — one CPU cache line, one minimal UDP payload.

```
Offset  Bytes  Type     Field              Description
--------------------------------------------------------------------------
 0       4     u8[4]    magic              "MXS\0" (0x4D 0x58 0x53 0x00)
 4       1     u8       version            Protocol version (1)
 5       1     u8       type               Packet type (Table 1)
 6       2     u16      sequence           Monotonic packet counter
 8       8     f64      timestamp          Fused audio+perf clock, epoch-adjusted (S7)
16       4     f32      bpm                Tempo in beats per minute (0.0 = stopped)
20       4     u32      beat_phase_fp      Phase within beat as fixed-point [0, 2^32) (S6.1)
24       4     u32      beat_count         Beats elapsed since session epoch (monotonic, S6.2)
28       4     u32      epoch_generation   Master election epoch counter (S9.1)
32       4     f32      crossfader         Position [0.0=A, 0.5=center, 1.0=B]
36       4     f32      master_volume      Master output level [0.0, 1.0]
40       4     f32      pitch_nudge        Manual pitch bend offset [-1.0, +1.0]
44       4     f32      net_offset         NTP-derived clock offset in seconds (S7)
48       2     u16      sender_id          Random instance identifier
50       1     u8       time_sig_num       Time signature numerator (default 4)
51       1     u8       deck_id            Source: 0x00=A, 0x01=B, 0xFF=master bus
52       1     u8       flags              Bit field (Table 2)
53       1     u8       energy_rms         Audio RMS energy [0, 255]
54       1     u8       triggers           Predictive onset countdown (Table 3)
55       1     u8       eq_bass            Low EQ state [0=kill, 128=0dB, 255=+12dB]
56       8     u8[8]    track_hash         Audio content fingerprint (S6.3)
```

### 6.1 Fixed-Point Beat Phase (Amendment #22)

The `beat_phase_fp` field uses a `u32` mapped to the range [0.0, 1.0):

```
beat_phase_float = beat_phase_fp / 4294967296.0   (2^32)
beat_phase_fp    = (u32)(beat_phase_float * 4294967296.0)
```

This provides ~0.23 nanosecond resolution (vs ~60 ns for f32), eliminating floating-point accumulation errors across hours of playback and guaranteeing bit-identical results on all architectures.

### 6.2 Monotonic beat_count (Amendment #23)

The `beat_count` field MUST advance monotonically regardless of loop state. When the master deck enters a loop, `beat_count` continues incrementing even as the audio playback position repeats. This prevents slaves from entering undefined states when the master loops.

An `IS_LOOPING` flag is carried in the `flags` field (bit 7, repurposed from DICTATOR which moves to packet type).

### 6.3 Track Fingerprint

The `track_hash` field identifies the loaded audio content independently of file name or metadata. It is the first 8 bytes of a SHA-256 digest computed over the total sample count (`u64`), sample rate (`u32`), and the first 4096 audio samples (`f32`).

### 6.4 Changes from v1.0-draft

| Change | Amendment | Rationale |
|--------|-----------|-----------|
| `beat_phase` f32 -> `beat_phase_fp` u32 | #22 | Sub-ns resolution, no float drift |
| `time_sig_den` removed | #24 | Always 4 in electronic music, byte used for `eq_bass` |
| `epoch_generation` u32 added | #9 | Split-brain resolution |
| `eq_bass` u8 added | #17 | VJ needs per-band EQ state |
| `bar_phase` derived, not transmitted | #11 v1 | `(beat_count % time_sig_num + phase) / time_sig_num` |
| Fields reordered by alignment | #12 | Natural alignment for ARM/Wasm |
| `DICTATOR` moved to packet type | #24 | Freed bit 7 for `IS_LOOPING` |
| `triggers` now predictive countdown | #16 | Frame-accurate VJ sync |

### Table 1: Packet Types

| Value | Name | Rate | Transport | Description |
|-------|------|------|-----------|-------------|
| `0x01` | HEARTBEAT | 50 Hz | Unicast | Core sync data |
| `0x02` | ANNOUNCE | 1 Hz | Broadcast | Peer discovery |
| `0x03` | TRANSPORT | Event | Unicast | Play/stop/cue (NO_SYNC flag set, S6.5) |
| `0x04` | CUE_POINT | Event | Unicast | Hot cue creation/deletion |
| `0x05` | DECK_LOAD | Event | Unicast | Track loaded (sends hash) |
| `0x06` | NTP_REQ | Every 5s | Unicast | Continuous clock sync request (S7) |
| `0x07` | NTP_RESP | On request | Unicast | Clock sync response |
| `0x08` | DICTATOR | Event | Broadcast | Force master claim (S9.2) |
| `0x09` | DYING | Event | Broadcast | Graceful shutdown (S9.3) |
| `0x10` | CUSTOM | Variable | Unicast | User-defined extension |

### 6.5 TRANSPORT Packet Handling (Amendment #13)

TRANSPORT packets (play/stop/cue) are event-driven, not periodic. Their `timestamp` field MUST NOT be processed by the PLL/PID controller, as they lack the 50 Hz rhythm. Receivers identify them by `type == 0x03` and extract only the transport command, ignoring phase/timing fields.

### Table 2: Flags Bit Field

| Bit | Name | Description |
|-----|------|-------------|
| 0 | PLAYING | Deck transport is running |
| 1 | MASTER | This instance is the tempo master |
| 2 | SYNCED | Locked to an external master |
| 3 | RECORDING | Disk recording is active |
| 4 | VFX_ACTIVE | GPU visual engine is running |
| 5 | NUDGING | PID controller is correcting phase |
| 6 | FLYWHEEL | Master lost; free-running on last BPM |
| 7 | IS_LOOPING | Master deck is in a loop (beat_count still monotonic) |

### Table 3: Predictive Trigger Countdown (Amendment #16)

The `triggers` byte does **not** carry reactive onset flags. Instead, it carries a **countdown** to the next predicted onset, enabling VJ software to pre-render frames:

| Bits | Field | Description |
|------|-------|-------------|
| 0-2 | kick_countdown | Heartbeats until next predicted kick (0 = NOW, 7 = far) |
| 3-5 | snare_countdown | Heartbeats until next predicted snare (0 = NOW, 7 = far) |
| 6-7 | hihat_countdown | Heartbeats until next predicted hi-hat (0 = NOW, 3 = far) |

At 50 Hz, a countdown of 3 = 60 ms of pre-warning. VJ software reads the countdown, pre-renders the explosion frame, and displays it at countdown=0 in perfect sync with the audio leaving the speakers.

---

## 7. Clock Synchronization

### 7.1 The Drift Problem

Digital audio clocks derive from hardware crystal oscillators. Two machines' `AudioContext.currentTime` values drift at rates of 1-50 ppm (parts per million), accumulating 0.06-3.0 ms of error per minute. At 50 ppm, two laptops desync by 3 ms every 60 seconds.

### 7.2 Continuous NTP (Amendment #1)

Clock synchronization is NOT a one-time operation. The Mini-NTP exchange runs **continuously** in the background:

- **Initial**: 4-round exchange on first connection (median offset)
- **Ongoing**: 1 NTP_REQ/NTP_RESP every 5 seconds
- **Adjustment**: **Slew** (gradual drift), never **Step** (instant jump) — prevents phase discontinuities

### 7.3 Asymmetric Routing Compensation (Amendment #2)

Standard NTP assumes symmetric paths (`T2 - T1 == T4 - T3`). On Wi-Fi, upload and download latencies differ. The implementation uses Cristian's intersection algorithm: if the asymmetry ratio exceeds 3:1, the sample is discarded. Only samples where `|RTT_forward - RTT_reverse| < RTT_total * 0.5` are accepted.

### 7.4 Audio-Clock Fusion (Amendment #3)

`AudioContext.currentTime` updates in block-sized steps (~2.9 ms at 128 samples / 44.1 kHz). Reading it directly for packet timestamps introduces quantization jitter. The implementation fuses two clocks:

```
fused_time = last_audio_block_time + (performance.now() - last_audio_block_perf_time)
```

This interpolates between audio block boundaries using `performance.now()` (microsecond resolution), anchored to the last known `AudioContext.currentTime` value.

### 7.5 Session Epoch (Amendment #28 from v1)

The first publisher defines `epoch_0 = fused_time` at its first HEARTBEAT. All `beat_count` values are relative to this epoch. NTP offsets map the epoch across machines.

---

## 8. Phase Lock Algorithm

### 8.1 PID Controller (Amendment #5)

The subscriber maintains a Proportional-Integral-Derivative (PID) controller. The Derivative term prevents overshoot when the master makes abrupt pitch changes:

```
e[n]        = master_phase - local_phase        (phase error, wrapped)
de          = e[n] - e[n-1]                     (derivative)
I[n]        = I[n-1] + e[n]                     (integral)
I[n]        = clamp(I[n], -1.0, +1.0)           (anti-windup)
correction  = Kp * e[n] + Ki * I[n] + Kd * de   (PID output)
correction  = clamp(correction, -0.02, +0.02)   (audibility limit)
```

### 8.2 Gain Scheduling (Amendment #6)

The PID gains are NOT fixed. They adapt to the slave deck's audibility:

| Slave Volume | Kp | Ki | Kd | Rationale |
|-------------|----|----|-----|-----------|
| 0.0 (silent) | 1.0 | 0.2 | 0.0 | Instant lock, nobody hears it |
| 0.0 - 0.3 (quiet) | 0.5 | 0.1 | 0.1 | Moderate correction |
| 0.3 - 0.7 (audible) | 0.15 | 0.03 | 0.2 | Gentle, inaudible nudging |
| 0.7 - 1.0 (full) | 0.05 | 0.01 | 0.3 | Minimal correction, heavy damping |

This hides aggressive corrections when the track is silent (e.g., fader down, waiting to mix in).

### 8.3 Phase Unwrapping (Amendment #7)

Beat phase is circular (0.0 wraps to 1.0). A raw error of 0.98 must be interpreted as -0.02, not +0.98:

```
wrapped_error = ((raw_error + 0.5) % 1.0) - 0.5
```

This ensures the controller always corrects via the shortest path.

### 8.4 Tempo Ramping / Slew Rate Limit (Amendment #8)

When the master's BPM changes:

| Delta BPM | Action |
|-----------|--------|
| < 0.5 | Instant match (within normal pitch drift) |
| 0.5 - 5.0 | Ramp at max 1 BPM/second |
| > 5.0 | Instant jump (track change assumed) |

The 1 BPM/second limit prevents audible glissando during gradual tempo adjustments.

### 8.5 Hysteresis

- **Unlock threshold**: correction activates when `|e| > 0.02` (2% of a beat)
- **Lock threshold**: correction deactivates when `|e| < 0.002` (0.2% of a beat)
- **Dead zone**: 10:1 ratio eliminates jitter at the lock boundary

### 8.6 Snap Threshold

If `|phase_error| > 0.20` (20%), perform a **phase snap**: seek the audio playback position with a 10 ms crossfade. Do not attempt PID correction for large errors.

### 8.7 Dead Reckoning (Amendment #4)

If heartbeat packets are lost, the slave extrapolates the master's position:

```
estimated_phase = last_known_phase + (elapsed_time * bpm / 60.0)
```

This prevents micro-stutter during transient packet loss (up to 150 ms).

### 8.8 Flywheel Mode

| Elapsed without heartbeat | Action |
|--------------------------|--------|
| 0-50 ms | Normal jitter; dead reckoning |
| 50-100 ms | Increase jitter filter smoothing |
| 100-150 ms | Set FLYWHEEL flag; UI warning (yellow blink) |
| > 150 ms | Declare master dead; maintain last BPM |
| > 200 ms | Auto-promote to master if PLAYING |

---

## 9. Master Election

### 9.1 Dynamic Dictatorship with Epoch Generation (Amendment #9)

Each instance maintains an `epoch_generation` counter (u32). When a node promotes itself to master, it increments its generation. If a network partition heals and two masters exist, the one with the **higher** `epoch_generation` wins. The other yields within one heartbeat.

```
if (incoming.flags & MASTER) && (incoming.epoch_generation > my.epoch_generation):
    yield_master()
```

### 9.2 Force Override

A `DICTATOR` packet (type `0x08`) carries a maximized `epoch_generation` (`0xFFFFFFFF`). All other masters yield instantly.

### 9.3 Graceful Shutdown (Amendment #10)

When the user closes MIXI, a `DYING` packet (type `0x09`) is sent before process exit. Peers promote immediately at 0 ms latency, without waiting for the 150 ms timeout.

### 9.4 Silent Master Retention (Amendment #11)

If the master stops all decks but other instances are also silent, the master retains its role. This keeps the timing grid alive for effects (delay, reverb tails). Master is only yielded when a slave is actively `PLAYING` with `volume > 0`.

---

## 10. Network Resilience

### 10.1 Jitter Filtering

First-order exponential moving average:

```
filtered_phase = alpha * raw_phase + (1 - alpha) * filtered_phase
```

Default `alpha = 0.15`. Acts as a flywheel between heartbeats.

### 10.2 Sequence Ordering

Each packet carries a monotonic `u16` sequence number. Discard if:

```
diff = incoming_seq.wrapping_sub(last_seq)
discard if: diff == 0 OR diff >= 32768
```

### 10.3 Rate Limiting (Amendment #21)

The UDP listener drops packets exceeding 100 Hz from any single IP. This prevents a Chaos Monkey or attacker from starving the audio thread.

### 10.4 Broadcast Storm Prevention

Only `ANNOUNCE` uses broadcast (1 Hz). All `HEARTBEAT` uses unicast.

---

## 11. Visual Synchronization

### 11.1 Predictive Onset Triggers (Amendment #16)

The `triggers` byte carries **countdown** values, not reactive flags. At 50 Hz, each countdown unit = 20 ms. A kick_countdown of 3 means "kick in 60 ms" — enough for VJ software to pre-render the explosion frame.

### 11.2 EQ State for VJ (Amendment #17)

The `eq_bass` byte carries the low-band EQ state of the master deck (0 = kill, 128 = 0 dB, 255 = +12 dB). VJ software can trigger strobe effects only when the DJ raises the bass, not just on volume.

### 11.3 VJ Integration Example

```python
import socket, struct
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', 4303))
while True:
    data, addr = sock.recvfrom(64)
    if data[:4] != b'MXS\0': continue
    bpm       = struct.unpack_from('<f', data, 16)[0]
    phase_fp  = struct.unpack_from('<I', data, 20)[0]
    phase     = phase_fp / 4294967296.0
    energy    = data[53]
    triggers  = data[54]
    kick_in   = triggers & 0x07        # 0-7 heartbeats until kick
    snare_in  = (triggers >> 3) & 0x07 # 0-7 heartbeats until snare
    eq_bass   = data[55]
```

---

## 12. Web Platform Fallbacks

| Priority | Transport | Scope | Latency | Phase Lock |
|----------|-----------|-------|---------|-----------|
| 1 | Shared Memory + Seqlock | Same OS | ~0 us | Full |
| 2 | UDP Unicast | LAN | <1 ms | Full |
| 3 | BroadcastChannel | Same origin | ~0 us | Full |
| 4 | WebRTC DataChannel | Cross-origin | 1-10 ms | Full |
| 5 | WebSocket | Any | 30-50 ms | BPM-follow only |

### BroadcastChannel (Amendment #19)

Transfer raw `ArrayBuffer` — zero JSON serialization, zero GC pressure:

```typescript
const channel = new BroadcastChannel('mixi-sync');
channel.postMessage(packet.buffer);  // ArrayBuffer, NOT JSON
```

### WebRTC DataChannel (Amendment #18, #19)

```typescript
const dc = peerConnection.createDataChannel('mixi-sync', {
    ordered: false, maxRetransmits: 0,
});
dc.binaryType = 'arraybuffer';  // NOT 'blob' — avoids allocation
```

For peer discovery without Electron, a lightweight signaling server (Redis pub/sub or Python relay) exchanges SDP tokens. Once WebRTC establishes, traffic is peer-to-peer on LAN.

### WebSocket (degraded mode, Amendment #20)

Only for `TRANSPORT` and `CUE_POINT` packets. Never for `HEARTBEAT` — Python + TCP adds 30-50 ms jitter. Degrades to BPM-follow without phase lock.

---

## 13. Security

### 13.1 HMAC-SHA256 Signing

When enabled, packets extend to 96 bytes:

```
[64 bytes: payload][32 bytes: HMAC-SHA256(payload, shared_secret)]
```

No encryption — sync data is not sensitive. HMAC prevents injection.

### 13.2 Anti-Replay Window (Amendment #20)

The receiver maintains a sliding window bitset of the last 64 accepted `sequence` numbers. Packets with already-seen or too-old sequence numbers are discarded even if the HMAC is valid.

### 13.3 Rate Limiting (Amendment #21)

Packets exceeding 100 Hz from any single source IP are dropped at the socket level before parsing.

---

## 14. User Interface Integration

### 14.1 Sync Status Colors

| Color | Animation | State |
|-------|-----------|-------|
| Gray | None | Sync disabled |
| Yellow | Blink 2 Hz | Master lost (FLYWHEEL) |
| Cyan | Solid | Phase locked (error < 0.2%) |
| Green | Pulse | PID correcting (NUDGING) |
| Red | Solid | Force Master (DICTATOR) |

### 14.2 Sync Radar

Circular visualization: this instance at center, peers positioned by RTT. Dot color = state.

### 14.3 Network Offset Slider

`Network Sync Offset: [-50 ms ... +50 ms]` for hardware latency compensation.

---

## 15. Graceful Degradation (Amendment #25)

If network quality deteriorates (jitter > 50 ms sustained for 3+ seconds), the sync engine transitions from **Phase Lock** to **Tempo Match**:

| Mode | Behavior | When |
|------|----------|------|
| **Phase Lock** | PID corrects both BPM and phase | Jitter < 50 ms |
| **Tempo Match** | BPM follows master, phase free-runs | Jitter > 50 ms for 3s |
| **Flywheel** | Last known BPM, no corrections | Master lost > 150 ms |

Tempo Match is preferable to a trembling phase lock on a bad connection. The beat may drift slightly out of phase, but the audio does not warble.

---

## 16. Validation and Testing

### 16.1 Chaos Monkey

| Test | Payload | Expected |
|------|---------|----------|
| Corrupted magic | `"XXX\0"` + 60 random bytes | Silent discard |
| Negative BPM | `bpm = -500.0` | Clamp or discard |
| NaN timestamp | `timestamp = f64::NAN` | Discard |
| Future version | `version = 99` | Graceful v1 degradation |
| Reversed sequence | 1000, 999, 998, ... | All discarded |
| DICTATOR flood | 100x in 100 ms | Rate-limited, only first processed |
| Extreme BPM | `bpm = 999.0` | Clamp to 300 |
| Zero-length packet | 0 bytes | Silent discard |
| Oversized packet | 65535 bytes | Truncate or discard |
| All-zeros | 64x 0x00 | Bad magic, discard |
| Replay attack | Valid HMAC, old sequence | Anti-replay window rejects |

**Pass criteria.** Audio continues without interruption. Sync engine logs warnings. No crash, no panic, no artifacts.

### 16.2 Phase Lock Accuracy

Two instances, shared memory, 128 BPM, 500 ms initial offset. Expected convergence: <8 beats (3.75 s).

### 16.3 Failover Timing

Master killed (SIGKILL). Slave promotes in <200 ms with no tempo discontinuity. With DYING packet: <20 ms.

### 16.4 Clock Drift Endurance

Two instances running 6 hours. Phase error must remain < 5 ms throughout, with continuous NTP compensating hardware drift.

---

## 17. Comparison with Existing Protocols

| Feature | MIDI Clock | Ableton Link | Pro DJ Link | **MIXI Sync** |
|---------|-----------|--------------|-------------|---------------|
| Tempo sync | 24 ppqn | Yes | Yes | **Yes** |
| Beat phase | No | Yes | Yes | **Yes (PID + u32 fixed-point)** |
| Bar position | No | No | Yes | **Yes (derived)** |
| Deck state | No | No | Partial | **Full (8-bit flags)** |
| Crossfader | No | No | No | **Yes** |
| VFX triggers | No | No | No | **Yes (predictive countdown)** |
| EQ state | No | No | No | **Yes (bass band)** |
| Cue points | No | No | No | **Yes** |
| Track ID | No | No | Yes | **Yes (audio fingerprint)** |
| Pitch nudge | No | No | No | **Yes** |
| Discovery | Manual | mDNS | Proprietary | **UDP broadcast** |
| Clock drift | None | PLL | Unknown | **Continuous NTP + Cristian** |
| Phase controller | None | PLL | Unknown | **PID + gain scheduling** |
| Latency (local) | ~1 ms | ~1 ms | ~5 ms | **~0 us (SHM + Seqlock)** |
| Latency (LAN) | N/A | ~1 ms | ~5 ms | **<1 ms (unicast)** |
| Master model | Fixed | Consensus | Fixed | **Dynamic Dictatorship + epoch** |
| Split-brain | N/A | Resolved | N/A | **Epoch generation** |
| Security | None | None | None | **HMAC + anti-replay** |
| Web support | WebMIDI | No | No | **3 fallbacks** |
| Packet size | 1 byte | ~40 bytes | ~100 bytes | **64 bytes (cache-aligned)** |

---

## 18. Implementation Roadmap

| Phase | Deliverable | Key Amendments |
|-------|-------------|----------------|
| **v1.0** | UDP heartbeat + PID phase lock | #1-8 (clocks, PID, gain scheduling) |
| **v1.0** | Discovery + master election | #9-11 (epoch, DYING, silent master) |
| **v1.0** | Continuous NTP + jitter filter | #1-3 (slew, Cristian, audio fusion) |
| **v1.0** | Chaos Monkey + endurance test | #30 v1, #20-21 (anti-replay, rate limit) |
| **v1.1** | SHM + Seqlock local backend | #14-15 (seqlock, cache alignment) |
| **v1.1** | MIDI Clock bridge | Auto-generate 24 ppqn from heartbeat |
| **v1.1** | Predictive VJ triggers | #16-17 (countdown, EQ bass) |
| **v1.1** | HMAC signing + anti-replay | #20, #26 v1 |
| **v2.0** | Cue point sharing | Packet type 0x04 |
| **v2.0** | BroadcastChannel + WebRTC | #18-19 |
| **v2.0** | Graceful degradation | #25 (tempo-match fallback) |
| **v3.0** | MIXI Cloud tunneling | Extended sender_id, STUN/TURN |

---

## 19. References

1. MIDI Manufacturers Association. *MIDI 1.0 Detailed Specification*. 1983.
2. Ableton AG. *Link: A technology for synchronizing musical beat, tempo, and phase across multiple applications*. 2016.
3. EvanPurkhiser. *prolink-connect: Library for communicating with Pioneer DJ equipment*. GitHub.
4. Mills, D. *Network Time Protocol Version 4: Protocol and Algorithms Specification*. RFC 5905, IETF, 2010.
5. Cristian, F. *Probabilistic clock synchronization*. Distributed Computing, 3(3):146-158, 1989.
6. Web Audio API. W3C Recommendation. https://www.w3.org/TR/webaudio/
7. WebRTC 1.0. W3C Recommendation. https://www.w3.org/TR/webrtc/
8. WebMIDI API. W3C Working Draft. https://www.w3.org/TR/webmidi/
9. Lamport, L. *Time, Clocks, and the Ordering of Events in a Distributed System*. CACM, 21(7), 1978.

---

*MIXI Sync Protocol Specification v1.1-draft. Generated from the MIXI project repository.*
