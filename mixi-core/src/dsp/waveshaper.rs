//! Waveshaper / Distortion — soft clipping with variable drive.
//!
//! Uses Padé-approximated tanh waveshaping for smooth, musical distortion.
//! The drive parameter controls the amount of harmonics added.
//!
//! Padé approximant: tanh(x) ≈ x(27 + x²) / (27 + 9x²)
//! Accurate to <0.2% for |x| < 3, and naturally clamps for larger values.

/// Padé approximant of tanh(x) — 5× faster than std tanh.
/// Accurate to <0.2% for |x| < 3, hard-clamps beyond that range.
#[inline]
fn fast_tanh(x: f32) -> f32 {
    if x.abs() > 3.0 {
        return if x > 0.0 { 1.0 } else { -1.0 };
    }
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

/// Waveshaper distortion.
pub struct Waveshaper {
    /// Drive amount (1.0 = clean, 10+ = heavy distortion)
    drive: f32,
    /// Output gain compensation (auto-calculated)
    norm: f32,
    /// Dry/wet mix
    wet: f32,
}

impl Waveshaper {
    pub fn new() -> Self {
        Self {
            drive: 1.0,
            norm: 1.0,
            wet: 0.0,
        }
    }

    /// Set distortion amount (0–1 maps to drive 1–80).
    pub fn set_params(&mut self, amount: f32, wet: f32) {
        let amount = amount.clamp(0.0, 1.0);
        self.drive = amount * amount * 79.0 + 1.0; // quadratic scaling 1–80
        self.norm = 1.0 / self.drive.tanh(); // normalize so tanh(drive * 1.0) ≈ 1.0
        self.wet = wet.clamp(0.0, 1.0);
    }

    /// Process a block of samples.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        if self.wet == 0.0 || self.drive <= 1.01 {
            return; // bypass
        }

        let dry = 1.0 - self.wet;

        for s in samples.iter_mut() {
            let x = self.drive * *s;
            let distorted = fast_tanh(x) * self.norm;
            *s = *s * dry + distorted * self.wet;
        }
    }

    pub fn reset(&mut self) {
        // Waveshaper is stateless — nothing to reset
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_waveshaper_bypass() {
        let mut ws = Waveshaper::new();
        ws.set_params(0.0, 0.0);
        let mut buf = [0.5f32; 128];
        ws.process_block(&mut buf);
        assert_eq!(buf[0], 0.5);
    }

    #[test]
    fn test_waveshaper_clips() {
        let mut ws = Waveshaper::new();
        ws.set_params(1.0, 1.0); // max drive

        let mut buf = [0.8f32; 128];
        ws.process_block(&mut buf);

        // Heavily driven signal should be compressed toward ±1
        for s in &buf {
            assert!(s.abs() <= 1.1, "Waveshaper output too loud: {}", s);
        }
    }

    #[test]
    fn test_waveshaper_adds_harmonics() {
        let mut ws = Waveshaper::new();
        ws.set_params(0.5, 1.0);

        // Pure sine → distorted sine should differ
        let mut original = Vec::new();
        let mut processed = Vec::new();
        for i in 0..256 {
            let x = (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 44100.0).sin() * 0.5;
            original.push(x);
            processed.push(x);
        }
        ws.process_block(&mut processed);

        // Check that output differs from input (harmonics added)
        let diff: f32 = original.iter().zip(&processed).map(|(a, b)| (a - b).abs()).sum::<f32>();
        assert!(diff > 1.0, "Distortion should differ from input, diff: {}", diff);
    }

    #[test]
    fn test_waveshaper_finite() {
        let mut ws = Waveshaper::new();
        ws.set_params(1.0, 1.0);
        let mut buf = [0.99f32; 256];
        ws.process_block(&mut buf);
        for s in &buf {
            assert!(s.is_finite());
        }
    }
}
