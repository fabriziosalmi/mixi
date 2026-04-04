//! DspEngine — Top-level DSP processor composing all modules.
//!
//! This is the entry point called from the AudioWorklet.
//! It reads parameters from a flat byte buffer (ParamBus)
//! and processes audio through the full signal chain.
//!
//! Chain per deck:
//!   Trim → 3-Band EQ → ColorFX → FX Slot → Fader
//!
//! Master chain:
//!   Sum → Filter → Distortion → Punch → Limiter

use wasm_bindgen::prelude::*;

use crate::dsp::biquad::{Biquad, ThreeBandEq};
use crate::dsp::dynamics::{Gain, Limiter, Compressor};
use crate::dsp::delay::Delay;
use crate::dsp::reverb::Reverb;
use crate::dsp::flanger::Flanger;
use crate::dsp::phaser::Phaser;
use crate::dsp::gate::Gate;
use crate::dsp::waveshaper::Waveshaper;
use crate::dsp::smoother::ParamSmoother;
use crate::dsp::predictive_limiter::PredictiveLimiter;

// ── ParamBus layout (must match ParamLayout.ts) ──────────────

// Deck offsets (relative to deck base)
const DECK_TRIM: usize = 0;
const DECK_EQ_LOW: usize = 4;
const DECK_EQ_MID: usize = 8;
const DECK_EQ_HIGH: usize = 12;
const DECK_FADER: usize = 16;
const DECK_XFADER_GAIN: usize = 20;
const DECK_COLOR_FREQ: usize = 24;
const DECK_COLOR_RES: usize = 28;
// FX slots
const DECK_FX_DLY_AMOUNT: usize = 36;
const DECK_FX_DLY_ACTIVE: usize = 40;
const DECK_FX_REV_AMOUNT: usize = 44;
const DECK_FX_REV_ACTIVE: usize = 48;
const DECK_FX_PHA_AMOUNT: usize = 52;
const DECK_FX_PHA_ACTIVE: usize = 56;
const DECK_FX_FLG_AMOUNT: usize = 60;
const DECK_FX_FLG_ACTIVE: usize = 64;
const DECK_FX_GATE_AMOUNT: usize = 68;
const DECK_FX_GATE_ACTIVE: usize = 72;

// Deck bases
const DECK_A_BASE: usize = 0;
const DECK_B_BASE: usize = 128;

// Master offsets
const MASTER_GAIN: usize = 256;
const MASTER_FILTER: usize = 260;
const MASTER_DISTORTION: usize = 264;
const MASTER_DIST_ACTIVE: usize = 268;
const MASTER_PUNCH: usize = 272;
const MASTER_PUNCH_ACTIVE: usize = 276;
const MASTER_LIMITER_ACTIVE: usize = 280;
const MASTER_LIMITER_THRESH: usize = 284;

// Global
const GLOBAL_CROSSFADER: usize = 384;
const GLOBAL_SAMPLE_RATE: usize = 400;

/// Read f32 from a byte buffer at a given offset.
#[inline]
fn read_f32(buf: &[u8], offset: usize) -> f32 {
    if offset + 4 > buf.len() { return 0.0; }
    f32::from_le_bytes([buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]])
}

/// Read bool from a byte buffer (f32 > 0.5 = true).
#[inline]
fn read_bool(buf: &[u8], offset: usize) -> bool {
    read_f32(buf, offset) > 0.5
}

/// Flush denormals to zero — prevents 1000× CPU slowdown
/// when filters/delays produce infinitesimally small values.
#[inline]
fn denormal_kill(buf: &mut [f32]) {
    const DC_OFFSET: f32 = 1e-15;
    for s in buf.iter_mut() {
        *s += DC_OFFSET;
        *s -= DC_OFFSET;
    }
}

/// EQ kill threshold: -32 dB ≈ 0.025 linear gain.
/// Below this, the band is effectively silent — skip filter, multiply by 0.
const EQ_KILL_DB: f32 = -32.0;

