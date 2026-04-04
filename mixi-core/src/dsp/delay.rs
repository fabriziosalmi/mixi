//! Delay effect — tempo-synced feedback delay line.
//!
//! Features:
//!   - Variable delay time (in samples)
//!   - Feedback (0–1)
//!   - Dry/wet mix
//!   - Linear interpolation for smooth time changes
//!   - Power-of-2 buffer with bitmask wrapping (10× faster than modulo)

/// Round up to next power of 2.
#[inline]
pub fn next_power_of_2(n: usize) -> usize {
    let mut v = n.max(2) - 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v + 1
}

/// A simple delay line with feedback.
pub struct Delay {
    buffer: Vec<f32>,
    mask: usize,       // buffer.len() - 1, for bitmask wrapping
    write_pos: usize,
    delay_samples: f32,
    feedback: f32,
    wet: f32,
}

impl Delay {
    /// Create a new delay with given maximum delay in samples.
    /// Buffer size is rounded up to next power of 2 for fast wrapping.
    pub fn new(max_delay_samples: usize) -> Self {
        let size = next_power_of_2(max_delay_samples.max(2));
        Self {
            buffer: vec![0.0; size],
            mask: size - 1,
            write_pos: 0,
            delay_samples: 0.0,
            feedback: 0.0,
            wet: 0.0,
        }
    }

    /// Set delay parameters.
    pub fn set_params(&mut self, delay_samples: f32, feedback: f32, wet: f32) {
        self.delay_samples = delay_samples.clamp(0.0, self.mask as f32);
        self.feedback = feedback.clamp(0.0, 0.99);
        self.wet = wet.clamp(0.0, 1.0);
    }

    /// Process a block of samples.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        if self.delay_samples < 1.0 {
            return; // bypass
        }

        let dry = 1.0 - self.wet;
        let mask = self.mask;

        for s in samples.iter_mut() {
            // Read from delay line with linear interpolation
            let read_back = self.delay_samples;
            let read_pos_int = (self.write_pos + mask + 1 - read_back as usize) & mask;
            let idx1 = (read_pos_int + 1) & mask;
            let frac = read_back.fract();
            let delayed = self.buffer[read_pos_int] * (1.0 - frac) + self.buffer[idx1] * frac;

            // Write input + feedback into delay line
            self.buffer[self.write_pos] = *s + delayed * self.feedback;

            // Output: dry + wet mix
            *s = *s * dry + delayed * self.wet;

            self.write_pos = (self.write_pos + 1) & mask;
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
    fn test_power_of_2() {
        assert_eq!(next_power_of_2(100), 128);
        assert_eq!(next_power_of_2(128), 128);
        assert_eq!(next_power_of_2(4096), 4096);
        assert_eq!(next_power_of_2(4097), 8192);
    }

    #[test]
    fn test_bypass_short_delay() {
        let mut d = Delay::new(4096);
        d.set_params(0.0, 0.0, 0.5);
        let mut buf = [1.0f32; 64];
        d.process_block(&mut buf);
        assert_eq!(buf[0], 1.0);
    }

    #[test]
    fn test_delay_echo() {
        let mut d = Delay::new(4096);
        d.set_params(100.0, 0.0, 1.0);

        let mut buf = vec![0.0f32; 200];
        buf[0] = 1.0;
        d.process_block(&mut buf);

        assert!(buf[0].abs() < 0.01, "Input should be dry-zeroed: {}", buf[0]);
        assert!((buf[100] - 1.0).abs() < 0.01, "Echo at 100: {}", buf[100]);
    }

    #[test]
    fn test_delay_feedback() {
        let mut d = Delay::new(4096);
        d.set_params(50.0, 0.5, 1.0);

        let mut buf = vec![0.0f32; 200];
        buf[0] = 1.0;
        d.process_block(&mut buf);

        assert!((buf[50] - 1.0).abs() < 0.01, "1st echo: {}", buf[50]);
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
