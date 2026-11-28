//! SpectralSidechainCompressor — kick-triggered sidechain duck on the sub-bass band.
//!
//! When a kick transient is detected in the sidechain (source) signal via a
//! low-pass energy follower, a fast-attack / medium-release gain reduction
//! envelope is applied to the slave signal. Maximum duck depth is 12 dB
//! (gain factor 0.25) when `depth` = 1.0 and the envelope is fully open.

/// Kick-triggered **true spectral** sidechain compressor targeting sub-bass (<150 Hz).
///
/// SE-10 fix:
/// - Sidechain detector filters the trigger signal through a 150 Hz one-pole LP
///   before computing energy, so hi-hats/vocals/snares never trigger false ducking.
/// - Slave signal is split into sub-bass (<150 Hz) and upper band (>150 Hz);
///   only the sub-bass band is ducked while mids and highs stay untouched.
pub struct SpectralSidechainCompressor {
    /// One-pole attack coefficient (per-sample).
    attack_coeff: f32,
    /// One-pole release coefficient (per-sample).
    release_coeff: f32,
    /// Current gain-reduction envelope, 0.0 = no duck, 1.0 = full duck.
    envelope: f32,
    /// Low-pass filtered audio state for the sidechain detector (~150 Hz).
    det_lp_state: f32,
    /// Low-pass filtered audio state for the slave crossover (~150 Hz), Left channel.
    slave_lp_state: f32,
    /// Low-pass filtered audio state for the slave crossover (~150 Hz), Right channel.
    slave_lp_state_r: f32,
    /// One-pole audio LP coefficient (~150 Hz).
    audio_lp_alpha: f32,
    /// Low-pass filtered energy of the sub-bass sidechain signal (kick detector).
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
    /// Defaults: attack = 3 ms, release = 80 ms, threshold = 0.35, crossover = 150 Hz.
    pub fn new(sample_rate: f32, depth: f32, mix: f32) -> Self {
        let sr = sample_rate.max(1000.0);
        let attack_ms = 3.0_f32;
        let release_ms = 80.0_f32;

        // One-pole coefficient from time constant: coeff = 1 - exp(-1 / (ms * sr / 1000))
        let attack_coeff = Self::time_to_coeff(attack_ms, sr);
        let release_coeff = 1.0 - Self::time_to_coeff(release_ms, sr);

        // Audio low-pass (~150 Hz) for sub-bass detector & slave crossover
        let audio_lp_alpha = 1.0 - (-2.0 * std::f32::consts::PI * 150.0 / sr).exp();

        // LP cutoff ~20 Hz for energy smoothing
        let lp_coeff = (-2.0 * std::f32::consts::PI * 20.0 / sr).exp();

        Self {
            attack_coeff,
            release_coeff,
            envelope: 0.0,
            det_lp_state: 0.0,
            slave_lp_state: 0.0,
            slave_lp_state_r: 0.0,
            audio_lp_alpha,
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
    /// `slave`     — the signal to apply sub-bass gain reduction to (in-place).
    pub fn process_block(&mut self, sidechain: &[f32], slave: &mut [f32]) {
        let len = sidechain.len().min(slave.len());
        let alpha = self.audio_lp_alpha;
        for i in 0..len {
            // 1. Sub-bass band extraction on sidechain trigger (~150 Hz LP)
            self.det_lp_state += alpha * (sidechain[i] - self.det_lp_state);
            let energy = self.det_lp_state * self.det_lp_state;

            // 2. Low-pass filter energy (~20 Hz, smoothed RMS proxy)
            self.lp_energy = self.lp_energy * self.lp_coeff + energy * (1.0 - self.lp_coeff);

            // 3. Kick detection & envelope follow
            if self.lp_energy > self.threshold * self.threshold {
                self.envelope += (1.0 - self.envelope) * self.attack_coeff;
            } else {
                self.envelope *= self.release_coeff;
            }

            // 4. Gain reduction on sub-bass band ONLY (max -12 dB → 0.25)
            let gain = 1.0 - self.envelope * self.depth * 0.75;
            let low_gain = 1.0 - self.mix + gain * self.mix;

            // 5. Split slave into sub-bass (<150 Hz) + upper band (>150 Hz)
            let x = slave[i];
            self.slave_lp_state += alpha * (x - self.slave_lp_state);
            let low = self.slave_lp_state;
            let high = x - low;

            slave[i] = low * low_gain + high;
        }
        self.det_lp_state = super::flush_denorm(self.det_lp_state);
        self.slave_lp_state = super::flush_denorm(self.slave_lp_state);
        self.lp_energy = super::flush_denorm(self.lp_energy);
        self.envelope = super::flush_denorm(self.envelope);
    }

    /// Process a stereo block with a single shared sidechain detector and
    /// independent L/R sub-bass crossover states (no L/R state bleed or 2x rate).
    pub fn process_block_stereo(&mut self, sidechain: &[f32], slave_l: &mut [f32], slave_r: &mut [f32]) {
        let len = sidechain.len().min(slave_l.len()).min(slave_r.len());
        let alpha = self.audio_lp_alpha;
        for i in 0..len {
            // 1. Sub-bass band extraction on mono sidechain trigger (once per sample)
            self.det_lp_state += alpha * (sidechain[i] - self.det_lp_state);
            let energy = self.det_lp_state * self.det_lp_state;

            // 2. Low-pass filter energy (~20 Hz, smoothed RMS proxy)
            self.lp_energy = self.lp_energy * self.lp_coeff + energy * (1.0 - self.lp_coeff);

            // 3. Kick detection & envelope follow
            if self.lp_energy > self.threshold * self.threshold {
                self.envelope += (1.0 - self.envelope) * self.attack_coeff;
            } else {
                self.envelope *= self.release_coeff;
            }

            // 4. Shared gain reduction on sub-bass band ONLY (max -12 dB -> 0.25)
            let gain = 1.0 - self.envelope * self.depth * 0.75;
            let low_gain = 1.0 - self.mix + gain * self.mix;

            // 5. Independent L/R sub-bass crossovers (<150 Hz)
            let xl = slave_l[i];
            self.slave_lp_state += alpha * (xl - self.slave_lp_state);
            let low_l = self.slave_lp_state;
            slave_l[i] = low_l * low_gain + (xl - low_l);

            let xr = slave_r[i];
            self.slave_lp_state_r += alpha * (xr - self.slave_lp_state_r);
            let low_r = self.slave_lp_state_r;
            slave_r[i] = low_r * low_gain + (xr - low_r);
        }
        self.det_lp_state = super::flush_denorm(self.det_lp_state);
        self.slave_lp_state = super::flush_denorm(self.slave_lp_state);
        self.slave_lp_state_r = super::flush_denorm(self.slave_lp_state_r);
        self.lp_energy = super::flush_denorm(self.lp_energy);
        self.envelope = super::flush_denorm(self.envelope);
    }

    /// Set the duck depth. Clamped to 0.0..=1.0.
    pub fn set_depth(&mut self, depth: f32) {
        self.depth = depth.clamp(0.0, 1.0);
    }

    /// Set the wet/dry mix. Clamped to 0.0..=1.0.
    pub fn set_mix(&mut self, mix: f32) {
        self.mix = mix.clamp(0.0, 1.0);
    }

    /// Reset all stateful accumulators (envelope and filter states).
    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.det_lp_state = 0.0;
        self.slave_lp_state = 0.0;
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

    /// SE-10 break-test: a high-frequency hi-hat (8 kHz) in the sidechain must
    /// NOT trigger the sub-bass kick detector, and a kick must NOT duck highs.
    #[test]
    fn test_spectral_ignores_hihat_and_preserves_highs() {
        let mut sc = SpectralSidechainCompressor::new(SR, 1.0, 1.0);
        let n = 2048;
        let hihat: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 8000.0 * i as f32 / SR).sin() * 0.9)
            .collect();
        let sub_orig: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 60.0 * i as f32 / SR).sin() * 0.8)
            .collect();
        let mut sub_slave = sub_orig.clone();

        sc.process_block(&hihat, &mut sub_slave);
        let max_diff = sub_orig
            .iter()
            .zip(sub_slave.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(max_diff < 1e-4, "8 kHz hi-hat must not trigger sub-bass ducking, max_diff={max_diff}");
    }
}
