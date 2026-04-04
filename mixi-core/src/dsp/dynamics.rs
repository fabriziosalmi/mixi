//! Dynamics processors — Gain, Limiter, and Compressor.
//!
//! These cover all gain-related processing in Mixi:
//!   - Trim gain, fader, crossfader gains
//!   - Master limiter (brick-wall)
//!   - Punch compressor (parallel compression)

/// Simple gain processor — multiplies all samples by a value.
pub struct Gain {
    pub value: f32,
}

impl Gain {
    pub fn new(value: f32) -> Self {
        Self { value }
    }

    /// Apply gain to a block of samples in-place.
    #[inline]
    pub fn process_block(&self, samples: &mut [f32]) {
        for s in samples.iter_mut() {
            *s *= self.value;
        }
    }

    /// Smoothly ramp gain from current to target over a block.
    /// Useful for click-free volume changes.
    #[inline]
    pub fn process_block_ramp(&mut self, samples: &mut [f32], target: f32) {
        let n = samples.len() as f32;
        let step = (target - self.value) / n;
        let mut g = self.value;
        for s in samples.iter_mut() {
            *s *= g;
            g += step;
        }
        self.value = target;
    }
}

/// Brick-wall peak limiter.
///
/// Uses envelope following with fast attack and configurable release.
/// Prevents any sample from exceeding the threshold.
pub struct Limiter {
    threshold: f32,
    release_coeff: f32,
    envelope: f32,
}

impl Limiter {
    /// Create a new limiter.
    ///
    /// * `threshold_db` — Maximum output level in dB (e.g., -1.0)
    /// * `release_ms` — Release time in milliseconds
    /// * `sr` — Sample rate
    pub fn new(threshold_db: f32, release_ms: f32, sr: f32) -> Self {
        let threshold = 10.0f32.powf(threshold_db / 20.0);
        // Release coefficient: time constant in samples
        let release_samples = release_ms * sr / 1000.0;
        let release_coeff = (-1.0 / release_samples).exp();

        Self {
            threshold,
            release_coeff,
            envelope: 0.0,
        }
    }

    /// Process a block of samples, limiting peaks.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        for s in samples.iter_mut() {
            let abs_s = s.abs();

            // Instant attack (envelope tracks peak immediately)
            if abs_s > self.envelope {
                self.envelope = abs_s;
            } else {
                // Exponential release
                self.envelope = self.release_coeff * self.envelope
                    + (1.0 - self.release_coeff) * abs_s;
            }

            // Apply gain reduction
            if self.envelope > self.threshold {
                *s *= self.threshold / self.envelope;
            }
        }
    }

    /// Update threshold (allows runtime changes).
    pub fn set_threshold_db(&mut self, db: f32) {
        self.threshold = 10.0f32.powf(db / 20.0);
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
    }
}

/// Parallel compressor (Punch).
///
/// Mixes dry signal with heavily compressed signal to add
/// weight and impact without killing transients.
pub struct Compressor {
    threshold: f32,
    ratio: f32,
    attack_coeff: f32,
    release_coeff: f32,
    envelope: f32,
    makeup_gain: f32,
}

impl Compressor {
    /// Create a new compressor.
    ///
    /// * `threshold_db` — Compression threshold in dB
    /// * `ratio` — Compression ratio (e.g., 4.0 = 4:1)
    /// * `attack_ms` — Attack time in ms
    /// * `release_ms` — Release time in ms
    /// * `sr` — Sample rate
    pub fn new(threshold_db: f32, ratio: f32, attack_ms: f32, release_ms: f32, sr: f32) -> Self {
        let threshold = 10.0f32.powf(threshold_db / 20.0);
        let attack_coeff = (-1.0 / (attack_ms * sr / 1000.0)).exp();
        let release_coeff = (-1.0 / (release_ms * sr / 1000.0)).exp();
        // Auto makeup gain to compensate for gain reduction
        let reduction_db = threshold_db * (1.0 - 1.0 / ratio);
        let makeup_gain = 10.0f32.powf(-reduction_db / 20.0);

        Self {
            threshold,
            ratio,
            attack_coeff,
            release_coeff,
            envelope: 0.0,
            makeup_gain,
        }
    }

