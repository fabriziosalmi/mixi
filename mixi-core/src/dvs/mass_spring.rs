//! Mass-Spring-Damper filter for DVS turntable physics.
//!
//! This filter is the difference between a DVS that feels "plastic"
//! and one that makes the DJ believe they're touching the music.
//!
//! ## The analogy
//!
//!   - The MP3 playback position is a HEAVY MASS (high inertia)
//!   - The vinyl decoder output is a HAND pulling a SPRING attached to the mass
//!   - A DAMPER prevents oscillation
//!
//! ## Behavior
//!
//!   - Normal play: hand moves steadily → mass follows smoothly
//!   - Wow & flutter (±1%): spring absorbs micro-vibrations → mass stays steady
//!   - Scratch (sudden force): spring tension exceeds threshold → mass snaps to hand
//!   - Spinback (extreme reverse): detected as special case → triggers FX in JS
//!
//! ## Why not just lowpass the speed?
//!
//! A lowpass filter adds latency uniformly. The mass-spring model adds latency
//! to small perturbations (noise) but responds instantly to large ones (scratch).
//! This is exactly what a real turntable motor does — the platter has inertia
//! but the DJ's hand overrides it.
//!
//! ## Parameter derivation
//!
//! The default parameters are derived from Technics SL-1200 characteristics:
//!   - Motor wow: ±0.025% at 33⅓ RPM
//!   - Flutter: ±0.035% weighted
//!   - Platter inertia: ~0.15 kg·m²
//!   - Start torque: 1.5 kgf·cm
//!   - Start time: 0.7s to rated speed

/// Mass-Spring-Damper filter for turntable physics simulation.
pub struct MassSpringDamper {
    /// Current output speed (filtered).
    output_speed: f64,
    /// Previous output speed (for acceleration detection).
    prev_speed: f64,
    /// Inertia coefficient (0.0-1.0). Higher = smoother, more latency.
    inertia: f64,
    /// Traction coefficient (0.0-1.0). Higher = more responsive.
    traction: f64,
    /// Threshold for scratch detection (speed delta).
    scratch_threshold: f64,
    /// Is the DJ currently scratching?
    scratching: bool,
    /// Counter for spinback detection (consecutive high-negative ticks).
    negative_ticks: u32,
    /// Spinback speed threshold.
    spinback_threshold: f64,
    /// Ticks required to confirm spinback.
    spinback_confirm_ticks: u32,
    /// Is spinback active?
    spinback: bool,
    /// Scratch release counter (how long since last scratch).
    scratch_release_ticks: u32,
    /// Ticks of stability needed to exit scratch mode.
    scratch_release_threshold: u32,
    /// Vinyl brake detection: consecutive ticks of decelerating speed.
    brake_ticks: u32,
    /// Is vinyl brake active (gradual deceleration → motor stop effect)?
    braking: bool,
}

/// Output from the mass-spring filter.
#[derive(Debug, Clone, Copy)]
pub struct MassSpringOutput {
    /// Filtered speed for MP3 playback.
    pub speed: f32,
    /// The DJ is touching the disc (scratch detected).
    pub is_scratching: bool,
    /// Spinback detected (extreme reverse for > 200ms).
    pub is_spinback: bool,
    /// Vinyl brake detected (gradual deceleration).
    pub is_braking: bool,
}

impl MassSpringDamper {
    /// Create with default Technics SL-1200 parameters.
    pub fn new() -> Self {
        Self {
            output_speed: 0.0,
            prev_speed: 0.0,
            // Derived from SL-1200 specs:
            // Motor servo maintains ±0.035% → inertia must absorb that
            // DJ scratch peaks at ~3× speed in ~50ms → threshold ≈ 0.3
            inertia: 0.95,
            traction: 0.05,
            scratch_threshold: 0.3,
            scratching: false,
            negative_ticks: 0,
            spinback_threshold: -2.0,  // Beyond -2× = extreme reverse
            spinback_confirm_ticks: 10, // ~230ms at ~44 ticks/sec (128-sample blocks at 44100)
            spinback: false,
            scratch_release_ticks: 0,
            scratch_release_threshold: 20, // ~460ms of stability to exit scratch
            brake_ticks: 0,
            braking: false,
        }
    }

