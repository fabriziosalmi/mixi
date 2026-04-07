//! # mixi-core
//!
//! Rust/Wasm DSP core for Mixi DAW.
//!
//! ## Architecture
//!
//! This crate is compiled to WebAssembly and loaded in the browser.
//! It provides high-performance DSP analysis and processing that
//! would be too expensive to run in JavaScript on the main thread.
//!
//! ## Phases
//!
//! - **Phase 1** (current): Proof-of-concept — validate Wasm pipeline
//! - **Phase 2**: Offline analysis (BPM, Key, Waveform) in Rust
//! - **Phase 3**: Real-time DSP engine via AudioWorklet

use wasm_bindgen::prelude::*;

// ── Phase 2: DSP Analysis modules ──────────────────────────
pub mod waveform;
pub mod bpm;
pub mod key;
pub mod automix;
pub mod drop_detect;
pub mod metadata;
pub mod ring_buffer;

// ── Phase 3: Real-time DSP primitives ──────────────────────
pub mod dsp;

// ─────────────────────────────────────────────────────────────
// Phase 1: Proof-of-concept exports
// Validates that Rust → Wasm → JS pipeline works end-to-end.
// ─────────────────────────────────────────────────────────────

/// Returns the crate version string.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Trivial add function — used to validate the Wasm bridge works.
/// If `mixi_core.add(2, 3)` returns `5` in the browser console,
/// the entire Rust → wasm-pack → Vite → browser pipeline is proven.
#[wasm_bindgen]
pub fn add(a: f32, b: f32) -> f32 {
    a + b
}

/// Convert a linear gain value (0.0–1.0) to decibels.
/// This is a real utility that will be used by the DSP layer.
#[wasm_bindgen]
pub fn gain_to_db(gain: f32) -> f32 {
    if gain <= 0.0001 {
        -96.0
    } else {
        20.0 * gain.log10()
    }
}

/// Convert decibels to linear gain.
#[wasm_bindgen]
pub fn db_to_gain(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Compute RMS (Root Mean Square) level of a float audio buffer.
/// This is the first real DSP function — validates that we can
/// pass large Float32Arrays from JS to Rust without copy overhead.
#[wasm_bindgen]
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt()
}

/// Equal-power crossfader gain calculation.
/// Returns (gain_a, gain_b) for a crossfader position 0.0–1.0.
#[wasm_bindgen]
pub fn crossfader_gains(position: f32) -> Vec<f32> {
    let pos = position.clamp(0.0, 1.0);
    let half_pi = std::f32::consts::FRAC_PI_2;
    let gain_a = (pos * half_pi).cos();
    let gain_b = (pos * half_pi).sin();
    vec![gain_a, gain_b]
}

// ─────────────────────────────────────────────────────────────
// Phase 4: Granular Pitch Shifter (standalone AudioWorklet)
// ─────────────────────────────────────────────────────────────

/// Granular overlap-add pitch shifter for Key Lock.
/// Designed to run inside a standalone AudioWorklet (separate from DspEngine).
/// JS sends pitch_ratio and enabled state via message port.
#[wasm_bindgen]
pub struct PitchShifter {
    inner: dsp::pitch_shift::GrainPitchShift,
}

#[wasm_bindgen]
impl PitchShifter {
    /// Create a new pitch shifter (Hann window precomputed).
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: dsp::pitch_shift::GrainPitchShift::new(),
        }
    }

    /// Set pitch shift ratio. 1.0 = no shift. 1/playbackRate for key lock.
    pub fn set_pitch_ratio(&mut self, ratio: f32) {
        self.inner.set_pitch_ratio(ratio);
    }

    /// Enable or disable pitch shifting.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.inner.set_enabled(enabled);
    }

    /// Process a block of mono audio samples (typically 128 frames).
    /// Input and output must be the same length.
    pub fn process(&mut self, input: &[f32], output: &mut [f32]) {
        self.inner.process_block(input, output);
    }

    /// Reset all internal state.
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

// ─────────────────────────────────────────────────────────────
// Raw C-style exports for AudioWorklet (no wasm-bindgen glue)
//
// AudioWorklets can't use wasm-bindgen JS glue. These functions
// are called directly via instance.exports from the worklet.
// ─────────────────────────────────────────────────────────────

static mut PITCH_SHIFTER_L: Option<dsp::pitch_shift::GrainPitchShift> = None;
static mut PITCH_SHIFTER_R: Option<dsp::pitch_shift::GrainPitchShift> = None;

