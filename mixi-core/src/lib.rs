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

// ── Phase 4: PLL analysis (onset correlation, phase cancellation, variable beatgrid)
pub mod pll_analysis;

// ── Phase 5: DVS (Digital Vinyl System) — timecode decoder
pub mod dvs;

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
/// Returns (gain_a, gain_b) packed into a single u64.
///
/// ## Why not Vec<f32>?
/// This function is called at 60 FPS when the DJ moves the fader.
/// Returning Vec<f32> forces: heap alloc → bridge copy → JS Float32Array
/// → GC. 60× per second, that's 60 GC-pressured allocations.
///
/// Instead we pack two f32 into one u64 (zero-alloc, zero-copy).
/// JS unpacks: `gain_a = Math.fround(result & 0xFFFFFFFF)`
///
/// For even better perf, the JS side should compute this directly:
///   gain_a = Math.cos(pos * Math.PI / 2)
///   gain_b = Math.sin(pos * Math.PI / 2)
/// Two cosines don't justify crossing the Wasm bridge.
#[wasm_bindgen]
pub fn crossfader_gains_packed(position: f32) -> u64 {
    let pos = position.clamp(0.0, 1.0);
    let half_pi = std::f32::consts::FRAC_PI_2;
    let gain_a = (pos * half_pi).cos();
    let gain_b = (pos * half_pi).sin();
    // Pack two f32 into one u64 (no heap alloc)
    let a_bits = gain_a.to_bits() as u64;
    let b_bits = gain_b.to_bits() as u64;
    a_bits | (b_bits << 32)
}

/// Legacy Vec version — kept for backward compatibility with existing JS.
/// Prefer crossfader_gains_packed() for hot paths.
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
//
// ## Architecture: Handle-based Factory Pattern
//
// Instead of static mut globals (which limit to 2 channels),
// we use an opaque-handle factory:
//
//   1. JS calls create_pitch_shifter() → gets a handle (pointer)
//   2. JS calls pitch_shifter_process(handle, ...) with its handle
//   3. JS calls destroy_pitch_shifter(handle) on cleanup
//
// This allows unlimited pitch shifter instances (Omni-Deck).
// Each AudioWorklet owns its handles and cleans up in
// disconnectedCallback().
// ─────────────────────────────────────────────────────────────

/// Create a new pitch shifter instance. Returns an opaque handle.
/// The caller MUST call `destroy_pitch_shifter()` when done.
#[no_mangle]
pub extern "C" fn create_pitch_shifter() -> *mut dsp::pitch_shift::GrainPitchShift {
    let shifter = Box::new(dsp::pitch_shift::GrainPitchShift::new());
    Box::into_raw(shifter)
}

/// Destroy a pitch shifter instance (free memory).
/// Call this in the AudioWorklet's disconnectedCallback().
#[no_mangle]
pub extern "C" fn destroy_pitch_shifter(ptr: *mut dsp::pitch_shift::GrainPitchShift) {
    if !ptr.is_null() {
        unsafe { let _ = Box::from_raw(ptr); }
    }
}

/// Set pitch ratio on a specific instance.
#[no_mangle]
pub extern "C" fn pitch_shifter_set_ratio(ptr: *mut dsp::pitch_shift::GrainPitchShift, ratio: f32) {
    if ptr.is_null() { return; }
    unsafe { (*ptr).set_pitch_ratio(ratio); }
}

/// Enable/disable a specific instance (0 = disabled, 1 = enabled).
#[no_mangle]
pub extern "C" fn pitch_shifter_set_enabled(ptr: *mut dsp::pitch_shift::GrainPitchShift, enabled: i32) {
    if ptr.is_null() { return; }
    unsafe { (*ptr).set_enabled(enabled != 0); }
}