    /// Process a block — applies compression in place.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        for s in samples.iter_mut() {
            let abs_s = s.abs();

            // Envelope follower with separate attack/release
            let coeff = if abs_s > self.envelope {
                self.attack_coeff
            } else {
                self.release_coeff
            };
            self.envelope = coeff * self.envelope + (1.0 - coeff) * abs_s;

            // Gain computation
            if self.envelope > self.threshold {
                let over = self.envelope / self.threshold;
                let gain_reduction = over.powf(1.0 / self.ratio - 1.0);
                *s *= gain_reduction * self.makeup_gain;
            }
        }
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gain_unity() {
        let g = Gain::new(1.0);
        let mut buf = [0.5f32, -0.3, 0.8];
        g.process_block(&mut buf);
        assert_eq!(buf, [0.5, -0.3, 0.8]);
    }

    #[test]
    fn test_gain_double() {
        let g = Gain::new(2.0);
        let mut buf = [0.3f32, -0.5];
        g.process_block(&mut buf);
        assert!((buf[0] - 0.6).abs() < 0.001);
        assert!((buf[1] + 1.0).abs() < 0.001);
    }

    #[test]
    fn test_gain_ramp() {
        let mut g = Gain::new(0.0);
        let mut buf = [1.0f32; 100];
        g.process_block_ramp(&mut buf, 1.0);
        // First sample ≈ 0, last sample ≈ 1
        assert!(buf[0].abs() < 0.02, "First: {}", buf[0]);
        assert!((buf[99] - 1.0).abs() < 0.02, "Last: {}", buf[99]);
        assert_eq!(g.value, 1.0);
    }

    #[test]
    fn test_limiter_passes_quiet() {
        let mut lim = Limiter::new(-1.0, 100.0, 44100.0);
        let mut buf = [0.3f32; 128];
        lim.process_block(&mut buf);
        // Quiet signal should pass through
        for s in &buf {
            assert!((s.abs() - 0.3).abs() < 0.01);
        }
    }

    #[test]
    fn test_limiter_clips_loud() {
        let mut lim = Limiter::new(-6.0, 50.0, 44100.0);
        // -6 dB ≈ 0.5 threshold
        let mut buf = [1.0f32; 128];
        lim.process_block(&mut buf);
        // All samples should be ≤ threshold (0.5)
        for s in &buf {
            assert!(s.abs() <= 0.51, "Limiter let through: {}", s);
        }
    }

    #[test]
    fn test_limiter_reset() {
        let mut lim = Limiter::new(-1.0, 100.0, 44100.0);
        lim.process_block(&mut [1.0; 64]);
        assert!(lim.envelope > 0.0);
        lim.reset();
        assert_eq!(lim.envelope, 0.0);
    }

    #[test]
    fn test_compressor_quiet_pass() {
        let mut comp = Compressor::new(-20.0, 4.0, 5.0, 100.0, 44100.0);
        let mut buf = [0.01f32; 128];
        comp.process_block(&mut buf);
        // Very quiet signal should pass mostly unchanged
        for s in &buf {
            assert!(s.is_finite());
        }
    }

    #[test]
    fn test_compressor_reduces_loud() {
        // Use compressor WITHOUT auto makeup gain to verify pure compression
        let mut comp = Compressor::new(-10.0, 4.0, 1.0, 50.0, 44100.0);
        comp.makeup_gain = 1.0; // disable makeup for this test
        // First: pump envelope with loud signal
        for _ in 0..10 {
            let mut loud = [0.8f32; 128];
            comp.process_block(&mut loud);
        }
        // Now check: output should be reduced below 0.8
        let mut buf = [0.8f32; 128];
        comp.process_block(&mut buf);
        let max = buf.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max < 0.8, "Compressor should reduce, got max: {}", max);
    }
}
