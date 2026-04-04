//! Delay effect — tempo-synced feedback delay line.
//!
//! Features:
//!   - Variable delay time (in samples)
//!   - Feedback (0–1)
//!   - Dry/wet mix
//!   - Linear interpolation for smooth time changes

/// A simple delay line with feedback.
pub struct Delay {
    buffer: Vec<f32>,
    write_pos: usize,
    delay_samples: f32,
    feedback: f32,
    wet: f32,
}

impl Delay {
    /// Create a new delay with given maximum delay in samples.
    pub fn new(max_delay_samples: usize) -> Self {
        Self {
            buffer: vec![0.0; max_delay_samples.max(1)],
            write_pos: 0,
            delay_samples: 0.0,
            feedback: 0.0,
            wet: 0.0,
        }
    }

    /// Set delay parameters.
    /// * `delay_samples` — Delay length in samples (can be fractional).
    /// * `feedback` — Feedback amount 0–1.
    /// * `wet` — Dry/wet mix 0–1 (0 = dry only, 1 = wet only).
    pub fn set_params(&mut self, delay_samples: f32, feedback: f32, wet: f32) {
        self.delay_samples = delay_samples.clamp(0.0, (self.buffer.len() - 1) as f32);
        self.feedback = feedback.clamp(0.0, 0.99); // prevent runaway
        self.wet = wet.clamp(0.0, 1.0);
    }

    /// Process a block of samples.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        let buf_len = self.buffer.len();
        if buf_len == 0 || self.delay_samples < 1.0 {
            return; // bypass
        }

        let dry = 1.0 - self.wet;

        for s in samples.iter_mut() {
            // Read from delay line with linear interpolation
            let read_pos = (self.write_pos as f32 - self.delay_samples + buf_len as f32) % buf_len as f32;
            let idx0 = read_pos.floor() as usize % buf_len;
            let idx1 = (idx0 + 1) % buf_len;
            let frac = read_pos.fract();
            let delayed = self.buffer[idx0] * (1.0 - frac) + self.buffer[idx1] * frac;

            // Write input + feedback into delay line
            self.buffer[self.write_pos] = *s + delayed * self.feedback;

            // Output: dry + wet mix
            *s = *s * dry + delayed * self.wet;

            self.write_pos = (self.write_pos + 1) % buf_len;
        }
    }

    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bypass_short_delay() {
        let mut d = Delay::new(4096);
        d.set_params(0.0, 0.0, 0.5); // 0 samples = bypass
        let mut buf = [1.0f32; 64];
        d.process_block(&mut buf);
        assert_eq!(buf[0], 1.0); // unchanged
    }

    #[test]
    fn test_delay_echo() {
        let mut d = Delay::new(4096);
        d.set_params(100.0, 0.0, 1.0); // 100 samples delay, no feedback, full wet

        // Feed an impulse
        let mut buf = vec![0.0f32; 200];
        buf[0] = 1.0;
        d.process_block(&mut buf);

        // The impulse should appear at sample 100 (wet output)
        assert!(buf[0].abs() < 0.01, "Input should be dry-zeroed: {}", buf[0]);
        assert!((buf[100] - 1.0).abs() < 0.01, "Echo at 100: {}", buf[100]);
    }

    #[test]
    fn test_delay_feedback() {
        let mut d = Delay::new(4096);
        d.set_params(50.0, 0.5, 1.0); // 50 samples, 50% feedback

        let mut buf = vec![0.0f32; 200];
        buf[0] = 1.0;
        d.process_block(&mut buf);

        // First echo at 50
        assert!((buf[50] - 1.0).abs() < 0.01, "1st echo: {}", buf[50]);
        // Second echo at 100 (attenuated by feedback)
        assert!((buf[100] - 0.5).abs() < 0.1, "2nd echo: {}", buf[100]);
    }

    #[test]
    fn test_delay_reset() {
        let mut d = Delay::new(4096);
        d.set_params(100.0, 0.5, 1.0);
        d.process_block(&mut [1.0; 64]);
        d.reset();
        assert!(d.buffer.iter().all(|&s| s == 0.0));
    }
}
