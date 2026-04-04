//! Phaser — 4-stage allpass chain with LFO.
//!
//! Classic phaser effect: signal is split, one copy passes
//! through a chain of allpass filters swept by an LFO,
//! then mixed back with the dry signal.

use std::f32::consts::PI;

/// First-order allpass filter for phaser stages.
struct AllpassStage {
    a1: f32,
    z1: f32,
}

impl AllpassStage {
    fn new() -> Self {
        Self { a1: 0.0, z1: 0.0 }
    }

    /// Set the allpass coefficient from a frequency.
    fn set_freq(&mut self, freq: f32, sr: f32) {
        let w = 2.0 * PI * freq / sr;
        self.a1 = (w.tan() - 1.0) / (w.tan() + 1.0);
    }

    #[inline]
    fn tick(&mut self, x: f32) -> f32 {
        let y = self.a1 * x + self.z1;
        self.z1 = x - self.a1 * y;
        y
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
    }
}

/// 4-stage phaser with LFO.
pub struct Phaser {
    stages: [AllpassStage; 4],
    lfo_phase: f32,
    lfo_rate: f32,
    /// Sweep range: min and max frequency
    min_freq: f32,
    max_freq: f32,
    feedback: f32,
    wet: f32,
    inv_sr: f32,
    sr: f32,
    last_out: f32,
}

impl Phaser {
    pub fn new(sr: f32) -> Self {
        Self {
            stages: [AllpassStage::new(), AllpassStage::new(), AllpassStage::new(), AllpassStage::new()],
            lfo_phase: 0.0,
            lfo_rate: 0.5,
            min_freq: 200.0,
            max_freq: 1800.0,
            feedback: 0.5,
            wet: 0.0,
            inv_sr: 1.0 / sr,
            sr,
            last_out: 0.0,
        }
    }

    pub fn set_params(&mut self, rate: f32, depth: f32, feedback: f32, wet: f32) {
        self.lfo_rate = rate.clamp(0.05, 10.0);
        self.min_freq = 200.0;
        self.max_freq = 200.0 + depth.clamp(0.0, 1.0) * 3800.0;
        self.feedback = feedback.clamp(-0.95, 0.95);
        self.wet = wet.clamp(0.0, 1.0);
    }

    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        let dry = 1.0 - self.wet;

        for s in samples.iter_mut() {
            // LFO sweep frequency
            let lfo = (self.lfo_phase * 2.0 * PI).sin() * 0.5 + 0.5;
            let freq = self.min_freq + lfo * (self.max_freq - self.min_freq);

            // Update allpass coefficients
            for stage in &mut self.stages {
                stage.set_freq(freq, self.sr);
            }

            // Process through allpass chain with feedback
            let mut ap_out = *s + self.last_out * self.feedback;
            for stage in &mut self.stages {
                ap_out = stage.tick(ap_out);
            }
            self.last_out = ap_out;

            *s = *s * dry + ap_out * self.wet;

            self.lfo_phase += self.lfo_rate * self.inv_sr;
            if self.lfo_phase >= 1.0 { self.lfo_phase -= 1.0; }
        }
    }

    pub fn reset(&mut self) {
        for s in &mut self.stages { s.reset(); }
        self.lfo_phase = 0.0;
        self.last_out = 0.0;
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phaser_dry() {
        let mut p = Phaser::new(44100.0);
        p.set_params(1.0, 0.5, 0.0, 0.0);
        let mut buf = [0.5f32; 128];
        p.process_block(&mut buf);
        assert!((buf[0] - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_phaser_modulation() {
        let mut p = Phaser::new(44100.0);
        p.set_params(2.0, 1.0, 0.5, 1.0);
        let mut buf = [0.5f32; 4096];
        p.process_block(&mut buf);
        let variance: f32 = {
            let mean = buf.iter().sum::<f32>() / buf.len() as f32;
            buf.iter().map(|s| (s - mean).powi(2)).sum::<f32>() / buf.len() as f32
        };
        assert!(variance > 0.0001, "Phaser should modulate, var: {}", variance);
    }

    #[test]
    fn test_phaser_finite() {
        let mut p = Phaser::new(44100.0);
        p.set_params(1.0, 1.0, 0.9, 1.0);
        let mut buf = [0.3f32; 4096];
        p.process_block(&mut buf);
        for s in &buf {
            assert!(s.is_finite());
        }
    }
}