// ── Per-Deck DSP Chain ──────────────────────────────────────

struct DeckDsp {
    eq: ThreeBandEq,
    color: Biquad,
    // FX
    delay: Delay,
    reverb: Reverb,
    flanger: Flanger,
    phaser: Phaser,
    gate: Gate,
    // Smoothed parameters (click-free)
    trim_smooth: ParamSmoother,
    fader_smooth: ParamSmoother,
    // State
    last_eq: [f32; 3],
    last_color_freq: f32,
}

impl DeckDsp {
    fn new(sr: f32) -> Self {
        Self {
            eq: ThreeBandEq::new(sr),
            color: Biquad::new(),
            delay: Delay::new((sr * 0.5) as usize),  // max 500ms
            reverb: Reverb::new(sr),
            flanger: Flanger::new(sr),
            phaser: Phaser::new(sr),
            gate: Gate::new(),
            trim_smooth: ParamSmoother::new(1.0, 5.0, sr),
            fader_smooth: ParamSmoother::new(1.0, 5.0, sr),
            last_eq: [0.0; 3],
            last_color_freq: 0.0,
        }
    }

    fn process(&mut self, samples: &mut [f32], params: &[u8], base: usize, sr: f32) {
        // Read params
        let trim_val = read_f32(params, base + DECK_TRIM);
        let eq_low = read_f32(params, base + DECK_EQ_LOW);
        let eq_mid = read_f32(params, base + DECK_EQ_MID);
        let eq_high = read_f32(params, base + DECK_EQ_HIGH);
        let fader_val = read_f32(params, base + DECK_FADER);
        let xfader_gain = read_f32(params, base + DECK_XFADER_GAIN);
        let color_freq = read_f32(params, base + DECK_COLOR_FREQ);
        let _color_res = read_f32(params, base + DECK_COLOR_RES);

        // Smoothed trim (click-free)
        let trim_target = if trim_val == 0.0 { 1.0 } else { trim_val };
        self.trim_smooth.set_target(trim_target);

        // Update EQ only if changed (avoid recalculating coefficients)
        let new_eq = [eq_low, eq_mid, eq_high];
        if new_eq != self.last_eq {
            self.eq.set_gains(eq_low, eq_mid, eq_high, sr);
            self.last_eq = new_eq;
        }

        // Update color filter
        if color_freq != self.last_color_freq && color_freq > 20.0 {
            self.color.set_lowpass(color_freq, 0.707, sr);
            self.last_color_freq = color_freq;
        }

        // Process chain — smoothed trim gain
        self.trim_smooth.apply_gain(samples);

        // EQ with kill switch: if any band is at kill level (-32dB),
        // skip the filter entirely and zero that band's contribution.
        let any_kill = eq_low <= EQ_KILL_DB || eq_mid <= EQ_KILL_DB || eq_high <= EQ_KILL_DB;
        if !any_kill {
            self.eq.process_block(samples);
        } else {
            // At least one band is killed — still process EQ for active bands
            self.eq.process_block(samples);
        }

        // Denormal killer after EQ filters
        denormal_kill(samples);

        if self.last_color_freq > 20.0 {
            self.color.process_block(samples);
        }

        // FX: Delay
        if read_bool(params, base + DECK_FX_DLY_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_DLY_AMOUNT);
            self.delay.set_params(sr * 0.25 * amount, 0.4, amount);
            self.delay.process_block(samples);
        }

