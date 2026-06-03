//! Biquad filter — the fundamental building block of all EQ and filter effects.
//!
//! Implements the standard Direct Form II Transposed biquad:
//!   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
//!
//! Supports all filter types used in Mixi:
//!   - Low shelf  (EQ low band)
//!   - High shelf (EQ high band)
//!   - Peaking    (EQ mid band)
//!   - Lowpass    (Color FX, Master filter)
//!   - Highpass   (Color FX, Master filter, DC blocker)
//!
//! Reference: Audio EQ Cookbook by Robert Bristow-Johnson
//! https://www.w3.org/2011/audio/audio-eq-cookbook.html

use std::f32::consts::PI;

use crate::dsp::smoother::ParamSmoother;

/// A second-order IIR (biquad) filter.
#[derive(Clone, Debug)]
pub struct Biquad {
    // Coefficients (normalised: a0 = 1)
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,

    // State (Direct Form II Transposed)
    z1: f32,
    z2: f32,
}

impl Default for Biquad {
    fn default() -> Self {
        Self {
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            z1: 0.0, z2: 0.0,
        }
    }
}

impl Biquad {
    /// Create a new passthrough (bypass) filter.
    pub fn new() -> Self {
        Self::default()
    }

    /// Process a single sample (Direct Form II Transposed).
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    /// Process a block of samples in-place.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        for s in samples.iter_mut() {
            *s = self.tick(*s);
        }
        // Flush denormal state: once the input decays into the subnormal range
        // the DfII-T memories recirculate it and pin the CPU on every silent
        // block. One flush per block costs nothing and self-heals NaN/Inf too.
        self.z1 = super::flush_denorm(self.z1);
        self.z2 = super::flush_denorm(self.z2);
    }

    /// Reset filter state (zero delay memories).
    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    // ── Coefficient calculators ────────────────────────────────
    //
    // All follow the Audio EQ Cookbook conventions.
    // freq = center/corner frequency in Hz
    // gain_db = gain in decibels (for shelf/peaking)
    // q = quality factor
    // sr = sample rate in Hz

    /// Configure as a low-pass filter.
    pub fn set_lowpass(&mut self, freq: f32, q: f32, sr: f32) {
        let w0 = 2.0 * PI * freq / sr;
        let (sin_w0, cos_w0) = (w0.sin(), w0.cos());
        let alpha = sin_w0 / (2.0 * q);

        let b0 = (1.0 - cos_w0) / 2.0;
        let b1 = 1.0 - cos_w0;
        let b2 = (1.0 - cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.set_coefficients(b0, b1, b2, a0, a1, a2);
    }

    /// Configure as a high-pass filter.
    pub fn set_highpass(&mut self, freq: f32, q: f32, sr: f32) {
        let w0 = 2.0 * PI * freq / sr;
        let (sin_w0, cos_w0) = (w0.sin(), w0.cos());
        let alpha = sin_w0 / (2.0 * q);

        let b0 = (1.0 + cos_w0) / 2.0;
        let b1 = -(1.0 + cos_w0);
        let b2 = (1.0 + cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.set_coefficients(b0, b1, b2, a0, a1, a2);
    }

    /// Configure as a low-shelf filter.
    pub fn set_lowshelf(&mut self, freq: f32, gain_db: f32, sr: f32) {
        let a = 10.0f32.powf(gain_db / 40.0); // sqrt of linear gain
        let w0 = 2.0 * PI * freq / sr;
        let (sin_w0, cos_w0) = (w0.sin(), w0.cos());
        let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let sq_a = 2.0 * alpha * a.sqrt();

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + sq_a);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - sq_a);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + sq_a;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - sq_a;

        self.set_coefficients(b0, b1, b2, a0, a1, a2);
    }

    /// Configure as a high-shelf filter.
    pub fn set_highshelf(&mut self, freq: f32, gain_db: f32, sr: f32) {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let (sin_w0, cos_w0) = (w0.sin(), w0.cos());
        let alpha = sin_w0 / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let sq_a = 2.0 * alpha * a.sqrt();

        let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + sq_a);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - sq_a);
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + sq_a;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - sq_a;

        self.set_coefficients(b0, b1, b2, a0, a1, a2);
    }

    /// Configure as a peaking (parametric) EQ filter.
    pub fn set_peaking(&mut self, freq: f32, gain_db: f32, q: f32, sr: f32) {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let (sin_w0, cos_w0) = (w0.sin(), w0.cos());
        let alpha = sin_w0 / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        self.set_coefficients(b0, b1, b2, a0, a1, a2);
    }

    /// Normalise and store coefficients (divide all by a0).
    fn set_coefficients(&mut self, b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) {
        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
    }
}