    /// Create with custom parameters.
    pub fn with_params(inertia: f64, _traction: f64, scratch_threshold: f64) -> Self {
        let mut s = Self::new();
        let clamped_inertia = inertia.clamp(0.0, 0.999);
        s.inertia = clamped_inertia;
        // Enforce inertia + traction = 1.0 (proper EMA constraint).
        s.traction = 1.0 - clamped_inertia;
        s.scratch_threshold = scratch_threshold.max(0.01);
        s
    }

    /// Process one speed sample from the PLL.
    /// Call this once per audio block (not once per sample — the PLL
    /// provides averaged speed per block).
    pub fn process(&mut self, vinyl_speed: f64) -> MassSpringOutput {
        self.prev_speed = self.output_speed;

        let delta = (vinyl_speed - self.output_speed).abs();

        // ── Scratch detection ────────────────────────────────
        if delta > self.scratch_threshold {
            // Large speed change = external force (DJ's hand)
            // Snap immediately — zero filtering
            self.output_speed = vinyl_speed;
            self.scratching = true;
            self.scratch_release_ticks = 0;
        } else if self.scratching {
            // In scratch mode: follow closely but with slight smoothing
            // to avoid jitter from vinyl surface irregularities
            self.output_speed = self.output_speed * 0.3 + vinyl_speed * 0.7;
            if delta < 0.05 {
                self.scratch_release_ticks += 1;
                if self.scratch_release_ticks > self.scratch_release_threshold {
                    self.scratching = false;
                }
            } else {
                self.scratch_release_ticks = 0;
            }
        } else {
            // Normal mode: mass-spring filter
            // output = output * inertia + input * traction
            //
            // Adaptive traction: when vinyl is near-stopped (|speed| < 0.1)
            // but output is still moving (delta > 0.05), increase traction
            // to avoid the 2-second exponential tail on stop.
            // This preserves wow/flutter rejection during normal play
            // while allowing responsive stop/start.
            let effective_traction = if vinyl_speed.abs() < 0.1 && delta > 0.05 {
                // DJ stopped the disc — converge faster (10x traction)
                (self.traction * 10.0).min(0.5)
            } else {
                self.traction
            };
            self.output_speed = self.output_speed * (1.0 - effective_traction) + vinyl_speed * effective_traction;
        }

        // ── Vinyl brake detection ────────────────────────────
        // Detects gradual deceleration (DJ hitting stop button or lifting hand).
        // Distinct from scratch (sudden) and spinback (reverse).
        // When braking, follow more closely to avoid lag on the ramp-down.
        let decel = self.prev_speed - self.output_speed;
        if decel > 0.002 && self.output_speed > 0.0 && self.output_speed < self.prev_speed {
            self.brake_ticks += 1;
            if self.brake_ticks > 5 { // ~115ms of consistent deceleration
                self.braking = true;
            }
        } else if self.output_speed.abs() < 0.02 || self.output_speed >= self.prev_speed {
            self.brake_ticks = 0;
            self.braking = false;
        }

        // ── Low-speed dead zone (anti-jitter) ───────────────
        // At very low speeds (< 2%), PLL noise can cause oscillation.
        // Snap to exactly 0.0 to prevent audible artifacts.
        if self.output_speed.abs() < 0.02 && vinyl_speed.abs() < 0.02 {
            self.output_speed = 0.0;
        }

        // ── Spinback detection ───────────────────────────────
        if vinyl_speed < self.spinback_threshold {
            self.negative_ticks += 1;
            if self.negative_ticks > self.spinback_confirm_ticks {
                self.spinback = true;
            }
        } else {
            if self.spinback && vinyl_speed > 0.3 {
                // Vinyl returning to forward play → exit spinback
                self.spinback = false;
            }
            self.negative_ticks = 0;
        }

        MassSpringOutput {
            speed: self.output_speed as f32,
            is_scratching: self.scratching,
            is_spinback: self.spinback,
            is_braking: self.braking,
        }
    }

    /// Get current filtered speed.
    pub fn current_speed(&self) -> f64 {
        self.output_speed
    }

    /// Is currently in scratch mode?
    pub fn is_scratching(&self) -> bool {
        self.scratching
    }

