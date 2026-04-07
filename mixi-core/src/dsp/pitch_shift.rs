//! Granular overlap-add pitch shifter for Key Lock.
//!
//! When Key Lock is ON and playbackRate ≠ 1.0, this module compensates
//! the pitch change so the musical key stays fixed while tempo changes.
//!
//! Algorithm:
//!   pitchRatio = 1 / playbackRate
//!   grainSize = 2048 samples (~46 ms @ 44.1 kHz)
//!   Two overlapping grains (50% overlap), Hann-windowed, resampled by pitchRatio
//!   Output = overlap-add of resampled grains
//!
//! Ported from JavaScript `pitch-shift-processor.ts` with identical behavior.

use std::f32::consts::PI;

const GRAIN_SIZE: usize = 2048;
const HALF_GRAIN: usize = GRAIN_SIZE / 2;
const BUF_SIZE: usize = GRAIN_SIZE * 4; // 8192 samples circular buffer

/// Granular overlap-add pitch shifter.
pub struct GrainPitchShift {
    /// Circular input buffer
    input_buf: Vec<f32>,
    /// Write position in circular buffer (monotonic, wraps via modulo)
    write_pos: usize,
    /// Grain A read position (0..GRAIN_SIZE)
    grain_a_pos: usize,
    /// Grain B read position (offset by HALF_GRAIN)
    grain_b_pos: usize,
    /// Precomputed Hann window
    window: Vec<f32>,
    /// Pitch shift ratio (1/playbackRate when key lock active)
    pitch_ratio: f32,
    /// Whether pitch shifting is enabled
    enabled: bool,
}

impl GrainPitchShift {
    /// Create a new pitch shifter with precomputed Hann window.
    pub fn new() -> Self {
        // Precompute Hann window
        let mut window = vec![0.0f32; GRAIN_SIZE];
        for i in 0..GRAIN_SIZE {
            window[i] = 0.5 * (1.0 - (2.0 * PI * i as f32 / (GRAIN_SIZE - 1) as f32).cos());
        }

        Self {
            input_buf: vec![0.0f32; BUF_SIZE],
            write_pos: 0,
            grain_a_pos: 0,
            grain_b_pos: HALF_GRAIN,
            window,
            pitch_ratio: 1.0,
            enabled: false,
        }
    }

    /// Set the pitch shift ratio. 1.0 = no shift. 1/playbackRate for key lock.
    #[inline]
    pub fn set_pitch_ratio(&mut self, ratio: f32) {
        self.pitch_ratio = ratio;
    }

    /// Enable or disable pitch shifting. When disabled, audio passes through.
    #[inline]
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.pitch_ratio = 1.0;
        }
    }

    /// Process a block of audio samples.
    ///
    /// `input` and `output` must have the same length (typically 128 frames).
    /// When disabled or ratio ≈ 1.0, copies input to output (passthrough).
    pub fn process_block(&mut self, input: &[f32], output: &mut [f32]) {
        let len = input.len().min(output.len());

        // Passthrough when disabled or ratio ≈ 1.0
        if !self.enabled || (self.pitch_ratio - 1.0).abs() < 0.001 {
            output[..len].copy_from_slice(&input[..len]);
            return;
        }

        let buf_len = BUF_SIZE;
        let ratio = self.pitch_ratio;

        // Write input to circular buffer
        for i in 0..len {
            self.input_buf[self.write_pos % buf_len] = input[i];
            self.write_pos = self.write_pos.wrapping_add(1);
        }

        // Generate output by overlap-adding two resampled grains
        for i in 0..len {
            // ── Grain A ──────────────────────────────────────
            let a_idx = self.grain_a_pos;
            let a_frac = a_idx as f32 * ratio;
            let a_int = a_frac as usize;
            let a_t = a_frac - a_int as f32;
            // Read position: write_pos - GRAIN_SIZE + a_int
            let a_base = (self.write_pos + buf_len - GRAIN_SIZE + a_int) % buf_len;
            let s0 = self.input_buf[a_base];
            let s1 = self.input_buf[(a_base + 1) % buf_len];
            let a_sample = s0 + (s1 - s0) * a_t; // linear interpolation
            let a_win = self.window[a_idx];

            // ── Grain B (offset by HALF_GRAIN) ───────────────
            let b_idx = self.grain_b_pos;
            let b_frac = b_idx as f32 * ratio;
            let b_int = b_frac as usize;
            let b_t = b_frac - b_int as f32;
            let b_base = (self.write_pos + buf_len - GRAIN_SIZE + b_int + buf_len - HALF_GRAIN) % buf_len;
            let t0 = self.input_buf[b_base];
            let t1 = self.input_buf[(b_base + 1) % buf_len];
            let b_sample = t0 + (t1 - t0) * b_t;
            let b_win = self.window[b_idx];

            // Overlap-add
            output[i] = a_sample * a_win + b_sample * b_win;

            // Advance grain positions
            self.grain_a_pos += 1;
            self.grain_b_pos += 1;

            if self.grain_a_pos >= GRAIN_SIZE {
                self.grain_a_pos = 0;
            }
            if self.grain_b_pos >= GRAIN_SIZE {
                self.grain_b_pos = 0;
            }
        }
    }

    /// Reset all state (clear buffers, reset positions).
    pub fn reset(&mut self) {
        for s in self.input_buf.iter_mut() {
            *s = 0.0;
        }
        self.write_pos = 0;
        self.grain_a_pos = 0;
        self.grain_b_pos = HALF_GRAIN;
        self.pitch_ratio = 1.0;
        self.enabled = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_when_disabled() {
        let mut ps = GrainPitchShift::new();
        let input: Vec<f32> = (0..128).map(|i| (i as f32) / 128.0).collect();
        let mut output = vec![0.0f32; 128];
        ps.process_block(&input, &mut output);
        // Should be passthrough (disabled by default)
        assert_eq!(input, output);
    }

    #[test]
    fn passthrough_when_ratio_is_one() {
        let mut ps = GrainPitchShift::new();
        ps.set_enabled(true);
        ps.set_pitch_ratio(1.0);
        let input: Vec<f32> = (0..128).map(|i| (i as f32) / 128.0).collect();
        let mut output = vec![0.0f32; 128];
        ps.process_block(&input, &mut output);
        assert_eq!(input, output);
    }

    #[test]
    fn output_differs_when_shifting() {
        let mut ps = GrainPitchShift::new();
        ps.set_enabled(true);
        ps.set_pitch_ratio(0.9); // pitch up

        // Feed a few blocks to fill the circular buffer
        let sine: Vec<f32> = (0..128).map(|i| (2.0 * PI * 440.0 * i as f32 / 44100.0).sin()).collect();
        let mut output = vec![0.0f32; 128];

        for _ in 0..20 {
            ps.process_block(&sine, &mut output);
        }

        // Output should differ from input (pitch shifted)
        let differs = output.iter().zip(sine.iter()).any(|(a, b)| (a - b).abs() > 0.01);
        assert!(differs, "Output should differ from input when pitch shifting");
    }

    #[test]
    fn reset_clears_state() {
        let mut ps = GrainPitchShift::new();
        ps.set_enabled(true);
        ps.set_pitch_ratio(0.8);
        let input = vec![1.0f32; 128];
        let mut output = vec![0.0f32; 128];
        ps.process_block(&input, &mut output);

        ps.reset();
        assert!(!ps.enabled);
        assert_eq!(ps.pitch_ratio, 1.0);
        assert_eq!(ps.grain_a_pos, 0);
        assert_eq!(ps.grain_b_pos, HALF_GRAIN);
    }
}
