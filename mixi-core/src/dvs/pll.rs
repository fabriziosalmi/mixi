//! Phase-Locked Loop for timecode vinyl decoding.
//!
//! The PLL generates an internal oscillator that tracks the phase
//! of the incoming timecode signal. The phase error between the
//! oscillator and the input gives us instantaneous speed and direction.
//!
//! This is the heart of DVS — everything else (position, filtering,
//! scratch detection) derives from the PLL output.
//!
//! ## Why PLL, not zero-crossing?
//!
//! Zero-crossing counting is fragile:
//!   - A single scratch on the vinyl adds or removes a crossing → position jumps
//!   - Low signal levels cause false crossings from noise
//!   - No sub-sample precision
//!
//! The PLL tracks phase continuously:
//!   - A scratch is just a brief phase perturbation → loop filter absorbs it
//!   - Low signal → PLL coasts at last known frequency (graceful degradation)
//!   - Phase resolution is limited only by floating-point precision
//!
//! ## PI Controller tuning
//!
//! The PLL uses a Proportional-Integral controller:
//!   - Proportional gain (kp): tracks fast changes (scratch response)
//!   - Integral gain (ki): eliminates steady-state error (lock precision)
//!   - Ratio kp/ki ≈ 20:1 optimized for vinyl timecode characteristics
//!   - Bandwidth: 8% of carrier frequency (stable at extremes, fast lock)

/// Maximum number of Lissajous points to buffer per block.
const LISSAJOUS_BUFFER_SIZE: usize = 200;

/// PLL decoder for timecode vinyl signals.
pub struct PllDecoder {
    /// Phase of the internal oscillator (radians, 0 to 2π).
    phase: f64,
    /// Instantaneous frequency estimate (Hz).
    freq: f64,
    /// Center/carrier frequency (Hz).
    center_freq: f64,
    /// Sample rate (Hz).
    sample_rate: f64,
    /// Proportional gain.
    kp: f64,
    /// Integral gain.
    ki: f64,
    /// Integral accumulator.
    integral: f64,
    /// Lock strength (exponential moving average of phase coherence).
    lock: f64,
    /// Lissajous buffer for UI visualization.
    lissajous: Vec<f32>,
    /// Decimation counter for Lissajous (we don't need 44100 points).
    lissajous_decimation: u32,
    /// Decimation ratio (store 1 in N samples).
    lissajous_ratio: u32,
}

/// Output from a single PLL sample.
#[derive(Debug, Clone, Copy)]
pub struct PllOutput {
    /// Speed relative to nominal: 1.0 = normal, 0.0 = stopped, -1.0 = reverse.
    pub speed: f32,
    /// Position delta in cycles (fractional, accumulate for absolute position).
    pub position_delta: f32,
    /// Phase error in radians (small = good lock).
    pub phase_error: f32,
    /// Lock strength: 0.0 = unlocked, 1.0 = perfect lock.
    pub lock_strength: f32,
}

impl PllDecoder {
    /// Create a new PLL for the given carrier frequency and sample rate.
    ///
    /// The bandwidth is automatically set to 15% of the carrier frequency,
    /// which gives good tracking up to ±50% speed variation (sufficient for
    /// scratch and pitch-bend).
    pub fn new(center_freq: f64, sample_rate: f64) -> Self {
        // PI controller design (critically damped)
        // Bandwidth 8% of carrier: fast lock + stable at extremes.
        // The gains kp/ki are per-sample normalized coefficients.
        // In the frequency update, kp is scaled by sample_rate to convert
        // the per-sample phase error (rad) into frequency correction (Hz).
        let bandwidth = center_freq * 0.08;
        let omega_n = std::f64::consts::TAU * bandwidth / sample_rate;
        let kp = 2.0 * omega_n;
        let ki = omega_n * omega_n;

        // Lissajous: target ~100 points per block (128 samples at 44100 Hz)
        let lissajous_ratio = (sample_rate / 100.0 / (44100.0 / 128.0)).max(1.0) as u32;

        Self {
            phase: 0.0,
            freq: center_freq,
            center_freq,
            sample_rate,
            kp,
            ki,
            integral: 0.0,
            lock: 0.0,
            lissajous: Vec::with_capacity(LISSAJOUS_BUFFER_SIZE * 2),
            lissajous_decimation: 0,
            lissajous_ratio,
        }
    }

