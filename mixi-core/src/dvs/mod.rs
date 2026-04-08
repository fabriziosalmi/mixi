//! DVS (Digital Vinyl System) — Timecode decoder for turntable control.
//!
//! Decodes timecode signals from vinyl records into speed and position data.
//! Supports multiple timecode formats:
//!   - Traktor Scratch MK1 (2000 Hz)
//!   - Traktor Scratch MK2 (2500 Hz)
//!   - Serato Scratch Live (1000 Hz)
//!   - MixVibes DVS (1300 Hz)
//!   - MIXI-CUT (3000 Hz, open-source)
//!
//! Architecture:
//!   Audio Input (L+R) → Bandpass Filter → PLL Decoder → Mass-Spring Filter → Output
//!
//! The PLL (Phase-Locked Loop) tracks the phase of the timecode carrier
//! and outputs instantaneous speed and direction. The mass-spring filter
//! smooths out wow/flutter while preserving scratch responsiveness.

pub mod pll;
pub mod mass_spring;
pub mod lissajous;

use wasm_bindgen::prelude::*;
use pll::{PllDecoder, PllOutput};
use mass_spring::{MassSpringDamper, MassSpringOutput};

// ── Timecode Format ────────────────────────────────────────────

/// Supported timecode vinyl formats.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum TimecodeFormat {
    TraktorMK1 = 0,  // 2000 Hz
    TraktorMK2 = 1,  // 2500 Hz
    SeratoCV25 = 2,  // 1000 Hz
    MixVibes   = 3,  // 1300 Hz
    MixiCut    = 4,  // 3000 Hz (open-source)
}

impl TimecodeFormat {
    /// Carrier frequency in Hz.
    pub fn carrier_freq(self) -> f64 {
        match self {
            Self::TraktorMK1 => 2000.0,
            Self::TraktorMK2 => 2500.0,
            Self::SeratoCV25 => 1000.0,
            Self::MixVibes   => 1300.0,
            Self::MixiCut    => 3000.0,
        }
    }

    /// Bandpass filter Q factor.
    /// Tighter Q for our own signal (clean), wider for used vinyl.
    pub fn bandpass_q(self) -> f64 {
        match self {
            Self::MixiCut => 2.5,
            _ => 1.5,
        }
    }

    /// Human-readable name.
    pub fn name(self) -> &'static str {
        match self {
            Self::TraktorMK1 => "Traktor MK1",
            Self::TraktorMK2 => "Traktor MK2",
            Self::SeratoCV25 => "Serato CV2.5",
            Self::MixVibes   => "MixVibes",
            Self::MixiCut    => "MIXI-CUT",
        }
    }
}

// ── Bandpass Filter (f64 precision for PLL) ────────────────────

/// Biquad bandpass filter (f64 precision for PLL accuracy).
/// Isolates the timecode carrier from rumble, noise, and hum.
#[derive(Clone, Debug)]
struct Bandpass64 {
    b0: f64, b1: f64, b2: f64,
    a1: f64, a2: f64,
    z1: f64, z2: f64,
}