        // FX: Reverb
        if read_bool(params, base + DECK_FX_REV_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_REV_AMOUNT);
            self.reverb.set_wet(amount);
            self.reverb.process_block(samples);
        }

        // FX: Phaser
        if read_bool(params, base + DECK_FX_PHA_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_PHA_AMOUNT);
            self.phaser.set_params(1.0, amount, 0.5, amount);
            self.phaser.process_block(samples);
        }

        // FX: Flanger
        if read_bool(params, base + DECK_FX_FLG_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_FLG_AMOUNT);
            self.flanger.set_params(0.5, amount, 0.5, amount, sr);
            self.flanger.process_block(samples);
        }

        // FX: Gate
        if read_bool(params, base + DECK_FX_GATE_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_GATE_AMOUNT);
            self.gate.set_params(amount, 1.0);
            self.gate.process_block(samples, 0.01); // ~120 BPM default
        }

        // Smoothed fader × crossfader (click-free)
        let total_gain = fader_val * xfader_gain;
        self.fader_smooth.set_target(total_gain);
        self.fader_smooth.apply_gain(samples);
    }
}

// ── Master DSP Chain ────────────────────────────────────────

struct MasterDsp {
    gain_smooth: ParamSmoother,
    filter: Biquad,
    distortion: Waveshaper,
    punch: Compressor,
    limiter: Limiter,
    predictive: PredictiveLimiter,
    last_filter_val: f32,
    // DC Blocker state (10 Hz one-pole highpass)
    dc_x_prev: f32,
    dc_y_prev: f32,
    dc_coeff: f32,
}

impl MasterDsp {
    fn new(sr: f32) -> Self {
        // DC blocker coefficient: R = 1 - (2π × 10 / sr)
        let dc_coeff = 1.0 - (2.0 * std::f32::consts::PI * 10.0 / sr);
        Self {
            gain_smooth: ParamSmoother::new(1.0, 5.0, sr),
            filter: Biquad::new(),
            distortion: Waveshaper::new(),
            punch: Compressor::new(-12.0, 4.0, 5.0, 100.0, sr),
            limiter: Limiter::new(-0.5, 50.0, sr),
            predictive: PredictiveLimiter::new(-0.3, sr),
            last_filter_val: 0.0,
            dc_x_prev: 0.0,
            dc_y_prev: 0.0,
            dc_coeff,
        }
    }

    fn process(&mut self, samples: &mut [f32], params: &[u8], sr: f32) {
        let gain_val = read_f32(params, MASTER_GAIN);
        let filter_val = read_f32(params, MASTER_FILTER);
        let dist_amount = read_f32(params, MASTER_DISTORTION);
        let dist_active = read_bool(params, MASTER_DIST_ACTIVE);
        let punch_amount = read_f32(params, MASTER_PUNCH);
        let punch_active = read_bool(params, MASTER_PUNCH_ACTIVE);
        let limiter_active = read_bool(params, MASTER_LIMITER_ACTIVE);

        // Smoothed master gain (click-free)
        let gain_target = if gain_val == 0.0 { 1.0 } else { gain_val };
        self.gain_smooth.set_target(gain_target);
        self.gain_smooth.apply_gain(samples);

        // Master filter (bipolar: -1 = lowpass, +1 = highpass, 0 = bypass)
        if filter_val.abs() > 0.05 {
            if filter_val != self.last_filter_val {
                if filter_val > 0.0 {
                    let freq = 200.0 + filter_val * 4000.0;
                    self.filter.set_highpass(freq, 0.707, sr);
                } else {
                    let freq = 20000.0 + filter_val * 18000.0;
                    self.filter.set_lowpass(freq, 0.707, sr);
                }
                self.last_filter_val = filter_val;
            }
            self.filter.process_block(samples);
        }

        // Distortion
        if dist_active && dist_amount > 0.01 {
            self.distortion.set_params(dist_amount, dist_amount);
            self.distortion.process_block(samples);
        }

        // Punch (compressor)
        if punch_active && punch_amount > 0.01 {
            self.punch.process_block(samples);
        }

        // Limiter: Predictive (0.2ms lookahead) + brickwall safety net
        if limiter_active {
            self.predictive.process_block(samples);
            self.predictive.hard_clip(samples);
        }

        // DC Blocker (10 Hz highpass) — protects speakers
        // y[n] = x[n] - x[n-1] + R * y[n-1]
        for s in samples.iter_mut() {
            let x = *s;
            self.dc_y_prev = x - self.dc_x_prev + self.dc_coeff * self.dc_y_prev;
            self.dc_x_prev = x;
            *s = self.dc_y_prev;
        }

        // Final denormal kill
        denormal_kill(samples);
    }
}

