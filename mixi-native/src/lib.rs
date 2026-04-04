/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 *
 * This file is part of MIXI.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi Native — Zero-Copy Audio I/O Bridge
//
// Architecture:
//
//   Browser (Wasm DSP) → SharedArrayBuffer (4ch float32)
//                           ↓
//   N-API addon (this) → cpal audio stream callback
//                           ↓
//   CoreAudio / WASAPI / ALSA → Physical hardware pins
//
// The SharedArrayBuffer is a lock-free SPSC ring buffer:
//   [0..3]  = write_head (u32, atomic)
//   [4..7]  = read_head  (u32, atomic)
//   [8..]   = interleaved f32 samples (4ch: L_master, R_master, L_cue, R_cue)
//
// The browser side writes samples; the cpal callback reads them.
// Zero mutex, zero allocation on the audio thread.
// ─────────────────────────────────────────────────────────────

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::Serialize;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

// ── Device Info ──────────────────────────────────────────────

#[derive(Serialize)]
#[napi(object)]
pub struct AudioDeviceInfo {
    /// Unique device identifier (platform-specific)
    pub id: String,
    /// Human-readable device name
    pub name: String,
    /// Maximum number of output channels
    pub max_channels: u32,
    /// Default sample rate (0 if unknown)
    pub default_sample_rate: u32,
    /// Whether this is the system default device
    pub is_default: bool,
}

/// Enumerate all available audio output devices.
///
/// Returns a JSON-serializable array of device info objects.
/// Called from Electron main process via IPC.
#[napi]
pub fn enumerate_output_devices() -> Result<Vec<AudioDeviceInfo>> {
    let host = cpal::default_host();

    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    let mut devices = Vec::new();

    let output_devices = host
        .output_devices()
        .map_err(|e| Error::from_reason(format!("Failed to enumerate devices: {e}")))?;

    for (idx, device) in output_devices.enumerate() {
        let name = device.name().unwrap_or_else(|_| format!("Device {idx}"));
        let is_default = name == default_name;

        let (max_channels, default_sr) = device
            .default_output_config()
            .map(|c| (c.channels() as u32, c.sample_rate().0))
            .unwrap_or((2, 44100));

        devices.push(AudioDeviceInfo {
            id: format!("{idx}"),
            name,
            max_channels,
            default_sample_rate: default_sr,
            is_default,
        });
    }

    Ok(devices)
}

// ── Stream State ─────────────────────────────────────────────

/// Shared state between the N-API thread and the cpal audio callback thread.
/// Only atomic fields are accessed from the audio thread.
struct StreamState {
    /// Pointer to the SharedArrayBuffer sample data (after 8-byte SPSC header)
    ring_ptr: *const f32,
    /// Capacity of the ring buffer in frames (not samples)
    ring_capacity_frames: u32,
    /// Number of channels in the ring buffer
    ring_channels: u32,
    /// Read head position (in frames), updated by audio thread
    read_head: AtomicU32,
    /// Whether the stream is actively consuming
    active: AtomicBool,
}

// SAFETY: Only atomic fields and the immutable ring_ptr are accessed from
// the audio thread. The pointer is valid for the lifetime of the JS-side
// SharedArrayBuffer.
unsafe impl Send for StreamState {}
unsafe impl Sync for StreamState {}

/// Holds the active cpal stream + shared state.
/// cpal::Stream is !Send on macOS, so we keep it thread-local
/// (all N-API calls come from Node.js main thread).
struct ActiveStream {
    stream: cpal::Stream,
    state: Arc<StreamState>,
}

thread_local! {
    static ACTIVE_STREAM: RefCell<Option<ActiveStream>> = const { RefCell::new(None) };
}

