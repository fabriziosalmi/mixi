//! Flanger — short modulated delay with LFO.
//!
//! Creates the classic "jet" sweep effect by mixing
//! the dry signal with a copy delayed by 1–10ms,
//! where the delay time is modulated by a sine LFO.

use std::f32::consts::PI;

/// Flanger effect.
pub struct Flanger {
    buffer: Vec<f32>,
    write_pos: usize,
    /// LFO phase [0, 2π)
    lfo_phase: f32,
    /// LFO frequency in Hz (typically 0.1–5 Hz)
    lfo_rate: f32,
    /// Minimum delay in samples
    min_delay: f32,
    /// Delay sweep depth in samples
    depth: f32,
    /// Feedback amount (-1 to 1)
    feedback: f32,
    /// Dry/wet mix (0–1)
    wet: f32,
    /// Inverse sample rate for LFO increment
    inv_sr: f32,
}

impl Flanger {
    /// Create a flanger with the given sample rate.
    pub fn new(sr: f32) -> Self {
        // Max delay ~15ms at any sample rate
        let max_samples = (sr * 0.015) as usize + 2;
        Self {
            buffer: vec![0.0; max_samples],
            write_pos: 0,
            lfo_phase: 0.0,
            lfo_rate: 0.5,
            min_delay: sr * 0.001, // 1ms minimum
            depth: sr * 0.004,     // 4ms sweep
            feedback: 0.5,
            wet: 0.0,
            inv_sr: 1.0 / sr,
        }
    }

    /// Set flanger parameters.
    pub fn set_params(&mut self, rate: f32, depth: f32, feedback: f32, wet: f32, sr: f32) {
        self.lfo_rate = rate.clamp(0.05, 10.0);
        self.min_delay = sr * 0.001;
        self.depth = (depth * sr * 0.008).clamp(0.0, (self.buffer.len() - 2) as f32 - self.min_delay);
        self.feedback = feedback.clamp(-0.95, 0.95);
        self.wet = wet.clamp(0.0, 1.0);
    }

    /// Process a block of samples.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        let buf_len = self.buffer.len();
        let dry = 1.0 - self.wet;

        for s in samples.iter_mut() {
            // LFO: sine wave modulating delay time
            let lfo = (self.lfo_phase * 2.0 * PI).sin() * 0.5 + 0.5; // 0..1
            let delay = self.min_delay + lfo * self.depth;

            // Read with linear interpolation
            let read_pos = (self.write_pos as f32 - delay + buf_len as f32) % buf_len as f32;
            let idx0 = read_pos.floor() as usize % buf_len;
            let idx1 = (idx0 + 1) % buf_len;
            let frac = read_pos.fract();
            let delayed = self.buffer[idx0] * (1.0 - frac) + self.buffer[idx1] * frac;

            // Write with feedback
            self.buffer[self.write_pos] = *s + delayed * self.feedback;

            // Output
            *s = *s * dry + delayed * self.wet;

            self.write_pos = (self.write_pos + 1) % buf_len;
            self.lfo_phase += self.lfo_rate * self.inv_sr;
            if self.lfo_phase >= 1.0 { self.lfo_phase -= 1.0; }
        }
    }

    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
        self.lfo_phase = 0.0;
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flanger_dry() {
        let mut f = Flanger::new(44100.0);
        f.wet = 0.0;
        let mut buf = [0.5f32; 128];
        f.process_block(&mut buf);
        assert!((buf[0] - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_flanger_produces_modulation() {
        let mut f = Flanger::new(44100.0);
        f.set_params(2.0, 0.5, 0.5, 1.0, 44100.0);

        // Feed constant signal — output should vary due to LFO
        let mut buf = [0.5f32; 4096];
        f.process_block(&mut buf);

        // Check variance (should be non-zero)
        let mean: f32 = buf.iter().sum::<f32>() / buf.len() as f32;
        let variance: f32 = buf.iter().map(|s| (s - mean).powi(2)).sum::<f32>() / buf.len() as f32;
        assert!(variance > 0.0001, "Flanger should modulate, variance: {}", variance);
    }

    #[test]
    fn test_flanger_finite() {
        let mut f = Flanger::new(44100.0);
        f.set_params(1.0, 1.0, 0.9, 1.0, 44100.0);
        let mut buf = [0.3f32; 4096];
        f.process_block(&mut buf);
        for s in &buf {
            assert!(s.is_finite(), "Got non-finite: {}", s);
        }
    }

    #[test]
    fn test_flanger_reset() {
        let mut f = Flanger::new(44100.0);
        f.set_params(1.0, 0.5, 0.5, 1.0, 44100.0);
        f.process_block(&mut [1.0; 256]);
        f.reset();
        assert!(f.buffer.iter().all(|&s| s == 0.0));
        assert_eq!(f.lfo_phase, 0.0);
    }
}