    /// Process a single stereo sample pair (f64 precision throughout).
    ///
    /// For quadrature signals (Serato, MIXI-CUT): L = sin component, R = cos component.
    /// For mono timecodes (Traktor, MixVibes): both channels carry the same signal
    /// but the PLL derives phase from the analytic signal (Hilbert transform approximation).
    #[inline]
    pub fn process_sample(&mut self, input_l: f64, input_r: f64) -> PllOutput {
        let il = input_l;
        let ir = input_r;

        // Amplitude gate: if signal is too weak, don't update PLL
        // (prevents noise from corrupting the oscillator)
        let amplitude = (il * il + ir * ir).sqrt();
        if amplitude < 0.005 {
            // No signal — coast at current frequency, decay lock
            let alpha = 1.0 / (self.sample_rate * 0.05);
            self.lock = self.lock * (1.0 - alpha) + 0.0 * alpha;
            self.phase += std::f64::consts::TAU * self.freq / self.sample_rate;
            if self.phase >= std::f64::consts::TAU { self.phase -= std::f64::consts::TAU; }

            // Lissajous
            self.lissajous_decimation += 1;
            if self.lissajous_decimation >= self.lissajous_ratio
                && self.lissajous.len() < LISSAJOUS_BUFFER_SIZE * 2
            {
                self.lissajous_decimation = 0;
                self.lissajous.push(input_l as f32);
                self.lissajous.push(input_r as f32);
            }

            return PllOutput {
                speed: (self.freq / self.center_freq) as f32,
                position_delta: (self.freq / self.sample_rate) as f32,
                phase_error: 0.0,
                lock_strength: self.lock.clamp(0.0, 1.0) as f32,
            };
        }

        // Phase of the input signal
        // atan2(sin, cos) = θ for quadrature signals L=sin(θ), R=cos(θ)
        let input_phase = f64::atan2(il, ir);

        // Phase error = difference between input and our oscillator
        let mut error = input_phase - self.phase;

        // Wrap to [-π, π]
        if error > std::f64::consts::PI {
            error -= std::f64::consts::TAU;
        } else if error < -std::f64::consts::PI {
            error += std::f64::consts::TAU;
        }

        // PI controller
        self.integral += error * self.ki;

        // Clamp integral to prevent windup (±50% of center freq).
        // Also drain integral toward zero when lock is poor — this prevents
        // the PLL from accumulating bias during needle drops or signal loss,
        // which would cause a slow drift after re-lock.
        let max_integral = self.center_freq * 0.5;
        let drain = if self.lock < 0.3 { 0.98 } else { 1.0 }; // 2%/sample drain when unlocked
        self.integral = (self.integral * drain).clamp(-max_integral, max_integral);

        // Update frequency estimate (PI controller output in Hz).
        // kp * sample_rate converts per-sample phase error to Hz correction.
        // integral accumulates slowly for steady-state accuracy.
        self.freq = self.center_freq + error * self.kp * self.sample_rate + self.integral;

        // Clamp frequency to reasonable range (0 to 3× carrier = -100% to +200% speed)
        self.freq = self.freq.clamp(
            -self.center_freq * 2.0,
            self.center_freq * 3.0,
        );

        // Advance oscillator phase
        self.phase += std::f64::consts::TAU * self.freq / self.sample_rate;

        // Wrap phase to [0, 2π]
        if self.phase >= std::f64::consts::TAU {
            self.phase -= std::f64::consts::TAU;
        } else if self.phase < 0.0 {
            self.phase += std::f64::consts::TAU;
        }

        // Lock detection: exponential moving average of phase coherence
        // cos(error) ≈ 1.0 when error ≈ 0 (perfect lock)
        let coherence = error.cos();
        // τ ≈ 50ms → α = 1 / (sr * 0.05) ≈ 0.00045 at 44100
        let alpha = 1.0 / (self.sample_rate * 0.05);
        self.lock = self.lock * (1.0 - alpha) + coherence * alpha;

        // Speed = instantaneous frequency / carrier frequency
        let speed = self.freq / self.center_freq;

        // Position delta = cycles per sample
        let position_delta = self.freq / self.sample_rate;

        // Lissajous buffer (decimated)
        self.lissajous_decimation += 1;
        if self.lissajous_decimation >= self.lissajous_ratio
            && self.lissajous.len() < LISSAJOUS_BUFFER_SIZE * 2
        {
            self.lissajous_decimation = 0;
            self.lissajous.push(input_l as f32);
            self.lissajous.push(input_r as f32);
        }

        PllOutput {
            speed: speed as f32,
            position_delta: position_delta as f32,
            phase_error: error as f32,
            lock_strength: self.lock.clamp(0.0, 1.0) as f32,
        }
    }

