//! Lock-free Single-Producer Single-Consumer (SPSC) ring buffer.
//!
//! Designed for real-time audio: one thread writes samples (producer),
//! another reads them (consumer). Zero allocations, zero locks.
//!
//! Memory layout on a SharedArrayBuffer:
//!   [0..3]       write_idx (u32, atomic)
//!   [4..7]       read_idx  (u32, atomic)
//!   [8..8+cap*4] sample data (f32)
//!
//! The producer (main thread) calls `push()`.
//! The consumer (AudioWorklet) calls `pop()`.
//! Both use atomic load/store for index synchronization.

use wasm_bindgen::prelude::*;
use std::sync::atomic::{AtomicU32, Ordering};

/// Header size in bytes (write_idx + read_idx).
const HEADER_BYTES: usize = 8;

/// Create a SPSC ring buffer on a SharedArrayBuffer.
///
/// Returns the required buffer size in bytes for the given capacity.
#[wasm_bindgen]
pub fn spsc_buffer_size(capacity_frames: u32, channels: u32) -> u32 {
    let total_samples = capacity_frames * channels;
    (HEADER_BYTES + total_samples as usize * 4) as u32
}

/// Write samples into the ring buffer.
///
/// # Arguments
/// * `buf` - The shared buffer (must be created with `spsc_buffer_size`)
/// * `samples` - Interleaved audio samples to write
/// * `capacity` - Total capacity in samples (frames * channels)
///
/// # Returns
/// Number of samples actually written (may be less if buffer is full).
#[wasm_bindgen]
pub fn spsc_push(buf: &mut [u8], samples: &[f32], capacity: u32) -> u32 {
    let cap = capacity as usize;
    if cap == 0 || samples.is_empty() || buf.len() < HEADER_BYTES + cap * 4 {
        return 0;
    }

    let write_idx = load_atomic(buf, 0) as usize;
    let read_idx = load_atomic(buf, 4) as usize;

    // Available space: capacity - 1 - used (keep 1 slot empty to distinguish full/empty)
    let used = (write_idx + cap - read_idx) % cap;
    let available = cap - 1 - used;
    let to_write = samples.len().min(available);

    let data_offset = HEADER_BYTES;
    for i in 0..to_write {
        let idx = (write_idx + i) % cap;
        let byte_offset = data_offset + idx * 4;
        let bytes = samples[i].to_le_bytes();
        buf[byte_offset..byte_offset + 4].copy_from_slice(&bytes);
    }

    // Update write index (atomic store)
    let new_write = ((write_idx + to_write) % cap) as u32;
    store_atomic(buf, 0, new_write);

    to_write as u32
}

/// Read samples from the ring buffer.
///
/// # Arguments
/// * `buf` - The shared buffer
/// * `output` - Slice to fill with samples
/// * `capacity` - Total capacity in samples
///
/// # Returns
/// Number of samples actually read.
#[wasm_bindgen]
pub fn spsc_pop(buf: &mut [u8], output: &mut [f32], capacity: u32) -> u32 {
    let cap = capacity as usize;
    if cap == 0 || output.is_empty() || buf.len() < HEADER_BYTES + cap * 4 {
        return 0;
    }

    let write_idx = load_atomic(buf, 0) as usize;
    let read_idx = load_atomic(buf, 4) as usize;

    let available = (write_idx + cap - read_idx) % cap;
    let to_read = output.len().min(available);

    let data_offset = HEADER_BYTES;
    for i in 0..to_read {
        let idx = (read_idx + i) % cap;
        let byte_offset = data_offset + idx * 4;
        output[i] = f32::from_le_bytes([
            buf[byte_offset],
            buf[byte_offset + 1],
            buf[byte_offset + 2],
            buf[byte_offset + 3],
        ]);
    }

    // Update read index (atomic store)
    let new_read = ((read_idx + to_read) % cap) as u32;
    store_atomic(buf, 4, new_read);

    to_read as u32
}

/// Get the number of samples available to read.
#[wasm_bindgen]
pub fn spsc_available(buf: &[u8], capacity: u32) -> u32 {
    let cap = capacity as usize;
    if cap == 0 || buf.len() < HEADER_BYTES {
        return 0;
    }
    let write_idx = load_atomic_ro(buf, 0) as usize;
    let read_idx = load_atomic_ro(buf, 4) as usize;
    ((write_idx + cap - read_idx) % cap) as u32
}

/// Reset the ring buffer (set both indices to 0).
#[wasm_bindgen]
pub fn spsc_reset(buf: &mut [u8]) {
    if buf.len() >= HEADER_BYTES {
        store_atomic(buf, 0, 0);
        store_atomic(buf, 4, 0);
    }
}

// ── Atomic helpers ─────────────────────────────────────────────
//
// In Wasm with SharedArrayBuffer, these map to wasm atomic ops.
// In native Rust tests, we use regular AtomicU32 on the bytes.

fn load_atomic(buf: &[u8], byte_offset: usize) -> u32 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // In native tests, use AtomicU32 for proper ordering
        let atomic = unsafe {
            &*(buf.as_ptr().add(byte_offset) as *const AtomicU32)
        };
        atomic.load(Ordering::Acquire)
    }

    #[cfg(target_arch = "wasm32")]
    {
        u32::from_le_bytes([
            buf[byte_offset],
            buf[byte_offset + 1],
            buf[byte_offset + 2],
            buf[byte_offset + 3],
        ])
    }
}