/// Open a native audio output stream on the specified device.
///
/// # Arguments
/// * `device_index` — Index from `enumerate_output_devices()`
/// * `sample_rate` — Desired sample rate (e.g. 44100)
/// * `buffer_size` — Desired buffer size in frames (e.g. 128)
/// * `ring_buffer` — SharedArrayBuffer bytes (SPSC ring, 4ch interleaved f32)
/// * `ring_capacity_frames` — Ring buffer capacity in frames
/// * `ring_channels` — Number of channels (2 for stereo master, 4 for master+cue)
#[napi]
pub fn open_stream(
    device_index: u32,
    sample_rate: u32,
    buffer_size: u32,
    ring_buffer: Buffer,
    ring_capacity_frames: u32,
    ring_channels: u32,
) -> Result<()> {
    // Close any existing stream first
    close_stream()?;

    let host = cpal::default_host();

    let device = host
        .output_devices()
        .map_err(|e| Error::from_reason(format!("Failed to enumerate: {e}")))?
        .nth(device_index as usize)
        .ok_or_else(|| Error::from_reason(format!("Device index {device_index} not found")))?;

    let config = cpal::StreamConfig {
        channels: ring_channels.min(2) as u16, // Output is always stereo (master)
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Fixed(buffer_size),
    };

    // Ring buffer layout:
    // [0..4] bytes = write_head (u32, set by JS/Wasm side)
    // [4..8] bytes = read_head  (u32, set by this native side)
    // [8..]        = f32 samples, interleaved, ring_channels per frame
    let ring_ptr = ring_buffer.as_ptr();
    let samples_ptr = unsafe { ring_ptr.add(8) as *const f32 };

    let state = Arc::new(StreamState {
        ring_ptr: samples_ptr,
        ring_capacity_frames,
        ring_channels,
        read_head: AtomicU32::new(0),
        active: AtomicBool::new(true),
    });

    let cb_state = state.clone();

    let stream = device
        .build_output_stream(
            &config,
            move |data: &mut [f32], _info: &cpal::OutputCallbackInfo| {
                // ── AUDIO THREAD — Zero allocation, zero mutex ──
                if !cb_state.active.load(Ordering::Relaxed) {
                    data.fill(0.0);
                    return;
                }

                let capacity = cb_state.ring_capacity_frames;
                let channels = cb_state.ring_channels;
                let out_channels = 2u32; // Always output stereo (master L/R)

                // Read the write head (set atomically by JS/Wasm side)
                let write_head_ptr =
                    unsafe { (cb_state.ring_ptr as *const u8).sub(8) as *const AtomicU32 };
                let write_head = unsafe { (*write_head_ptr).load(Ordering::Acquire) };

                let read_head = cb_state.read_head.load(Ordering::Relaxed);
                let frames_requested = (data.len() / out_channels as usize) as u32;

                // Available frames in the ring buffer
                let available = if write_head >= read_head {
                    write_head - read_head
                } else {
                    capacity - read_head + write_head
                };

                if available < frames_requested {
                    // Underrun — output silence
                    data.fill(0.0);
                    return;
                }

                // Read frames: ring buffer → output buffer
                for frame in 0..frames_requested {
                    let ring_idx = ((read_head + frame) % capacity) as usize;
                    let ring_offset = ring_idx * channels as usize;
                    let out_offset = frame as usize * out_channels as usize;

                    for ch in 0..out_channels as usize {
                        data[out_offset + ch] =
                            unsafe { *cb_state.ring_ptr.add(ring_offset + ch) };
                    }
                }

                // Update read head (local + SAB)
                let new_read_head = (read_head + frames_requested) % capacity;
                cb_state.read_head.store(new_read_head, Ordering::Release);

                let read_head_sab_ptr = unsafe {
                    (cb_state.ring_ptr as *const u8).sub(4) as *const AtomicU32
                };
                unsafe { (*read_head_sab_ptr).store(new_read_head, Ordering::Release) };
            },
            move |err| {
                eprintln!("[mixi-native] Audio stream error: {err}");
            },
            None,
        )
        .map_err(|e| Error::from_reason(format!("Failed to build stream: {e}")))?;

    stream
        .play()
        .map_err(|e| Error::from_reason(format!("Failed to start stream: {e}")))?;

    // Store in thread-local (cpal::Stream is !Send on macOS)
    ACTIVE_STREAM.with(|cell| {
        *cell.borrow_mut() = Some(ActiveStream { stream, state });
    });

    Ok(())
}

/// Close the active native audio stream.
#[napi]
pub fn close_stream() -> Result<()> {
    ACTIVE_STREAM.with(|cell| {
        if let Some(active) = cell.borrow_mut().take() {
            active.state.active.store(false, Ordering::Release);
            drop(active.stream);
        }
    });
    Ok(())
}

/// Get the name of the audio host backend (e.g., "CoreAudio", "WASAPI", "ALSA").
#[napi]
pub fn get_host_name() -> String {
    let host = cpal::default_host();
    format!("{:?}", host.id())
}

/// Check if native audio is available (cpal can enumerate at least 1 device).
#[napi]
pub fn is_native_audio_available() -> bool {
    let host = cpal::default_host();
    host.output_devices()
        .map(|mut d| d.next().is_some())
        .unwrap_or(false)
}