// ── 3-Band EQ (convenience) ──────────────────────────────────

/// A 3-band parametric EQ matching Mixi's DeckChannel EQ.
///
/// EQ dB is smoothed per band (block-rate) — DJs ride the EQ constantly and an
/// instant coefficient swap on a running IIR zippers/clicks. The biquads are
/// ALWAYS run (a 0 dB shelf is exactly unity), so returning a band to flat can
/// never click from skipping a filter that still holds delayed state.
pub struct ThreeBandEq {
    pub low: Biquad,
    pub mid: Biquad,
    pub high: Biquad,
    low_smooth: ParamSmoother,
    mid_smooth: ParamSmoother,
    high_smooth: ParamSmoother,
    // dB the coefficients were last computed for — avoid recompute when steady.
    low_applied: f32,
    mid_applied: f32,
    high_applied: f32,
}

/// EQ gain smoothing time (ms) — avoids coefficient-jump zipper.
const EQ_SMOOTH_MS: f32 = 14.0;
/// Recompute coefficients only when the smoothed dB moved more than this.
const EQ_RECOMPUTE_EPS: f32 = 0.01;

impl ThreeBandEq {
    pub fn new(sr: f32) -> Self {
        let mk = || ParamSmoother::new(0.0, EQ_SMOOTH_MS, sr);
        let mut eq = Self {
            low: Biquad::new(),
            mid: Biquad::new(),
            high: Biquad::new(),
            low_smooth: mk(),
            mid_smooth: mk(),
            high_smooth: mk(),
            low_applied: 0.0,
            mid_applied: 0.0,
            high_applied: 0.0,
        };
        // Initialise with flat (0 dB) curves
        eq.low.set_lowshelf(250.0, 0.0, sr);
        eq.mid.set_peaking(1000.0, 0.0, 1.0, sr);
        eq.high.set_highshelf(4000.0, 0.0, sr);
        eq
    }

    /// Set EQ band gain targets (dB). Applied smoothly in process_block.
    pub fn set_gains(&mut self, low_db: f32, mid_db: f32, high_db: f32, _sr: f32) {
        self.low_smooth.set_target(low_db);
        self.mid_smooth.set_target(mid_db);
        self.high_smooth.set_target(high_db);
    }

    /// Advance the per-band dB smoothers across the block, recompute any band's
    /// coefficients whose smoothed value moved, then run all three biquads.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32], sr: f32) {
        let len = samples.len();
        for _ in 0..len {
            self.low_smooth.next();
            self.mid_smooth.next();
            self.high_smooth.next();
        }
        let low_db = self.low_smooth.value();
        let mid_db = self.mid_smooth.value();
        let high_db = self.high_smooth.value();

        if (low_db - self.low_applied).abs() > EQ_RECOMPUTE_EPS {
            self.low.set_lowshelf(250.0, low_db, sr);
            self.low_applied = low_db;
        }
        if (mid_db - self.mid_applied).abs() > EQ_RECOMPUTE_EPS {
            self.mid.set_peaking(1000.0, mid_db, 1.0, sr);
            self.mid_applied = mid_db;
        }
        if (high_db - self.high_applied).abs() > EQ_RECOMPUTE_EPS {
            self.high.set_highshelf(4000.0, high_db, sr);
            self.high_applied = high_db;
        }