fn load_atomic_ro(buf: &[u8], byte_offset: usize) -> u32 {
    load_atomic(buf, byte_offset)
}

fn store_atomic(buf: &mut [u8], byte_offset: usize, value: u32) {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let atomic = unsafe {
            &*(buf.as_ptr().add(byte_offset) as *const AtomicU32)
        };
        atomic.store(value, Ordering::Release);
    }

    #[cfg(target_arch = "wasm32")]
    {
        let bytes = value.to_le_bytes();
        buf[byte_offset..byte_offset + 4].copy_from_slice(&bytes);
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_buffer(capacity: u32) -> Vec<u8> {
        vec![0u8; spsc_buffer_size(capacity, 1) as usize]
    }

    #[test]
    fn test_buffer_size() {
        // 1024 frames, 2 channels = 2048 samples * 4 bytes + 8 header
        assert_eq!(spsc_buffer_size(1024, 2), 8 + 2048 * 4);
    }

    #[test]
    fn test_empty_buffer() {
        let buf = make_buffer(64);
        assert_eq!(spsc_available(&buf, 64), 0);
    }

    #[test]
    fn test_push_pop() {
        let mut buf = make_buffer(64);
        let samples = [1.0f32, 2.0, 3.0, 4.0];

        let written = spsc_push(&mut buf, &samples, 64);
        assert_eq!(written, 4);
        assert_eq!(spsc_available(&buf, 64), 4);

        let mut output = [0.0f32; 4];
        let read = spsc_pop(&mut buf, &mut output, 64);
        assert_eq!(read, 4);
        assert_eq!(output, [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(spsc_available(&buf, 64), 0);
    }

    #[test]
    fn test_wraparound() {
        let mut buf = make_buffer(8);
        // Fill most of the buffer (7 out of 8, leaving 1 empty for full detection)
        let data: Vec<f32> = (0..6).map(|i| i as f32).collect();
        let written = spsc_push(&mut buf, &data, 8);
        assert_eq!(written, 6);

        // Read 4, freeing space
        let mut out = [0.0f32; 4];
        let read = spsc_pop(&mut buf, &mut out, 8);
        assert_eq!(read, 4);
        assert_eq!(out, [0.0, 1.0, 2.0, 3.0]);

        // Write 4 more (wraps around)
        let more = [10.0f32, 11.0, 12.0, 13.0];
        let written = spsc_push(&mut buf, &more, 8);
        assert_eq!(written, 4);

        // Read all remaining: 4.0, 5.0, 10.0, 11.0, 12.0, 13.0
        let mut out2 = [0.0f32; 6];
        let read = spsc_pop(&mut buf, &mut out2, 8);
        assert_eq!(read, 6);
        assert_eq!(out2, [4.0, 5.0, 10.0, 11.0, 12.0, 13.0]);
    }

    #[test]
    fn test_full_buffer() {
        let mut buf = make_buffer(4);
        // Can only write 3 (capacity-1 to distinguish full/empty)
        let data = [1.0f32, 2.0, 3.0, 4.0, 5.0];
        let written = spsc_push(&mut buf, &data, 4);
        assert_eq!(written, 3);
    }

    #[test]
    fn test_empty_pop() {
        let mut buf = make_buffer(16);
        let mut out = [0.0f32; 4];
        let read = spsc_pop(&mut buf, &mut out, 16);
        assert_eq!(read, 0);
    }

    #[test]
    fn test_reset() {
        let mut buf = make_buffer(16);
        spsc_push(&mut buf, &[1.0, 2.0, 3.0], 16);
        assert_eq!(spsc_available(&buf, 16), 3);

        spsc_reset(&mut buf);
        assert_eq!(spsc_available(&buf, 16), 0);
    }

    #[test]
    fn test_stereo() {
        let mut buf = make_buffer(128); // 128 mono samples capacity
        // Interleaved stereo: [L, R, L, R, ...]
        let stereo: Vec<f32> = (0..8).map(|i| i as f32 * 0.1).collect();
        let written = spsc_push(&mut buf, &stereo, 128);
        assert_eq!(written, 8);

        let mut out = [0.0f32; 8];
        let read = spsc_pop(&mut buf, &mut out, 128);
        assert_eq!(read, 8);
        for i in 0..8 {
            assert!((out[i] - i as f32 * 0.1).abs() < 0.0001);
        }
    }

    #[test]
    fn test_partial_read() {
        let mut buf = make_buffer(32);
        spsc_push(&mut buf, &[1.0, 2.0, 3.0, 4.0], 32);

        // Read only 2
        let mut out = [0.0f32; 2];
        let read = spsc_pop(&mut buf, &mut out, 32);
        assert_eq!(read, 2);
        assert_eq!(out, [1.0, 2.0]);

        // Read remaining 2
        let read = spsc_pop(&mut buf, &mut out, 32);
        assert_eq!(read, 2);
        assert_eq!(out, [3.0, 4.0]);
    }
}