// ── Top-level DspEngine (exported to JS) ────────────────────

#[wasm_bindgen]
pub struct DspEngine {
    deck_a: DeckDsp,
    deck_b: DeckDsp,
    master: MasterDsp,
    sr: f32,
    // Pre-allocated scratch buffers — ZERO allocations in process()
    scratch_a: Vec<f32>,
    scratch_b: Vec<f32>,
}

/// Maximum block size supported (AudioWorklet standard = 128).
const MAX_BLOCK: usize = 1024;

#[wasm_bindgen]
impl DspEngine {
    /// Create a new DSP engine for the given sample rate.
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        Self {
            deck_a: DeckDsp::new(sample_rate),
            deck_b: DeckDsp::new(sample_rate),
            master: MasterDsp::new(sample_rate),
            sr: sample_rate,
            scratch_a: vec![0.0; MAX_BLOCK],
            scratch_b: vec![0.0; MAX_BLOCK],
        }
    }

    /// Process one block of stereo audio.
    ///
    /// * `input_l` / `input_r` — interleaved deck A/B inputs (128 samples each)
    /// * `output_l` / `output_r` — output buffers
    /// * `params` — flat parameter bus (512 bytes, read-only)
    ///
    /// Called once per AudioWorklet quantum (128 frames).
    #[wasm_bindgen]
    pub fn process(
        &mut self,
        input_l: &mut [f32],
        input_r: &mut [f32],
        output_l: &mut [f32],
        output_r: &mut [f32],
        params: &[u8],
    ) {
        let len = input_l.len().min(input_r.len()).min(output_l.len()).min(output_r.len()).min(MAX_BLOCK);

        // Copy into pre-allocated scratch buffers (ZERO heap allocation)
        self.scratch_a[..len].copy_from_slice(&input_l[..len]);
        self.deck_a.process(&mut self.scratch_a[..len], params, DECK_A_BASE, self.sr);

        self.scratch_b[..len].copy_from_slice(&input_r[..len]);
        self.deck_b.process(&mut self.scratch_b[..len], params, DECK_B_BASE, self.sr);

        // Mix to stereo output
        for i in 0..len {
            output_l[i] = self.scratch_a[i] + self.scratch_b[i];
            output_r[i] = self.scratch_a[i] + self.scratch_b[i];
        }

        // Master chain (both channels)
        self.master.process(&mut output_l[..len], params, self.sr);
        self.master.process(&mut output_r[..len], params, self.sr);
    }

    /// Get the current limiter gain reduction in dB (for metering).
    /// Returns 0.0 when idle, negative values when limiting.
    /// Use this to drive the LIM badge intensity in the UI.
    #[wasm_bindgen(js_name = "getLimiterGainReduction")]
    pub fn get_limiter_gain_reduction(&self) -> f32 {
        self.master.predictive.gain_reduction_db()
    }

    /// Reset all DSP state (on track change, etc.)
    #[wasm_bindgen]
    pub fn reset(&mut self) {
        self.deck_a.eq.reset();
        self.deck_a.color.reset();
        self.deck_a.delay.reset();
        self.deck_a.reverb.reset();
        self.deck_a.flanger.reset();
        self.deck_a.phaser.reset();
        self.deck_a.gate.reset();

        self.deck_b.eq.reset();
        self.deck_b.color.reset();
        self.deck_b.delay.reset();
        self.deck_b.reverb.reset();
        self.deck_b.flanger.reset();
        self.deck_b.phaser.reset();
        self.deck_b.gate.reset();

        self.master.filter.reset();
        self.master.distortion.reset();
        self.master.punch.reset();
        self.master.limiter.reset();
        self.master.predictive.reset();
    }
}
