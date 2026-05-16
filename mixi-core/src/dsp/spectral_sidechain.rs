//! SpectralSidechainCompressor — kick-triggered sidechain duck on the sub-bass band.
//!
//! When a kick transient is detected in the sidechain (source) signal via a
//! low-pass energy follower, a fast-attack / medium-release gain reduction
//! envelope is applied to the slave signal. Maximum duck depth is 12 dB
//! (gain factor 0.25) when `depth` = 1.0 and the envelope is fully open.

/// Kick-triggered sidechain compressor targeting sub-bass frequencies.
pub struct SpectralSidechainCompressor {
    /// One-pole attack coefficient (per-sample).
    attack_coeff: f32,
    /// One-pole release coefficient (per-sample).
    release_coeff: f32,
    /// Current gain-reduction envelope, 0.0 = no duck, 1.0 = full duck.
    envelope: f32,
    /// Low-pass filtered energy of the sidechain signal (kick detector).
    lp_energy: f32,
    /// LP coefficient for energy smoothing (~20 Hz cutoff).
    lp_coeff: f32,
    /// RMS threshold (linear amplitude) above which a kick is detected.
    threshold: f32,
    /// Duck depth 0.0..=1.0 → maps 0 dB to –12 dB gain reduction.
    depth: f32,
    /// Wet/dry mix: 0.0 = bypass, 1.0 = full sidechain processing.
    mix: f32,
}

impl SpectralSidechainCompressor {
    /// Create a new compressor.
    ///
    /// * `sample_rate` — audio sample rate in Hz (e.g. 44100.0)
    /// * `depth`       — duck amount 0.0..=1.0
    /// * `mix`         — wet/dry 0.0..=1.0
    ///
    /// Defaults: attack = 3 ms, release = 80 ms, threshold = 0.35.
    pub fn new(sample_rate: f32, depth: f32, mix: f32) -> Self {
        let attack_ms = 3.0_f32;
        let release_ms = 80.0_f32;

        // One-pole coefficient from time constant: coeff = 1 - exp(-1 / (ms * sr / 1000))
        let attack_coeff = Self::time_to_coeff(attack_ms, sample_rate);
        let release_coeff = 1.0 - Self::time_to_coeff(release_ms, sample_rate);

        // LP cutoff ~20 Hz for energy smoothing
        let lp_coeff = 1.0 - (2.0 * std::f32::consts::PI * 20.0 / sample_rate).min(1.0);

        Self {
            attack_coeff,
            release_coeff,
            envelope: 0.0,
            lp_energy: 0.0,
            lp_coeff,
            threshold: 0.35,
            depth: depth.clamp(0.0, 1.0),
            mix: mix.clamp(0.0, 1.0),
        }
    }

    /// Convert a time constant in milliseconds to a per-sample one-pole coefficient.
    #[inline]
    fn time_to_coeff(ms: f32, sr: f32) -> f32 {
        let samples = ms * sr / 1000.0;
        if samples <= 0.0 {
            1.0
        } else {
            1.0 - (-1.0_f32 / samples).exp()
        }
    }

    /// Process one block of audio.
    ///
    /// `sidechain` — the source signal used for kick detection (deck A or B).
    /// `slave`     — the signal to apply gain reduction to (in-place).
    ///
    /// Both slices should have the same length; if they differ, the shorter
    /// length is used.
    pub fn process_block(&mut self, sidechain: &[f32], slave: &mut [f32]) {
        let len = sidechain.len().min(slave.len());
        for i in 0..len {
            // 1. Instantaneous energy of sidechain sample
            let energy = sidechain[i] * sidechain[i];

            // 2. Low-pass filter energy (~20 Hz, smoothed RMS proxy)
            self.lp_energy = self.lp_energy * self.lp_coeff + energy * (1.0 - self.lp_coeff);

            // 3. Kick detection & envelope follow
            if self.lp_energy > self.threshold * self.threshold {
                // Attack: envelope rises toward 1.0
                self.envelope += (1.0 - self.envelope) * self.attack_coeff;
            } else {
                // Release: envelope decays toward 0.0
                self.envelope *= self.release_coeff;
            }

            // 4. Gain reduction: at envelope=1 and depth=1, gain = 0.25 (≈ –12 dB)
            //    gain = 1.0 - envelope * depth * 0.75
            let gain = 1.0 - self.envelope * self.depth * 0.75;

            // 5. Wet/dry mix
            slave[i] *= 1.0 - self.mix + gain * self.mix;
        }
    }

    /// Set the duck depth. Clamped to 0.0..=1.0.
    pub fn set_depth(&mut self, depth: f32) {
        self.depth = depth.clamp(0.0, 1.0);
    }

    /// Set the wet/dry mix. Clamped to 0.0..=1.0.
    pub fn set_mix(&mut self, mix: f32) {
        self.mix = mix.clamp(0.0, 1.0);
    }

    /// Reset all stateful accumulators (envelope and energy follower).
    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.lp_energy = 0.0;
    }
}

// ── Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    /// Zero sidechain → envelope never rises → slave passes through unchanged.
    #[test]
    fn test_silence_pass_through() {
        let mut sc = SpectralSidechainCompressor::new(SR, 1.0, 1.0);

        let sidechain = vec![0.0f32; 512];
        let original: Vec<f32> = (0..512).map(|i| (i as f32 / 512.0) * 0.5).collect();
        let mut slave = original.clone();

        sc.process_block(&sidechain, &mut slave);

        // With a zero sidechain and threshold=0.35, envelope stays at 0.
        // gain = 1.0 - 0 * depth * 0.75 = 1.0, so slave[i] *= 1.0 (unchanged).
        for (a, b) in original.iter().zip(slave.iter()) {
            assert!(
                (a - b).abs() < 1e-6,
                "Expected slave unchanged, got diff {} at sample",
                (a - b).abs()
            );
        }
    }

    /// Strong kick pulse in sidechain → slave output is attenuated vs dry input.
    #[test]
    fn test_kick_causes_duck() {
        let mut sc = SpectralSidechainCompressor::new(SR, 1.0, 1.0);

        // Drive sidechain with a strong full-scale pulse for 256 samples
        let sidechain = vec![1.0f32; 256];
        let mut slave = vec![1.0f32; 256];
        let original_slave = slave.clone();

        sc.process_block(&sidechain, &mut slave);

        // After a strong kick, at least some samples in slave must be attenuated.
        let sum_original: f32 = original_slave.iter().sum();
        let sum_processed: f32 = slave.iter().sum();

        assert!(
            sum_processed < sum_original,
            "Expected slave to be ducked (sum {:.4} < {:.4})",
            sum_processed,
            sum_original
        );

        // Verify maximum attenuation stays at or above –12 dB (gain >= 0.25)
        for s in &slave {
            assert!(
                *s >= 0.24, // slight tolerance for floating point
                "Gain should not exceed 12 dB reduction, got sample {}",
                s
            );
        }
    }
}
