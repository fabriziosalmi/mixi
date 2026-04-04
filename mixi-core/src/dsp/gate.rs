//! Gate — beat-locked amplitude gate.
//!
//! Chops the audio signal on beat boundaries,
//! creating a rhythmic stuttering effect.

/// Beat-locked gate effect.
pub struct Gate {
    /// Gate is open (1.0) or closed (0.0), smoothed
    envelope: f32,
    /// Current phase in the gate cycle [0, 1)
    phase: f32,
    /// Duty cycle: fraction of beat where gate is open (0–1)
    duty: f32,
    /// Smoothing coefficient for envelope
    smooth: f32,
    /// Dry/wet mix
    wet: f32,
}

impl Gate {
    pub fn new() -> Self {
        Self {
            envelope: 1.0,
            phase: 0.0,
            duty: 0.5,
            smooth: 0.995,
            wet: 0.0,
        }
    }

    /// Set gate parameters.
    /// * `duty` — Fraction of beat the gate stays open (0–1).
    /// * `wet` — Mix amount (0 = bypass, 1 = full gate).
    pub fn set_params(&mut self, duty: f32, wet: f32) {
        self.duty = duty.clamp(0.1, 0.9);
        self.wet = wet.clamp(0.0, 1.0);
    }

    /// Process a block, given the phase increment per sample.
    /// `phase_inc` = bpm / (60 * sr) — how much beat phase advances per sample.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32], phase_inc: f32) {
        if phase_inc <= 0.0 || self.wet == 0.0 {
            return; // bypass
        }

        let dry = 1.0 - self.wet;

        for s in samples.iter_mut() {
            // Gate target: open if phase < duty, closed otherwise
            let target = if self.phase < self.duty { 1.0 } else { 0.0 };

            // Smooth envelope to avoid clicks
            self.envelope = self.smooth * self.envelope + (1.0 - self.smooth) * target;

            *s *= dry + self.envelope * self.wet;

            self.phase += phase_inc;
            if self.phase >= 1.0 { self.phase -= 1.0; }
        }
    }

    pub fn reset(&mut self) {
        self.envelope = 1.0;
        self.phase = 0.0;
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gate_bypass() {
        let mut g = Gate::new();
        g.set_params(0.5, 0.0); // wet = 0 = bypass
        let mut buf = [0.5f32; 128];
        g.process_block(&mut buf, 0.01);
        assert_eq!(buf[0], 0.5);
    }

    #[test]
    fn test_gate_chops() {
        let mut g = Gate::new();
        g.set_params(0.5, 1.0); // 50% duty, full wet
        g.smooth = 0.0; // instant for testing

        // Phase inc = 0.01 → 100 samples per beat
        let mut buf = [1.0f32; 200];
        g.process_block(&mut buf, 0.01);

        // First 50 samples: gate open (phase 0–0.5)
        assert!(buf[10] > 0.5, "Gate should be open: {}", buf[10]);
        // Samples 50–99: gate closed (phase 0.5–1.0)
        assert!(buf[60] < 0.5, "Gate should be closed: {}", buf[60]);
    }

    #[test]
    fn test_gate_reset() {
        let mut g = Gate::new();
        g.phase = 0.7;
        g.envelope = 0.3;
        g.reset();
        assert_eq!(g.phase, 0.0);
        assert_eq!(g.envelope, 1.0);
    }
}