impl Bandpass64 {
    fn new(center_freq: f64, sample_rate: f64, q: f64) -> Self {
        // Nyquist guard: clamp center frequency below Nyquist
        let safe_freq = center_freq.min(sample_rate * 0.45);
        let safe_q = q.max(0.1); // Prevent division by zero
        let w0 = std::f64::consts::TAU * safe_freq / sample_rate;
        let alpha = w0.sin() / (2.0 * safe_q);
        let cos_w0 = w0.cos();

        let b0 = alpha;
        let b2 = -alpha;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        Self {
            b0: b0 / a0, b1: 0.0, b2: b2 / a0,
            a1: a1 / a0, a2: a2 / a0,
            z1: 0.0, z2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, input: f64) -> f64 {
        let output = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * output + self.z2;
        self.z2 = self.b2 * input - self.a2 * output;
        output
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

// ── DVS Decoder (Main Public API) ──────────────────────────────

/// Complete DVS decoder pipeline.
/// Processes stereo audio samples and outputs speed + position.
#[wasm_bindgen]
pub struct DvsDecoder {
    format: TimecodeFormat,
    sample_rate: f64,
    /// Bandpass filter for left channel.
    bp_l: Bandpass64,
    /// Bandpass filter for right channel.
    bp_r: Bandpass64,
    /// Phase-Locked Loop.
    pll: PllDecoder,
    /// Mass-spring-damper (turntable physics).
    mass_spring: MassSpringDamper,
    /// Accumulated position (cycles since start).
    position_cycles: f64,
    /// Signal presence detection (RMS).
    signal_rms: f64,
    /// Signal present flag.
    signal_present: bool,
    /// Samples processed counter.
    samples_processed: u64,
}

#[wasm_bindgen]
impl DvsDecoder {
    /// Create a new DVS decoder for the given format and sample rate.
    #[wasm_bindgen(constructor)]
    pub fn new(format: TimecodeFormat, sample_rate: f32) -> Self {
        let sr = sample_rate as f64;
        let freq = format.carrier_freq();
        let q = format.bandpass_q();

        Self {
            format,
            sample_rate: sr,
            bp_l: Bandpass64::new(freq, sr, q),
            bp_r: Bandpass64::new(freq, sr, q),
            pll: PllDecoder::new(freq, sr),
            mass_spring: MassSpringDamper::new(),
            position_cycles: 0.0,
            signal_rms: 0.0,
            signal_present: false,
            samples_processed: 0,
        }
    }

    /// Process a block of stereo audio.
    /// Input: interleaved [L, R, L, R, ...] (f32).
    /// Output: flat array [speed, position_sec, lock, is_scratching, is_spinback, signal_rms]
    ///
    /// The PLL runs per-sample for phase accuracy. The mass-spring filter
    /// runs once per block (it's tuned for block-rate ~344 Hz, not sample-rate).
    pub fn process_block(&mut self, interleaved: &[f32]) -> Vec<f32> {
        let num_samples = interleaved.len() / 2;
        if num_samples == 0 {
            return vec![0.0; 6];
        }

        // Clear Lissajous buffer for fresh data each block.
        self.pll.clear_lissajous();

        // RMS decay coefficient derived from sample rate (~200ms time constant)
        let rms_alpha = 1.0 / (self.sample_rate * 0.2);

        let mut sum_speed = 0.0f64;
        let mut sum_lock = 0.0f64;
        let mut sum_rms = 0.0f64;

        for i in 0..num_samples {
            let l = interleaved[i * 2] as f64;
            let r = interleaved[i * 2 + 1] as f64;

            // 1. Bandpass filter (remove rumble + noise)
            let filtered_l = self.bp_l.process(l);
            let filtered_r = self.bp_r.process(r);

            // 2. Signal presence (RMS with sample-rate-aware decay)
            let energy = filtered_l * filtered_l + filtered_r * filtered_r;
            self.signal_rms = self.signal_rms * (1.0 - rms_alpha) + energy * rms_alpha;
            sum_rms += energy;

            // 3. PLL decode (per-sample for phase accuracy)
            let pll_out = self.pll.process_sample(filtered_l, filtered_r);

            // 4. Accumulate position
            self.position_cycles += pll_out.position_delta as f64;

            sum_speed += pll_out.speed as f64;
            sum_lock += pll_out.lock_strength as f64;
            self.samples_processed += 1;
        }

        // Average PLL output over the block
        let n = num_samples as f64;
        let avg_pll_speed = sum_speed / n;
        let avg_lock = (sum_lock / n).clamp(0.0, 1.0);

        // 5. Mass-spring filter ONCE per block (tuned for block-rate ~344 Hz)
        let ms_output = self.mass_spring.process(avg_pll_speed);

        // Signal present if RMS > threshold (~-40 dBFS)
        let block_rms = (sum_rms / n).sqrt();
        self.signal_present = block_rms > 0.01;

        // Convert position from cycles to seconds
        let position_sec = self.position_cycles / self.format.carrier_freq();

        vec![
            ms_output.speed as f32,     // [0] speed (1.0 = 33rpm forward)
            position_sec as f32,         // [1] position in seconds
            avg_lock as f32,             // [2] lock strength (0.0-1.0)
            if ms_output.is_scratching { 1.0 } else { 0.0 }, // [3]
            if ms_output.is_spinback { 1.0 } else { 0.0 },   // [4]
            block_rms as f32,            // [5] signal RMS
        ]
    }

    /// Get current speed (filtered).
    pub fn speed(&self) -> f32 {
        self.mass_spring.current_speed() as f32
    }

    /// Get current position in seconds.
    pub fn position_seconds(&self) -> f32 {
        (self.position_cycles / self.format.carrier_freq()) as f32
    }

    /// Get PLL lock strength (0.0 = unlocked, 1.0 = perfect lock).
    pub fn lock_strength(&self) -> f32 {
        self.pll.lock_strength() as f32
    }

    /// Is the PLL locked to a valid signal?
    pub fn is_locked(&self) -> bool {
        self.pll.lock_strength() > 0.7 && self.signal_present
    }

    /// Is signal present (above noise floor)?
    pub fn signal_present(&self) -> bool {
        self.signal_present
    }

    /// Get Lissajous data for the last processed block.
    /// Returns [x, y, x, y, ...] decimated to ~100 points.
    pub fn lissajous_points(&self) -> Vec<f32> {
        self.pll.lissajous_buffer().to_vec()
    }

    /// Reset decoder state (e.g. when changing vinyl or format).
    pub fn reset(&mut self) {
        self.bp_l.reset();
        self.bp_r.reset();
        self.pll.reset();
        self.mass_spring.reset();
        self.position_cycles = 0.0;
        self.signal_rms = 0.0;
        self.signal_present = false;
    }

    /// Change timecode format (reconfigures filters and PLL).
    pub fn set_format(&mut self, format: TimecodeFormat) {
        self.format = format;
        let freq = format.carrier_freq();
        let q = format.bandpass_q();
        self.bp_l = Bandpass64::new(freq, self.sample_rate, q);
        self.bp_r = Bandpass64::new(freq, self.sample_rate, q);
        self.pll = PllDecoder::new(freq, self.sample_rate);
        self.mass_spring.reset();
        self.position_cycles = 0.0;
    }
}

// ── Raw C-style exports for AudioWorklet ───────────────────────

static mut DVS_DECODER_A: Option<DvsDecoder> = None;
static mut DVS_DECODER_B: Option<DvsDecoder> = None;

/// Initialize DVS decoder for deck A.
#[no_mangle]
pub extern "C" fn dvs_init_a(format: u8, sample_rate: f32) {
    let fmt = match format {
        0 => TimecodeFormat::TraktorMK1,
        1 => TimecodeFormat::TraktorMK2,
        2 => TimecodeFormat::SeratoCV25,
        3 => TimecodeFormat::MixVibes,
        4 => TimecodeFormat::MixiCut,
        _ => TimecodeFormat::TraktorMK2,
    };
    unsafe { DVS_DECODER_A = Some(DvsDecoder::new(fmt, sample_rate)); }
}

/// Initialize DVS decoder for deck B.
#[no_mangle]
pub extern "C" fn dvs_init_b(format: u8, sample_rate: f32) {
    let fmt = match format {
        0 => TimecodeFormat::TraktorMK1,
        1 => TimecodeFormat::TraktorMK2,
        2 => TimecodeFormat::SeratoCV25,
        3 => TimecodeFormat::MixVibes,
        4 => TimecodeFormat::MixiCut,
        _ => TimecodeFormat::TraktorMK2,
    };
    unsafe { DVS_DECODER_B = Some(DvsDecoder::new(fmt, sample_rate)); }
}

/// Process a block for deck A. Returns speed.
#[no_mangle]
pub extern "C" fn dvs_process_a(in_ptr: *const f32, frames: usize) -> f32 {
    unsafe {
        if in_ptr.is_null() || frames == 0 { return 0.0; }
        if let Some(ref mut dec) = DVS_DECODER_A {
            let input = std::slice::from_raw_parts(in_ptr, frames * 2);
            let result = dec.process_block(input);
            result[0] // speed
        } else {
            0.0
        }
    }
}

/// Process a block for deck B. Returns speed.
#[no_mangle]
pub extern "C" fn dvs_process_b(in_ptr: *const f32, frames: usize) -> f32 {
    unsafe {
        if in_ptr.is_null() || frames == 0 { return 0.0; }
        if let Some(ref mut dec) = DVS_DECODER_B {
            let input = std::slice::from_raw_parts(in_ptr, frames * 2);
            let result = dec.process_block(input);
            result[0]
        } else {
            0.0
        }
    }
}

/// Get full state for deck A: [speed, position, lock, scratching, spinback, rms]
#[no_mangle]
pub extern "C" fn dvs_state_a(out_ptr: *mut f32) {
    unsafe {
        if out_ptr.is_null() { return; }
        if let Some(ref dec) = DVS_DECODER_A {
            let out = std::slice::from_raw_parts_mut(out_ptr, 6);
            out[0] = dec.speed();
            out[1] = dec.position_seconds();
            out[2] = dec.lock_strength();
            out[3] = if dec.mass_spring.is_scratching() { 1.0 } else { 0.0 };
            out[4] = if dec.mass_spring.is_spinback() { 1.0 } else { 0.0 };
            out[5] = if dec.signal_present() { 1.0 } else { 0.0 };
        }
    }
}

/// Get full state for deck B.
#[no_mangle]
pub extern "C" fn dvs_state_b(out_ptr: *mut f32) {
    unsafe {
        if out_ptr.is_null() { return; }
        if let Some(ref dec) = DVS_DECODER_B {
            let out = std::slice::from_raw_parts_mut(out_ptr, 6);
            out[0] = dec.speed();
            out[1] = dec.position_seconds();
            out[2] = dec.lock_strength();
            out[3] = if dec.mass_spring.is_scratching() { 1.0 } else { 0.0 };
            out[4] = if dec.mass_spring.is_spinback() { 1.0 } else { 0.0 };
            out[5] = if dec.signal_present() { 1.0 } else { 0.0 };
        }
    }
}

/// Reset decoder A.
#[no_mangle]
pub extern "C" fn dvs_reset_a() {
    unsafe {
        if let Some(ref mut dec) = DVS_DECODER_A { dec.reset(); }
    }
}

/// Reset decoder B.
#[no_mangle]
pub extern "C" fn dvs_reset_b() {
    unsafe {
        if let Some(ref mut dec) = DVS_DECODER_B { dec.reset(); }
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_frequencies() {
        assert!((TimecodeFormat::TraktorMK1.carrier_freq() - 2000.0).abs() < 0.1);
        assert!((TimecodeFormat::TraktorMK2.carrier_freq() - 2500.0).abs() < 0.1);
        assert!((TimecodeFormat::SeratoCV25.carrier_freq() - 1000.0).abs() < 0.1);
        assert!((TimecodeFormat::MixVibes.carrier_freq() - 1300.0).abs() < 0.1);
        assert!((TimecodeFormat::MixiCut.carrier_freq() - 3000.0).abs() < 0.1);
    }

    #[test]
    fn test_decoder_creation() {
        let dec = DvsDecoder::new(TimecodeFormat::TraktorMK2, 44100.0);
        assert!(!dec.is_locked());
        assert!(!dec.signal_present());
        assert!(dec.speed().abs() < 0.01);
    }

    #[test]
    fn test_silence_input() {
        let mut dec = DvsDecoder::new(TimecodeFormat::MixiCut, 44100.0);
        let silence = vec![0.0f32; 256]; // 128 stereo samples
        let result = dec.process_block(&silence);
        assert_eq!(result.len(), 6);
        // On silence, PLL coasts at center freq but mass-spring absorbs it.
        // Lock should be low.
        assert!(result[2] < 0.5, "Lock should be low on silence, got {}", result[2]);
    }

    #[test]
    fn test_synthetic_timecode_forward() {
        // Generate a clean 3000 Hz quadrature signal (MIXI-CUT at 33rpm)
        let sr = 44100.0;
        let freq = 3000.0;
        let duration_samples = 4410; // 100ms
        let mut interleaved = Vec::with_capacity(duration_samples * 2);

        for i in 0..duration_samples {
            let t = i as f64 / sr;
            let phase = std::f64::consts::TAU * freq * t;
            interleaved.push(phase.sin() as f32 * 0.8);  // L = sin
            interleaved.push(phase.cos() as f32 * 0.8);  // R = cos
        }

        let mut dec = DvsDecoder::new(TimecodeFormat::MixiCut, sr as f32);

        // Process in 128-sample blocks to simulate AudioWorklet
        let block_size = 128;
        let mut last_speed = 0.0f32;
        let mut last_lock = 0.0f32;

        for chunk_start in (0..interleaved.len()).step_by(block_size * 2) {
            let chunk_end = (chunk_start + block_size * 2).min(interleaved.len());
            let result = dec.process_block(&interleaved[chunk_start..chunk_end]);
            last_speed = result[0];
            last_lock = result[2];
        }

        // After 100ms of clean signal, PLL should be locking
        assert!(last_lock > 0.1, "Lock should be improving, got {}", last_lock);
        // Speed should be approaching 1.0 (forward at normal speed)
        assert!(last_speed > 0.5, "Speed should approach 1.0, got {}", last_speed);
    }

    #[test]
    fn test_synthetic_timecode_reverse() {
        let sr = 44100.0;
        let freq = 3000.0;
        let duration_samples = 8820; // 200ms for better lock
        let mut interleaved = Vec::with_capacity(duration_samples * 2);

        for i in 0..duration_samples {
            let t = i as f64 / sr;
            // Reverse: swap sin/cos phase direction
            let phase = -std::f64::consts::TAU * freq * t;
            interleaved.push(phase.sin() as f32 * 0.8);
            interleaved.push(phase.cos() as f32 * 0.8);
        }

        let mut dec = DvsDecoder::new(TimecodeFormat::MixiCut, sr as f32);
        let block_size = 128;
        let mut last_speed = 0.0f32;

        for chunk_start in (0..interleaved.len()).step_by(block_size * 2) {
            let chunk_end = (chunk_start + block_size * 2).min(interleaved.len());
            let result = dec.process_block(&interleaved[chunk_start..chunk_end]);
            last_speed = result[0];
        }

        // Speed should be negative (reverse)
        assert!(last_speed < -0.3, "Reverse speed expected, got {}", last_speed);
    }

    #[test]
    fn test_half_speed() {
        let sr = 44100.0;
        let freq = 3000.0 * 0.5; // Half-speed = half frequency
        let duration_samples = 8820;
        let mut interleaved = Vec::with_capacity(duration_samples * 2);

        for i in 0..duration_samples {
            let t = i as f64 / sr;
            let phase = std::f64::consts::TAU * freq * t;
            interleaved.push(phase.sin() as f32 * 0.8);
            interleaved.push(phase.cos() as f32 * 0.8);
        }

        let mut dec = DvsDecoder::new(TimecodeFormat::MixiCut, sr as f32);
        let block_size = 128;
        let mut last_speed = 0.0f32;

        for chunk_start in (0..interleaved.len()).step_by(block_size * 2) {
            let chunk_end = (chunk_start + block_size * 2).min(interleaved.len());
            let result = dec.process_block(&interleaved[chunk_start..chunk_end]);
            last_speed = result[0];
        }

        // Speed should be ~0.5
        assert!((last_speed - 0.5).abs() < 0.2, "Half speed expected ~0.5, got {}", last_speed);
    }

    #[test]
    fn test_reset() {
        let mut dec = DvsDecoder::new(TimecodeFormat::TraktorMK2, 44100.0);
        // Process some data
        let signal: Vec<f32> = (0..512).map(|i| (i as f32 * 0.1).sin() * 0.5).collect();
        dec.process_block(&signal);
        // Reset
        dec.reset();
        assert!(dec.speed().abs() < 0.01);
        assert!(dec.position_seconds().abs() < 0.01);
    }

    #[test]
    fn test_format_change() {
        let mut dec = DvsDecoder::new(TimecodeFormat::TraktorMK2, 44100.0);
        dec.set_format(TimecodeFormat::MixiCut);
        assert!(dec.speed().abs() < 0.01);
    }
}