    /// Is spinback active?
    pub fn is_spinback(&self) -> bool {
        self.spinback
    }

    /// Reset to stopped state.
    pub fn reset(&mut self) {
        self.output_speed = 0.0;
        self.prev_speed = 0.0;
        self.scratching = false;
        self.negative_ticks = 0;
        self.spinback = false;
        self.scratch_release_ticks = 0;
        self.brake_ticks = 0;
        self.braking = false;
    }

    /// Is vinyl brake active?
    pub fn is_braking(&self) -> bool {
        self.braking
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normal_play_filters_jitter() {
        let mut ms = MassSpringDamper::new();

        // Simulate 33rpm with ±0.5% wow/flutter
        let speeds = [1.0, 1.005, 0.995, 1.003, 0.997, 1.001, 0.999, 1.002];
        let mut outputs = Vec::new();

        for &s in &speeds {
            let out = ms.process(s);
            outputs.push(out.speed);
        }

        // Output should be smoother than input
        let input_range = 1.005 - 0.995;
        let output_range = outputs.iter().cloned().fold(f32::NEG_INFINITY, f32::max)
            - outputs.iter().cloned().fold(f32::INFINITY, f32::min);

        assert!(
            output_range < input_range,
            "Filter should reduce jitter: input range {} vs output range {}",
            input_range, output_range
        );
    }

    #[test]
    fn test_scratch_instant_response() {
        let mut ms = MassSpringDamper::new();

        // Warm up at normal speed
        for _ in 0..20 {
            ms.process(1.0);
        }

        // Sudden scratch: 1.0 → 2.0 (delta = 1.0 > threshold 0.3)
        let out = ms.process(2.0);
        assert!(out.is_scratching, "Should detect scratch");
        assert!(
            (out.speed - 2.0).abs() < 0.01,
            "Scratch should snap instantly, got {}", out.speed
        );
    }

    #[test]
    fn test_scratch_release() {
        let mut ms = MassSpringDamper::new();

        // Enter scratch
        for _ in 0..5 {
            ms.process(1.0);
        }
        ms.process(2.0); // scratch!

        // Return to normal speed
        for _ in 0..30 {
            let out = ms.process(1.0);
            if !out.is_scratching {
                // Should eventually exit scratch mode
                return;
            }
        }

        panic!("Should have exited scratch mode after ~30 ticks of stability");
    }

    #[test]
    fn test_spinback_detection() {
        let mut ms = MassSpringDamper::new();

        // Normal play
        for _ in 0..10 {
            ms.process(1.0);
        }

        // Sudden extreme reverse (spinback)
        for i in 0..15 {
            let out = ms.process(-3.0);
            if i > 10 {
                assert!(out.is_spinback, "Should detect spinback after {}  ticks", i);
                return;
            }
        }

        panic!("Should have detected spinback");
    }

    #[test]
    fn test_spinback_recovery() {
        let mut ms = MassSpringDamper::new();

        // Enter spinback
        for _ in 0..15 {
            ms.process(-3.0);
        }
        assert!(ms.is_spinback());

        // Return to forward play
        for _ in 0..5 {
            ms.process(1.0);
        }
        assert!(!ms.is_spinback(), "Should exit spinback on forward play");
    }

    #[test]
    fn test_stopped_disc() {
        let mut ms = MassSpringDamper::new();

        for _ in 0..10 {
            ms.process(1.0);
        }

        // Stop the disc gradually
        for _ in 0..50 {
            ms.process(0.0);
        }

        assert!(
            ms.current_speed().abs() < 0.05,
            "Should approach 0 speed, got {}", ms.current_speed()
        );
    }

    #[test]
    fn test_reset() {
        let mut ms = MassSpringDamper::new();
        for _ in 0..10 {
            ms.process(1.0);
        }
        ms.reset();
        assert!(ms.current_speed().abs() < 0.001);
        assert!(!ms.is_scratching());
        assert!(!ms.is_spinback());
    }

    #[test]
    fn test_custom_params() {
        let ms = MassSpringDamper::with_params(0.98, 0.02, 0.5);
        assert!((ms.inertia - 0.98).abs() < 0.001);
        assert!((ms.traction - 0.02).abs() < 0.001);
    }
}