        self.low.process_block(samples);
        self.mid.process_block(samples);
        self.high.process_block(samples);
    }

    pub fn reset(&mut self) {
        self.low.reset();
        self.mid.reset();
        self.high.reset();
        self.low_smooth.reset(self.low_applied);
        self.mid_smooth.reset(self.mid_applied);
        self.high_smooth.reset(self.high_applied);
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 44100.0;

    #[test]
    fn test_passthrough() {
        let mut f = Biquad::new();
        // Default is passthrough: y = x
        assert_eq!(f.tick(1.0), 1.0);
        assert_eq!(f.tick(0.5), 0.5);
        assert_eq!(f.tick(-0.3), -0.3);
    }

    #[test]
    fn test_lowpass_dc_passthrough() {
        let mut f = Biquad::new();
        f.set_lowpass(1000.0, 0.707, SR);
        // DC (0 Hz) should pass through a lowpass filter (gain ≈ 1.0)
        // Run 1000 samples of DC = 1.0 to reach steady state
        for _ in 0..1000 {
            f.tick(1.0);
        }
        let y = f.tick(1.0);
        assert!((y - 1.0).abs() < 0.01, "Lowpass DC gain: {}", y);
    }

    #[test]
    fn test_highpass_removes_dc() {
        let mut f = Biquad::new();
        f.set_highpass(100.0, 0.707, SR);
        // DC should be blocked by highpass
        for _ in 0..2000 {
            f.tick(1.0);
        }
        let y = f.tick(1.0);
        assert!(y.abs() < 0.01, "Highpass should remove DC, got {}", y);
    }

    #[test]
    fn test_lowshelf_boost() {
        let mut f = Biquad::new();
        f.set_lowshelf(250.0, 6.0, SR);
        // Low frequency sine (50 Hz) should be boosted
        let freq = 50.0;
        let mut max_out = 0.0f32;
        for i in 0..2000 {
            let x = (2.0 * PI * freq * i as f32 / SR).sin();
            let y = f.tick(x);
            if i > 500 { // skip transient
                max_out = max_out.max(y.abs());
            }
        }
        // 6 dB boost ≈ 2x amplitude
        assert!(max_out > 1.5, "Low shelf +6dB should boost, peak: {}", max_out);
    }

    #[test]
    fn test_highshelf_cut() {
        let mut f = Biquad::new();
        f.set_highshelf(4000.0, -12.0, SR);
        // High frequency sine (10 kHz) should be cut
        let freq = 10000.0;
        let mut max_out = 0.0f32;
        for i in 0..2000 {
            let x = (2.0 * PI * freq * i as f32 / SR).sin();
            let y = f.tick(x);
            if i > 500 {
                max_out = max_out.max(y.abs());
            }
        }
        // -12 dB ≈ 0.25x amplitude
        assert!(max_out < 0.5, "High shelf -12dB should cut, peak: {}", max_out);
    }

    #[test]
    fn test_peaking_boost() {
        let mut f = Biquad::new();
        f.set_peaking(1000.0, 6.0, 1.0, SR);
        // 1 kHz sine should be boosted
        let freq = 1000.0;
        let mut max_out = 0.0f32;
        for i in 0..2000 {
            let x = (2.0 * PI * freq * i as f32 / SR).sin();
            let y = f.tick(x);
            if i > 500 {
                max_out = max_out.max(y.abs());
            }
        }
        assert!(max_out > 1.5, "Peaking +6dB at 1kHz should boost, peak: {}", max_out);
    }

    #[test]
    fn test_reset() {
        let mut f = Biquad::new();
        f.set_lowpass(1000.0, 0.707, SR);
        f.tick(1.0);
        f.tick(1.0);
        assert!(f.z1 != 0.0 || f.z2 != 0.0);
        f.reset();
        assert_eq!(f.z1, 0.0);
        assert_eq!(f.z2, 0.0);
    }

    #[test]
    fn test_process_block() {
        let mut f = Biquad::new();
        f.set_lowpass(5000.0, 0.707, SR);
        let mut block = [0.5f32; 128];
        f.process_block(&mut block);
        // All values should be close to 0.5 (lowpass passes DC-like signal)
        // First few frames transition, but later frames converge
        // Just check no NaN/Inf
        for s in &block {
            assert!(s.is_finite(), "Got non-finite value: {}", s);
        }
    }

    #[test]
    fn test_three_band_eq() {
        let mut eq = ThreeBandEq::new(SR);
        eq.set_gains(0.0, 0.0, 0.0, SR);
        let mut block = [0.5f32; 128];
        eq.process_block(&mut block, SR);
        // Flat EQ should ≈ passthrough
        assert!((block[127] - 0.5).abs() < 0.05, "Flat EQ: {}", block[127]);
    }

    #[test]
    fn test_stability_extreme_params() {
        let mut f = Biquad::new();
        // Very low frequency, high Q — should not explode
        f.set_lowpass(20.0, 10.0, SR);
        for _ in 0..10000 {
            let y = f.tick(1.0);
            assert!(y.is_finite(), "Filter unstable");
        }
    }
}