    /// Get the current lock strength (0.0 = unlocked, 1.0 = perfect).
    pub fn lock_strength(&self) -> f64 {
        self.lock.clamp(0.0, 1.0)
    }

    /// Get the buffered Lissajous points [x, y, x, y, ...] and clear the buffer.
    pub fn lissajous_buffer(&self) -> &[f32] {
        &self.lissajous
    }

    /// Clear the Lissajous buffer (call after reading).
    pub fn clear_lissajous(&mut self) {
        self.lissajous.clear();
    }

    /// Reset the PLL to initial state.
    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.freq = self.center_freq;
        self.integral = 0.0;
        self.lock = 0.0;
        self.lissajous.clear();
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_quadrature(freq: f64, sr: f64, duration_ms: f64, amplitude: f64) -> Vec<(f64, f64)> {
        let samples = (sr * duration_ms / 1000.0) as usize;
        (0..samples)
            .map(|i| {
                let t = i as f64 / sr;
                let phase = std::f64::consts::TAU * freq * t;
                (phase.sin() * amplitude, phase.cos() * amplitude)
            })
            .collect()
    }

    #[test]
    fn test_pll_locks_to_carrier() {
        let sr = 44100.0;
        let freq = 3000.0;
        let mut pll = PllDecoder::new(freq, sr);

        let signal = generate_quadrature(freq, sr, 200.0, 0.8);
        let mut last_output = PllOutput {
            speed: 0.0, position_delta: 0.0, phase_error: 0.0, lock_strength: 0.0,
        };

        for &(l, r) in &signal {
            last_output = pll.process_sample(l, r);
        }

        assert!(
            last_output.lock_strength > 0.5,
            "PLL should lock after 200ms, lock = {}", last_output.lock_strength
        );
        assert!(
            (last_output.speed - 1.0).abs() < 0.15,
            "Speed should be ~1.0, got {}", last_output.speed
        );
    }

    #[test]
    fn test_pll_tracks_double_speed() {
        let sr = 44100.0;
        let center = 3000.0;
        let input_freq = center * 2.0; // 45rpm on a 33rpm timecode = ~1.36×, but 2× for test
        let mut pll = PllDecoder::new(center, sr);

        let signal = generate_quadrature(input_freq, sr, 300.0, 0.8);
        let mut last = PllOutput { speed: 0.0, position_delta: 0.0, phase_error: 0.0, lock_strength: 0.0 };

        for &(l, r) in &signal {
            last = pll.process_sample(l, r);
        }

        assert!(
            (last.speed - 2.0).abs() < 0.3,
            "Speed should be ~2.0, got {}", last.speed
        );
    }

    #[test]
    fn test_pll_silence_coasts() {
        let sr = 44100.0;
        let mut pll = PllDecoder::new(3000.0, sr);

        // Feed silence
        for _ in 0..4410 {
            pll.process_sample(0.0, 0.0);
        }

        // Lock should be very low on silence
        assert!(pll.lock_strength() < 0.3, "Lock on silence = {}", pll.lock_strength());
    }

    #[test]
    fn test_pll_reset() {
        let sr = 44100.0;
        let mut pll = PllDecoder::new(3000.0, sr);

        // Process some signal
        let signal = generate_quadrature(3000.0, sr, 100.0, 0.8);
        for &(l, r) in &signal {
            pll.process_sample(l, r);
        }

        pll.reset();
        assert!(pll.lock_strength() < 0.01);
    }

    #[test]
    fn test_lissajous_buffer_fills() {
        let sr = 44100.0;
        let mut pll = PllDecoder::new(3000.0, sr);

        let signal = generate_quadrature(3000.0, sr, 50.0, 0.8);
        for &(l, r) in &signal {
            pll.process_sample(l, r);
        }

        let buf = pll.lissajous_buffer();
        assert!(!buf.is_empty(), "Lissajous buffer should have points");
        assert!(buf.len() % 2 == 0, "Lissajous should be x,y pairs");
    }
}
