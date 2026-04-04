//! Reverb — Schroeder reverb algorithm.
//!
//! Uses 4 parallel comb filters + 2 series allpass filters.
//! Simple, efficient, and good enough for DJ use.
//!
//! All internal buffers use power-of-2 sizes with bitmask wrapping.
//!
//! Reference: Schroeder, M.R. (1961) "Natural Sounding Artificial Reverberation"

use super::delay::next_power_of_2;

/// Comb filter (feedback delay).
struct CombFilter {
    buffer: Vec<f32>,
    mask: usize,
    pos: usize,
    feedback: f32,
    damp: f32,
    damp_prev: f32,
}

impl CombFilter {
    fn new(size: usize, feedback: f32, damp: f32) -> Self {
        let sz = next_power_of_2(size.max(2));
        Self {
            buffer: vec![0.0; sz],
            mask: sz - 1,
            pos: 0,
            feedback,
            damp,
            damp_prev: 0.0,
        }
    }

    #[inline]
    fn tick(&mut self, input: f32) -> f32 {
        let output = self.buffer[self.pos];

        // Low-pass damping (simulates air absorption)
        let filtered = output * (1.0 - self.damp) + self.damp_prev * self.damp;
        self.damp_prev = filtered;

        self.buffer[self.pos] = input + filtered * self.feedback;
        self.pos = (self.pos + 1) & self.mask;

        output
    }

    fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.damp_prev = 0.0;
        self.pos = 0;
    }
}

/// Allpass filter.
struct AllpassFilter {
    buffer: Vec<f32>,
    mask: usize,
    pos: usize,
    feedback: f32,
}

impl AllpassFilter {
    fn new(size: usize, feedback: f32) -> Self {
        let sz = next_power_of_2(size.max(2));
        Self {
            buffer: vec![0.0; sz],
            mask: sz - 1,
            pos: 0,
            feedback,
        }
    }

    #[inline]
    fn tick(&mut self, input: f32) -> f32 {
        let buf_out = self.buffer[self.pos];
        let output = -input + buf_out;
        self.buffer[self.pos] = input + buf_out * self.feedback;
        self.pos = (self.pos + 1) & self.mask;
        output
    }

    fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.pos = 0;
    }
}

/// Schroeder reverb with dry/wet control.
pub struct Reverb {
    combs: [CombFilter; 4],
    allpasses: [AllpassFilter; 2],
    wet: f32,
}

// Comb filter delay lengths (in samples at 44.1kHz)
// Tuned to be coprime to avoid metallic resonances
const COMB_LENGTHS: [usize; 4] = [1116, 1188, 1277, 1356];
const AP_LENGTHS: [usize; 2] = [225, 556];
const COMB_FEEDBACK: f32 = 0.84;
const COMB_DAMP: f32 = 0.2;
const AP_FEEDBACK: f32 = 0.5;

impl Reverb {
    /// Create a new reverb tuned for the given sample rate.
    pub fn new(sr: f32) -> Self {
        let scale = sr / 44100.0;
        Self {
            combs: [
                CombFilter::new((COMB_LENGTHS[0] as f32 * scale) as usize, COMB_FEEDBACK, COMB_DAMP),
                CombFilter::new((COMB_LENGTHS[1] as f32 * scale) as usize, COMB_FEEDBACK, COMB_DAMP),
                CombFilter::new((COMB_LENGTHS[2] as f32 * scale) as usize, COMB_FEEDBACK, COMB_DAMP),
                CombFilter::new((COMB_LENGTHS[3] as f32 * scale) as usize, COMB_FEEDBACK, COMB_DAMP),
            ],
            allpasses: [
                AllpassFilter::new((AP_LENGTHS[0] as f32 * scale) as usize, AP_FEEDBACK),
                AllpassFilter::new((AP_LENGTHS[1] as f32 * scale) as usize, AP_FEEDBACK),
            ],
            wet: 0.0,
        }
    }

    /// Set wet/dry mix (0 = dry, 1 = full wet).
    pub fn set_wet(&mut self, wet: f32) {
        self.wet = wet.clamp(0.0, 1.0);
    }

    /// Process a block of mono samples.
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        let dry = 1.0 - self.wet;

        for s in samples.iter_mut() {
            let input = *s;

            // Sum parallel comb outputs
            let mut comb_sum = 0.0f32;
            for comb in &mut self.combs {
                comb_sum += comb.tick(input);
            }
            comb_sum *= 0.25; // normalize

            // Series allpasses
            let mut ap_out = comb_sum;
            for ap in &mut self.allpasses {
                ap_out = ap.tick(ap_out);
            }

            *s = input * dry + ap_out * self.wet;
        }
    }

    pub fn reset(&mut self) {
        for c in &mut self.combs { c.reset(); }
        for a in &mut self.allpasses { a.reset(); }
    }
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reverb_dry() {
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(0.0);
        let mut buf = [0.5f32; 128];
        rev.process_block(&mut buf);
        assert!((buf[0] - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_reverb_wet_produces_tail() {
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(1.0);

        // Power-of-2 comb buffers are 2048 samples — need larger test buffer
        let mut buf = vec![0.0f32; 8192];
        buf[0] = 1.0;
        rev.process_block(&mut buf);

        let tail_energy: f32 = buf[2048..4096].iter().map(|s| s * s).sum();
        assert!(tail_energy > 0.0001, "Reverb should produce tail, energy: {}", tail_energy);
    }

    #[test]
    fn test_reverb_decays() {
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(1.0);

        let mut buf = vec![0.0f32; 16384];
        buf[0] = 1.0;
        rev.process_block(&mut buf);

        let early: f32 = buf[2048..4096].iter().map(|s| s * s).sum();
        let late: f32 = buf[12000..14000].iter().map(|s| s * s).sum();
        assert!(late < early, "Reverb should decay: early={}, late={}", early, late);
    }

    #[test]
    fn test_reverb_reset() {
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(1.0);
        rev.process_block(&mut [1.0; 512]);
        rev.reset();
        let mut silence = [0.0f32; 128];
        rev.process_block(&mut silence);
        let energy: f32 = silence.iter().map(|s| s * s).sum();
        assert!(energy < 0.0001, "After reset, should be silent: {}", energy);
    }
}
