//! One-Pole Parameter Smoother
//!
//! Prevents audio "clicks" when parameters change abruptly.
//! Uses a first-order IIR filter (exponential smoothing):
//!
//! ```text
//! y[n] = y[n-1] + α · (target - y[n-1])
//! ```
//!
//! where `α = 1 - e^(-1 / (τ · sample_rate))`
//!
//! Typical smoothing times:
//!   - Volume/Gain:  5-10ms  (fast, no audible click)
//!   - EQ:           10-20ms (avoid filter coefficient jumps)
//!   - Crossfader:   2-5ms   (DJ-fast response)

/// One-pole parameter smoother (first-order IIR lowpass).
#[derive(Debug, Clone)]
pub struct ParamSmoother {
    current: f32,
    target: f32,
    alpha: f32,
    /// True if current ≈ target (within ε).
    settled: bool,
}

const EPSILON: f32 = 1e-5;

impl ParamSmoother {
    /// Create a new smoother with the given time constant.
    ///
    /// * `initial` — starting value
    /// * `smooth_ms` — smoothing time in milliseconds
    /// * `sample_rate` — audio sample rate
    pub fn new(initial: f32, smooth_ms: f32, sample_rate: f32) -> Self {
        let tau = smooth_ms / 1000.0;
        let alpha = if tau > 0.0 {
            1.0 - (-1.0 / (tau * sample_rate)).exp()
        } else {
            1.0 // instant (no smoothing)
        };
        Self {
            current: initial,
            target: initial,
            alpha,
            settled: true,
        }
    }

    /// Set a new target value.
    #[inline]
    pub fn set_target(&mut self, target: f32) {
        if (self.target - target).abs() > EPSILON {
            self.target = target;
            self.settled = false;
        }
    }

    /// Advance one sample and return the smoothed value.
    #[inline]
    pub fn next(&mut self) -> f32 {
        if self.settled {
            return self.current;
        }
        self.current += self.alpha * (self.target - self.current);
        if (self.current - self.target).abs() < EPSILON {
            self.current = self.target;
            self.settled = true;
        }
        self.current
    }

    /// Process a block of samples, applying the smoothed value as gain.
    ///
    /// Each sample is multiplied by the interpolated parameter value,
    /// providing click-free gain changes.
    pub fn apply_gain(&mut self, buf: &mut [f32]) {
        if self.settled {
            // Already at target — apply constant gain
            let g = self.current;
            for s in buf.iter_mut() {
                *s *= g;
            }
        } else {
            // Interpolating — per-sample smoothing
            for s in buf.iter_mut() {
                *s *= self.next();
            }
        }
    }

    /// Get the current smoothed value without advancing.
    #[inline]
    pub fn value(&self) -> f32 {
        self.current
    }

    /// Check if the smoother has settled to the target.
    #[inline]
    pub fn is_settled(&self) -> bool {
        self.settled
    }

    /// Immediately snap to the target (no smoothing).
    pub fn snap(&mut self) {
        self.current = self.target;
        self.settled = true;
    }

    /// Reset to a new value instantly.
    pub fn reset(&mut self, value: f32) {
        self.current = value;
        self.target = value;
        self.settled = true;
    }

    /// Update the smoothing time constant.
    pub fn set_smooth_time(&mut self, smooth_ms: f32, sample_rate: f32) {
        let tau = smooth_ms / 1000.0;
        self.alpha = if tau > 0.0 {
            1.0 - (-1.0 / (tau * sample_rate)).exp()
        } else {
            1.0
        };
    }
}

// ── Tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settles_to_target() {
        let mut s = ParamSmoother::new(0.0, 5.0, 44100.0);
        s.set_target(1.0);
        // After 1 second, value must converge and smoother settle
        for _ in 0..44100 {
            s.next();
        }
        assert!((s.value() - 1.0).abs() < 0.001,
            "value should be ~1.0, got {}", s.value());
        assert!(s.is_settled(), "smoother should have settled");
    }

    #[test]
    fn no_instant_jump() {
        let mut s = ParamSmoother::new(0.0, 10.0, 44100.0);
        s.set_target(1.0);
        let first = s.next();
        // First sample should NOT be 1.0 — it should be smoothed
        assert!(first < 0.05, "first sample too high: {first}");
        assert!(first > 0.0, "first sample should be > 0");
    }

    #[test]
    fn instant_when_zero_time() {
        let mut s = ParamSmoother::new(0.0, 0.0, 44100.0);
        s.set_target(1.0);
        let first = s.next();
        assert!((first - 1.0).abs() < EPSILON);
    }

    #[test]
    fn settled_at_creation() {
        let s = ParamSmoother::new(0.5, 5.0, 44100.0);
        assert!(s.is_settled());
        assert!((s.value() - 0.5).abs() < EPSILON);
    }

    #[test]
    fn apply_gain_settled() {
        let mut s = ParamSmoother::new(0.5, 5.0, 44100.0);
        let mut buf = [1.0f32; 128];
        s.apply_gain(&mut buf);
        for sample in &buf {
            assert!((sample - 0.5).abs() < EPSILON);
        }
    }

    #[test]
    fn apply_gain_ramp() {
        let mut s = ParamSmoother::new(0.0, 5.0, 44100.0);
        s.set_target(1.0);
        let mut buf = [1.0f32; 128];
        s.apply_gain(&mut buf);
        // First sample should be near 0, last should be higher
        assert!(buf[0] < buf[127]);
        assert!(buf[0] < 0.1);
    }

    #[test]
    fn snap_bypasses_smoothing() {
        let mut s = ParamSmoother::new(0.0, 100.0, 44100.0);
        s.set_target(1.0);
        s.snap();
        assert!((s.value() - 1.0).abs() < EPSILON);
        assert!(s.is_settled());
    }

    #[test]
    fn reaches_90pct_in_expected_time() {
        // τ = 5ms → should reach ~90% within ~12ms (2.3τ)
        let sr = 44100.0;
        let mut s = ParamSmoother::new(0.0, 5.0, sr);
        s.set_target(1.0);
        let target_samples = (0.012 * sr) as usize; // 12ms
        for _ in 0..target_samples {
            s.next();
        }
        assert!(s.value() > 0.85, "value should be >85% after 12ms, got {}", s.value());
    }
}