/// Initialize pitch shifters (call once after Wasm instantiation).
#[no_mangle]
pub extern "C" fn pitch_shifter_init() {
    unsafe {
        PITCH_SHIFTER_L = Some(dsp::pitch_shift::GrainPitchShift::new());
        PITCH_SHIFTER_R = Some(dsp::pitch_shift::GrainPitchShift::new());
    }
}

/// Set pitch ratio on both L/R shifters.
#[no_mangle]
pub extern "C" fn pitch_shifter_set_ratio(ratio: f32) {
    unsafe {
        if let Some(ref mut s) = PITCH_SHIFTER_L { s.set_pitch_ratio(ratio); }
        if let Some(ref mut s) = PITCH_SHIFTER_R { s.set_pitch_ratio(ratio); }
    }
}

/// Enable/disable both L/R shifters (0 = disabled, 1 = enabled).
#[no_mangle]
pub extern "C" fn pitch_shifter_set_enabled(enabled: i32) {
    unsafe {
        let e = enabled != 0;
        if let Some(ref mut s) = PITCH_SHIFTER_L { s.set_enabled(e); }
        if let Some(ref mut s) = PITCH_SHIFTER_R { s.set_enabled(e); }
    }
}

/// Allocate a buffer in Wasm linear memory. Returns pointer.
#[no_mangle]
pub extern "C" fn pitch_shifter_alloc(frames: usize) -> *mut f32 {
    let mut buf = vec![0.0f32; frames];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf); // leak intentionally — worklet manages lifetime
    ptr
}

/// Process mono audio. Reads `frames` f32s from `in_ptr`, writes to `out_ptr`.
#[no_mangle]
pub extern "C" fn pitch_shifter_process_l(in_ptr: *mut f32, out_ptr: *mut f32, frames: usize) {
    unsafe {
        let input = std::slice::from_raw_parts(in_ptr, frames);
        let output = std::slice::from_raw_parts_mut(out_ptr, frames);
        if let Some(ref mut s) = PITCH_SHIFTER_L {
            s.process_block(input, output);
        }
    }
}

/// Process right channel.
#[no_mangle]
pub extern "C" fn pitch_shifter_process_r(in_ptr: *mut f32, out_ptr: *mut f32, frames: usize) {
    unsafe {
        let input = std::slice::from_raw_parts(in_ptr, frames);
        let output = std::slice::from_raw_parts_mut(out_ptr, frames);
        if let Some(ref mut s) = PITCH_SHIFTER_R {
            s.process_block(input, output);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Tests (run with `cargo test` or `wasm-pack test`)
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add() {
        assert_eq!(add(2.0, 3.0), 5.0);
    }

    #[test]
    fn test_version() {
        assert_eq!(version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn test_gain_to_db() {
        assert!((gain_to_db(1.0) - 0.0).abs() < 0.001);
        assert!((gain_to_db(0.5) - (-6.0206)).abs() < 0.01);
        assert_eq!(gain_to_db(0.0), -96.0);
    }

    #[test]
    fn test_db_to_gain() {
        assert!((db_to_gain(0.0) - 1.0).abs() < 0.001);
        assert!((db_to_gain(-6.0) - 0.5012).abs() < 0.01);
    }

    #[test]
    fn test_rms() {
        // Silence
        assert_eq!(rms(&[0.0, 0.0, 0.0, 0.0]), 0.0);
        // DC offset
        assert!((rms(&[1.0, 1.0, 1.0, 1.0]) - 1.0).abs() < 0.001);
        // Known value
        let samples = vec![0.5, -0.5, 0.5, -0.5];
        assert!((rms(&samples) - 0.5).abs() < 0.001);
        // Empty
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn test_crossfader_gains() {
        let left = crossfader_gains(0.0);
        assert!((left[0] - 1.0).abs() < 0.001); // A = full
        assert!(left[1].abs() < 0.001);           // B = silent

        let center = crossfader_gains(0.5);
        assert!((center[0] - 0.7071).abs() < 0.01); // Equal power
        assert!((center[1] - 0.7071).abs() < 0.01);

        let right = crossfader_gains(1.0);
        assert!(right[0].abs() < 0.001);           // A = silent
        assert!((right[1] - 1.0).abs() < 0.001);   // B = full
    }
}