/// Allocate a buffer in Wasm linear memory. Returns pointer.
/// The caller MUST call `wasm_free()` when the buffer is no longer needed.
#[no_mangle]
pub extern "C" fn wasm_alloc(frames: usize) -> *mut f32 {
    let mut buf = vec![0.0f32; frames];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Free a buffer previously allocated with `wasm_alloc()`.
/// This is the symmetric counterpart — prevents memory leaks.
///
/// MUST be called in the AudioWorklet's disconnectedCallback(),
/// or whenever buffers are resized (free old, alloc new).
#[no_mangle]
pub extern "C" fn wasm_free(ptr: *mut f32, frames: usize) {
    if ptr.is_null() { return; }
    unsafe {
        // Reconstruct the Vec and let it Drop, freeing the memory.
        let _ = Vec::from_raw_parts(ptr, frames, frames);
    }
}

/// Process mono audio through a pitch shifter instance.
/// `shifter`: handle from create_pitch_shifter().
/// `in_ptr` / `out_ptr`: buffers from wasm_alloc().
#[no_mangle]
pub extern "C" fn pitch_shifter_process(
    shifter: *mut dsp::pitch_shift::GrainPitchShift,
    in_ptr: *const f32,
    out_ptr: *mut f32,
    frames: usize,
) {
    if shifter.is_null() || in_ptr.is_null() || out_ptr.is_null() || frames == 0 { return; }
    unsafe {
        let input = std::slice::from_raw_parts(in_ptr, frames);
        let output = std::slice::from_raw_parts_mut(out_ptr, frames);
        (*shifter).process_block(input, output);
    }
}

// ── Legacy API (backward compat — wraps the new handle-based API) ──
//
// Existing AudioWorklet JS that calls pitch_shifter_init() /
// pitch_shifter_process_l() / pitch_shifter_process_r() continues
// to work. Internally these use two static handles.

static mut LEGACY_SHIFTER_L: *mut dsp::pitch_shift::GrainPitchShift = std::ptr::null_mut();
static mut LEGACY_SHIFTER_R: *mut dsp::pitch_shift::GrainPitchShift = std::ptr::null_mut();

/// Legacy: initialize L/R pitch shifters.
#[no_mangle]
pub extern "C" fn pitch_shifter_init() {
    unsafe {
        // Clean up previous instances (prevents leak on re-init)
        if !LEGACY_SHIFTER_L.is_null() { destroy_pitch_shifter(LEGACY_SHIFTER_L); }
        if !LEGACY_SHIFTER_R.is_null() { destroy_pitch_shifter(LEGACY_SHIFTER_R); }
        LEGACY_SHIFTER_L = create_pitch_shifter();
        LEGACY_SHIFTER_R = create_pitch_shifter();
    }
}

/// Legacy: allocate buffer (renamed internally to wasm_alloc).
#[no_mangle]
pub extern "C" fn pitch_shifter_alloc(frames: usize) -> *mut f32 {
    wasm_alloc(frames)
}

/// Legacy: process left channel.
#[no_mangle]
pub extern "C" fn pitch_shifter_process_l(in_ptr: *mut f32, out_ptr: *mut f32, frames: usize) {
    unsafe { pitch_shifter_process(LEGACY_SHIFTER_L, in_ptr, out_ptr, frames); }
}

/// Legacy: process right channel.
#[no_mangle]
pub extern "C" fn pitch_shifter_process_r(in_ptr: *mut f32, out_ptr: *mut f32, frames: usize) {
    unsafe { pitch_shifter_process(LEGACY_SHIFTER_R, in_ptr, out_ptr, frames); }
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
        assert_eq!(rms(&[0.0, 0.0, 0.0, 0.0]), 0.0);
        assert!((rms(&[1.0, 1.0, 1.0, 1.0]) - 1.0).abs() < 0.001);
        let samples = vec![0.5, -0.5, 0.5, -0.5];
        assert!((rms(&samples) - 0.5).abs() < 0.001);
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn test_crossfader_gains() {
        let left = crossfader_gains(0.0);
        assert!((left[0] - 1.0).abs() < 0.001);
        assert!(left[1].abs() < 0.001);

        let center = crossfader_gains(0.5);
        assert!((center[0] - 0.7071).abs() < 0.01);
        assert!((center[1] - 0.7071).abs() < 0.01);

        let right = crossfader_gains(1.0);
        assert!(right[0].abs() < 0.001);
        assert!((right[1] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_crossfader_packed() {
        let packed = crossfader_gains_packed(0.5);
        let a = f32::from_bits((packed & 0xFFFF_FFFF) as u32);
        let b = f32::from_bits((packed >> 32) as u32);
        assert!((a - 0.7071).abs() < 0.01, "gain_a = {a}");
        assert!((b - 0.7071).abs() < 0.01, "gain_b = {b}");
    }

    #[test]
    fn test_crossfader_packed_extremes() {
        // Full left
        let packed = crossfader_gains_packed(0.0);
        let a = f32::from_bits((packed & 0xFFFF_FFFF) as u32);
        let b = f32::from_bits((packed >> 32) as u32);
        assert!((a - 1.0).abs() < 0.001);
        assert!(b.abs() < 0.001);

        // Full right
        let packed = crossfader_gains_packed(1.0);
        let a = f32::from_bits((packed & 0xFFFF_FFFF) as u32);
        let b = f32::from_bits((packed >> 32) as u32);
        assert!(a.abs() < 0.001);
        assert!((b - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_handle_lifecycle() {
        // Create → use → destroy (no leak)
        let handle = create_pitch_shifter();
        assert!(!handle.is_null());

        pitch_shifter_set_ratio(handle, 1.5);
        pitch_shifter_set_enabled(handle, 1);

        // Allocate buffers
        let inp = wasm_alloc(128);
        let out = wasm_alloc(128);
        assert!(!inp.is_null());
        assert!(!out.is_null());

        // Process
        pitch_shifter_process(handle, inp, out, 128);

        // Free everything
        wasm_free(inp, 128);
        wasm_free(out, 128);
        destroy_pitch_shifter(handle);
    }

    #[test]
    fn test_null_safety() {
        // All functions must handle null without crashing
        destroy_pitch_shifter(std::ptr::null_mut());
        pitch_shifter_set_ratio(std::ptr::null_mut(), 1.0);
        pitch_shifter_set_enabled(std::ptr::null_mut(), 1);
        pitch_shifter_process(std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), 128);
        wasm_free(std::ptr::null_mut(), 0);
    }

    #[test]
    fn test_legacy_init_no_leak() {
        // Calling init twice should not leak (old instances freed)
        pitch_shifter_init();
        pitch_shifter_init(); // re-init: old L/R freed, new created
        // No assertion — just verifying no crash/leak
    }
}
