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

// NOTE: This engine is intentionally free of wasm-bindgen / js-sys so it can be
// compiled into the lean, zero-import DSP wasm (the `mixi-dsp` crate) that the
// AudioWorklet loads, as well as run as plain Rust in native tests. The worklet
// boundary is provided by `extern "C"` wrappers in mixi-dsp's `lean_dsp`, not here.

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
use crate::dsp::spectral_sidechain::SpectralSidechainCompressor;

// ── ParamBus layout (must match ParamLayout.ts) ──────────────

// Deck offsets (relative to deck base)
// MUST match src/audio/dsp/ParamLayout.ts exactly!
const DECK_TRIM: usize = 0;
const DECK_EQ_LOW: usize = 4;
const DECK_EQ_MID: usize = 8;
const DECK_EQ_HIGH: usize = 12;
const DECK_FADER: usize = 16;
const DECK_XFADER_GAIN: usize = 20;
const DECK_COLOR_FREQ: usize = 24;
const DECK_COLOR_RES: usize = 28;
const DECK_CUE_ACTIVE: usize = 32;
const DECK_PLAYBACK_RATE: usize = 36;
// FX slots (each has amount + active flag, some have extra params)
const DECK_FX_FLT_AMOUNT: usize = 40;
const DECK_FX_FLT_ACTIVE: usize = 44;
const DECK_FX_DLY_AMOUNT: usize = 48;
const DECK_FX_DLY_ACTIVE: usize = 52;
const DECK_FX_DLY_TIME: usize = 56;
const DECK_FX_DLY_FEEDBACK: usize = 60;
const DECK_FX_REV_AMOUNT: usize = 64;
const DECK_FX_REV_ACTIVE: usize = 68;
const DECK_FX_PHA_AMOUNT: usize = 72;
const DECK_FX_PHA_ACTIVE: usize = 76;
const DECK_FX_FLG_AMOUNT: usize = 80;
const DECK_FX_FLG_ACTIVE: usize = 84;
const DECK_FX_GATE_AMOUNT: usize = 88;
const DECK_FX_GATE_ACTIVE: usize = 92;
// 96 = AUTO_GAIN (JS pre-multiplies into TRIM; not read here)
const DECK_BPM: usize = 100;
const DECK_COLOR_MODE: usize = 104; // 0 = bypass, -1 = lowpass, +1 = highpass

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
const MASTER_SIDECHAIN_DEPTH: usize = 288;
const MASTER_SIDECHAIN_MIX: usize = 292;
const MASTER_EQ_LOW: usize = 296;
const MASTER_EQ_MID: usize = 300;
const MASTER_EQ_HIGH: usize = 304;

// Global
const GLOBAL_CROSSFADER: usize = 384;
const GLOBAL_SAMPLE_RATE: usize = 400;

// H2: Layout version — must match PARAM_LAYOUT_VERSION in ParamLayout.ts
const PARAM_LAYOUT_VERSION_OFFSET: usize = 508;
const PARAM_LAYOUT_VERSION: f32 = 3.0;

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


// ── Per-Deck DSP Chain ──────────────────────────────────────

struct DeckDsp {
    eq: ThreeBandEq,
    color: Biquad,
    // FX
    fx_flt: Biquad,
    delay: Delay,
    reverb: Reverb,
    flanger: Flanger,
    phaser: Phaser,
    gate: Gate,
    // Smoothed parameters (click-free)
    trim_smooth: ParamSmoother,
    fader_smooth: ParamSmoother,
    // State
    last_color_freq: f32,
    last_color_res: f32,
    last_color_mode: i8,
    last_fx_flt_amount: f32,
}

impl DeckDsp {
    fn new(sr: f32) -> Self {
        Self {
            eq: ThreeBandEq::new(sr),
            color: Biquad::new(),
            fx_flt: Biquad::new(),
            // SE-07: 2000 ms capacity supports 1.5–2 beat DJ delays at any BPM
            delay: Delay::new((sr * 2.0) as usize),
            reverb: Reverb::new(sr),
            flanger: Flanger::new(sr),
            phaser: Phaser::new(sr),
            gate: Gate::new(),
            trim_smooth: ParamSmoother::new(1.0, 5.0, sr),
            fader_smooth: ParamSmoother::new(1.0, 5.0, sr),
            last_color_freq: 0.0,
            last_color_res: 0.707,
            last_color_mode: 0,
            last_fx_flt_amount: -1.0,
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
        let color_res = read_f32(params, base + DECK_COLOR_RES);
        let color_mode_f = read_f32(params, base + DECK_COLOR_MODE);
        let color_mode: i8 = if color_mode_f < -0.5 {
            -1
        } else if color_mode_f > 0.5 {
            1
        } else {
            0
        };

        // Smoothed trim (click-free)
        let trim_target = if trim_val == 0.0 { 1.0 } else { trim_val };
        self.trim_smooth.set_target(trim_target);

        // Set EQ targets every block — set_gains just updates the per-band
        // smoothers (cheap, epsilon-guarded); coefficients are recomputed inside
        // process_block only while a smoothed dB is actually moving.
        self.eq.set_gains(eq_low, eq_mid, eq_high, sr);

        // Update color filter (SE-03: supports LPF, HPF, resonance, and clean bypass)
        let q = if color_res > 0.05 { color_res.clamp(0.1, 12.0) } else { 0.707 };
        if color_mode == 0 {
            if self.last_color_mode != 0 {
                self.color.reset();
                self.last_color_mode = 0;
                self.last_color_freq = 0.0;
            }
        } else if color_freq > 20.0 {
            if color_mode != self.last_color_mode
                || (color_freq - self.last_color_freq).abs() > 0.1
                || (q - self.last_color_res).abs() > 0.005
            {
                if color_mode < 0 {
                    self.color.set_lowpass(color_freq, q, sr);
                } else {
                    self.color.set_highpass(color_freq, q, sr);
                }
                self.last_color_mode = color_mode;
                self.last_color_freq = color_freq;
                self.last_color_res = q;
            }
        }

        // Process chain — smoothed trim gain
        self.trim_smooth.apply_gain(samples);

        // EQ — dB smoothed per band, biquads always run (unity at 0 dB)
        self.eq.process_block(samples, sr);

        // Denormal killer after EQ filters
        denormal_kill(samples);

        if self.last_color_mode != 0 && self.last_color_freq > 20.0 {
            self.color.process_block(samples);
        }

        // SE-09: FX Filter (bipolar sweep: 0..0.5 = LPF 20k→120Hz, 0.5..1.0 = HPF 20→8kHz)
        if read_bool(params, base + DECK_FX_FLT_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_FLT_AMOUNT).clamp(0.0, 1.0);
            if amount > 0.01 {
                if (amount - self.last_fx_flt_amount).abs() > 0.002 {
                    if amount <= 0.5 {
                        let t = 1.0 - amount * 2.0; // 1 → 0
                        let freq = 120.0 * (20000.0f32 / 120.0).powf(t);
                        self.fx_flt.set_lowpass(freq, 1.2, sr);
                    } else {
                        let t = (amount - 0.5) * 2.0; // 0 → 1
                        let freq = 20.0 * (8000.0f32 / 20.0).powf(t);
                        self.fx_flt.set_highpass(freq, 1.2, sr);
                    }
                    self.last_fx_flt_amount = amount;
                }
                self.fx_flt.process_block(samples);
            }
        } else if self.last_fx_flt_amount >= 0.0 {
            self.fx_flt.reset();
            self.last_fx_flt_amount = -1.0;
        }

        // FX: Delay (uses dedicated time/feedback params from ParamLayout)
        if read_bool(params, base + DECK_FX_DLY_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_DLY_AMOUNT);
            let time_ms = read_f32(params, base + DECK_FX_DLY_TIME);
            let feedback = read_f32(params, base + DECK_FX_DLY_FEEDBACK);
            let time_samples = if time_ms > 0.0 { time_ms * sr / 1000.0 } else { sr * 0.25 };
            let fb = if feedback > 0.0 { feedback } else { 0.4 };
            self.delay.set_params(time_samples, fb, amount);
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

        // FX: Gate — beat-locked. phase_inc = bpm/(60*sr) advances one gate
        // cycle per beat. The old hardcoded 0.01 implied ~26000 BPM (a ~441 Hz
        // buzz); driving it from the track's BPM makes it actually gate on the
        // beat. bpm==0 (un-analyzed) ⇒ phase_inc 0 ⇒ the gate bypasses.
        if read_bool(params, base + DECK_FX_GATE_ACTIVE) {
            let amount = read_f32(params, base + DECK_FX_GATE_AMOUNT);
            let bpm = read_f32(params, base + DECK_BPM);
            let gate_phase_inc = if bpm > 0.0 { bpm / (60.0 * sr) } else { 0.0 };
            self.gate.set_params(amount, 1.0);
            self.gate.process_block(samples, gate_phase_inc);
        }

        // Denormal kill after the recursive FX chain (delay/reverb/phaser/
        // flanger) and before the fader, so subnormals from one effect don't
        // bleed into the next deck block or the master sum.
        denormal_kill(samples);

        // Smoothed fader × crossfader (click-free)
        // Exponential fader curve: val³ gives fine precision at low volumes
        // and matches human loudness perception (logarithmic hearing)
        let fader_curved = fader_val * fader_val * fader_val;
        let total_gain = fader_curved * xfader_gain;
        self.fader_smooth.set_target(total_gain);
        self.fader_smooth.apply_gain(samples);
    }
}

// ── Master DSP Chain ────────────────────────────────────────

struct MasterDsp {
    gain_smooth: ParamSmoother,
    eq: ThreeBandEq,
    filter: Biquad,
    distortion: Waveshaper,
    punch: Compressor,
    limiter: Limiter,
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
            eq: ThreeBandEq::new(sr),
            filter: Biquad::new(),
            distortion: Waveshaper::new(),
            punch: Compressor::new(-12.0, 4.0, 5.0, 100.0, sr),
            limiter: Limiter::new(-0.5, 50.0, sr),
            last_filter_val: 0.0,
            dc_x_prev: 0.0,
            dc_y_prev: 0.0,
            dc_coeff,
        }
    }

    fn process_pre_limiter(&mut self, samples: &mut [f32], params: &[u8], sr: f32) {
        let gain_val = read_f32(params, MASTER_GAIN);
        let eq_low = read_f32(params, MASTER_EQ_LOW).clamp(-12.0, 12.0);
        let eq_mid = read_f32(params, MASTER_EQ_MID).clamp(-12.0, 12.0);
        let eq_high = read_f32(params, MASTER_EQ_HIGH).clamp(-12.0, 12.0);
        let filter_val = read_f32(params, MASTER_FILTER);
        let dist_amount = read_f32(params, MASTER_DISTORTION);
        let dist_active = read_bool(params, MASTER_DIST_ACTIVE);
        let punch_amount = read_f32(params, MASTER_PUNCH);
        let punch_active = read_bool(params, MASTER_PUNCH_ACTIVE);

        // Smoothed master gain (click-free)
        self.gain_smooth.set_target(gain_val);
        self.gain_smooth.apply_gain(samples);

        // SE-09: Master 3-band EQ
        self.eq.set_gains(eq_low, eq_mid, eq_high, sr);
        self.eq.process_block(samples, sr);

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

        // Punch (parallel compressor)
        if punch_active && punch_amount > 0.01 {
            self.punch.process_block_mix(samples, punch_amount);
        }
    }

    fn process_post_limiter(&mut self, samples: &mut [f32]) {
        // DC Blocker (10 Hz highpass) — protects speakers
        for s in samples.iter_mut() {
            let x = *s;
            self.dc_y_prev = x - self.dc_x_prev + self.dc_coeff * self.dc_y_prev;
            self.dc_x_prev = x;
            *s = self.dc_y_prev;
        }
        self.dc_y_prev = super::flush_denorm(self.dc_y_prev);
        self.dc_x_prev = super::flush_denorm(self.dc_x_prev);

        // Final denormal kill
        denormal_kill(samples);
    }
}

// ── Top-level DspEngine (exported to JS) ────────────────────

pub struct DspEngine {
    deck_a_l: DeckDsp,
    deck_a_r: DeckDsp,
    deck_b_l: DeckDsp,
    deck_b_r: DeckDsp,
    master_l: MasterDsp,  // C2 fix: separate state per channel
    master_r: MasterDsp,
    // SE-06: Shared stereo-linked predictive limiter (preserves L/R imaging)
    stereo_limiter: PredictiveLimiter,
    last_limiter_thresh: f32,
    sr: f32,
    // Pre-allocated scratch buffers — ZERO allocations in process()
    scratch_a_l: Vec<f32>,
    scratch_a_r: Vec<f32>,
    scratch_b_l: Vec<f32>,
    scratch_b_r: Vec<f32>,
    // Sidechain snapshot buffers — hold post-deck mono sum for cross-feed.
    // Pre-allocated to avoid Vec::to_vec() in the audio hot path.
    sc_snap_a: Vec<f32>,
    sc_snap_b: Vec<f32>,
    /// Sidechain: deck A triggers duck on deck B
    sidechain_a_to_b: SpectralSidechainCompressor,
    /// Sidechain: deck B triggers duck on deck A
    sidechain_b_to_a: SpectralSidechainCompressor,
}

/// Maximum block size supported (AudioWorklet standard = 128).
const MAX_BLOCK: usize = 1024;

/// Sum-bus headroom: 1/√2 ≈ -3 dB so a both-decks-full / centred-crossfader
/// sum (~1.41) lands at ~0 dBFS before the master dynamics chain.
const SUM_HEADROOM: f32 = 0.707_106_77;

impl DspEngine {
    /// Create a new DSP engine for the given sample rate.
    pub fn new(sample_rate: f32) -> Self {
        Self {
            deck_a_l: DeckDsp::new(sample_rate),
            deck_a_r: DeckDsp::new(sample_rate),
            deck_b_l: DeckDsp::new(sample_rate),
            deck_b_r: DeckDsp::new(sample_rate),
            master_l: MasterDsp::new(sample_rate),
            master_r: MasterDsp::new(sample_rate),
            stereo_limiter: PredictiveLimiter::new(-0.3, sample_rate),
            last_limiter_thresh: -0.3,
            sr: sample_rate,
            scratch_a_l: vec![0.0; MAX_BLOCK],
            scratch_a_r: vec![0.0; MAX_BLOCK],
            scratch_b_l: vec![0.0; MAX_BLOCK],
            scratch_b_r: vec![0.0; MAX_BLOCK],
            sc_snap_a: vec![0.0; MAX_BLOCK],
            sc_snap_b: vec![0.0; MAX_BLOCK],
            sidechain_a_to_b: SpectralSidechainCompressor::new(sample_rate, 0.0, 0.0),
            sidechain_b_to_a: SpectralSidechainCompressor::new(sample_rate, 0.0, 0.0),
        }
    }

    /// Process one block of TRUE STEREO audio (Deck A L/R + Deck B L/R → Master L/R).
    ///
    /// Called once per AudioWorklet quantum (128 frames). Zero heap allocations.
    pub fn process_stereo(
        &mut self,
        in_a_l: &[f32],
        in_a_r: &[f32],
        in_b_l: &[f32],
        in_b_r: &[f32],
        output_l: &mut [f32],
        output_r: &mut [f32],
        params: &[u8],
    ) {
        let len = in_a_l
            .len()
            .min(in_a_r.len())
            .min(in_b_l.len())
            .min(in_b_r.len())
            .min(output_l.len())
            .min(output_r.len())
            .min(MAX_BLOCK);

        // H2: Version check — passthrough if layout mismatch
        let version = read_f32(params, PARAM_LAYOUT_VERSION_OFFSET);
        if version != PARAM_LAYOUT_VERSION {
            for i in 0..len {
                output_l[i] = in_a_l[i] + in_b_l[i];
                output_r[i] = in_a_r[i] + in_b_r[i];
            }
            return;
        }

        // Copy into pre-allocated scratch buffers (ZERO heap allocation)
        self.scratch_a_l[..len].copy_from_slice(&in_a_l[..len]);
        self.scratch_a_r[..len].copy_from_slice(&in_a_r[..len]);
        self.deck_a_l.process(&mut self.scratch_a_l[..len], params, DECK_A_BASE, self.sr);
        self.deck_a_r.process(&mut self.scratch_a_r[..len], params, DECK_A_BASE, self.sr);

        self.scratch_b_l[..len].copy_from_slice(&in_b_l[..len]);
        self.scratch_b_r[..len].copy_from_slice(&in_b_r[..len]);
        self.deck_b_l.process(&mut self.scratch_b_l[..len], params, DECK_B_BASE, self.sr);
        self.deck_b_r.process(&mut self.scratch_b_r[..len], params, DECK_B_BASE, self.sr);

        // SE-10: Spectral sub-bass sidechain with unidirectional arbitration —
        // only the deck with stronger energy triggers ducking on the other deck,
        // preventing mutual pumping when both decks are playing.
        {
            let sc_depth = read_f32(params, MASTER_SIDECHAIN_DEPTH);
            let sc_mix = read_f32(params, MASTER_SIDECHAIN_MIX);
            if sc_depth > 0.001 && sc_mix > 0.001 {
                let mut energy_a = 0.0f32;
                let mut energy_b = 0.0f32;
                for i in 0..len {
                    let ma = 0.5 * (self.scratch_a_l[i] + self.scratch_a_r[i]);
                    let mb = 0.5 * (self.scratch_b_l[i] + self.scratch_b_r[i]);
                    self.sc_snap_a[i] = ma;
                    self.sc_snap_b[i] = mb;
                    energy_a += ma * ma;
                    energy_b += mb * mb;
                }
                if energy_a >= energy_b {
                    self.sidechain_a_to_b.set_depth(sc_depth);
                    self.sidechain_a_to_b.set_mix(sc_mix);
                    self.sidechain_a_to_b.process_block(&self.sc_snap_a[..len], &mut self.scratch_b_l[..len]);
                    self.sidechain_a_to_b.process_block(&self.sc_snap_a[..len], &mut self.scratch_b_r[..len]);
                } else {
                    self.sidechain_b_to_a.set_depth(sc_depth);
                    self.sidechain_b_to_a.set_mix(sc_mix);
                    self.sidechain_b_to_a.process_block(&self.sc_snap_b[..len], &mut self.scratch_a_l[..len]);
                    self.sidechain_b_to_a.process_block(&self.sc_snap_b[..len], &mut self.scratch_a_r[..len]);
                }
            }
        }

        // SE-01 fix: True stereo sum — Deck A L + Deck B L → Out L; Deck A R + Deck B R → Out R.
        for i in 0..len {
            output_l[i] = (self.scratch_a_l[i] + self.scratch_b_l[i]) * SUM_HEADROOM;
            output_r[i] = (self.scratch_a_r[i] + self.scratch_b_r[i]) * SUM_HEADROOM;
        }

        // Separate master pre-limiter chain per channel (gain, 3-band EQ, filter, distortion, punch)
        self.master_l.process_pre_limiter(&mut output_l[..len], params, self.sr);
        self.master_r.process_pre_limiter(&mut output_r[..len], params, self.sr);

        // SE-06: Stereo-linked predictive limiter (single shared GR envelope across L/R)
        if read_bool(params, MASTER_LIMITER_ACTIVE) {
            let thresh_db = read_f32(params, MASTER_LIMITER_THRESH);
            if thresh_db < -0.05 && (thresh_db - self.last_limiter_thresh).abs() > 0.05 {
                let clamped = thresh_db.clamp(-24.0, -0.1);
                self.stereo_limiter.set_threshold_db(clamped);
                self.last_limiter_thresh = clamped;
            }
            self.stereo_limiter.process_block_stereo(&mut output_l[..len], &mut output_r[..len]);
            self.stereo_limiter.hard_clip(&mut output_l[..len]);
            self.stereo_limiter.hard_clip(&mut output_r[..len]);
        }

        // Post-limiter DC blocker & denormal kill per channel
        self.master_l.process_post_limiter(&mut output_l[..len]);
        self.master_r.process_post_limiter(&mut output_r[..len]);
    }

    /// Legacy mono-per-deck entry point (kept for callers/tests passing 2 inputs).
    pub fn process(
        &mut self,
        input_l: &mut [f32],
        input_r: &mut [f32],
        output_l: &mut [f32],
        output_r: &mut [f32],
        params: &[u8],
    ) {
        self.process_stereo(input_l, input_l, input_r, input_r, output_l, output_r, params);
    }

    /// Get the current limiter gain reduction in dB (for metering).
    /// Returns 0.0 when idle, negative values when limiting.
    /// Use this to drive the LIM badge intensity in the UI.
    pub fn get_limiter_gain_reduction(&self) -> f32 {
        self.stereo_limiter.gain_reduction_db()
    }

    /// Reset all DSP state (on track change, etc.)
    pub fn reset(&mut self) {
        for deck in [&mut self.deck_a_l, &mut self.deck_a_r, &mut self.deck_b_l, &mut self.deck_b_r] {
            deck.eq.reset();
            deck.color.reset();
            deck.fx_flt.reset();
            deck.last_color_freq = 0.0;
            deck.last_color_mode = 0;
            deck.last_fx_flt_amount = -1.0;
            deck.delay.reset();
            deck.reverb.reset();
            deck.flanger.reset();
            deck.phaser.reset();
            deck.gate.reset();
        }

        for master in [&mut self.master_l, &mut self.master_r] {
            master.eq.reset();
            master.filter.reset();
            master.last_filter_val = 0.0;
            master.distortion.reset();
            master.punch.reset();
            master.limiter.reset();
            master.dc_x_prev = 0.0;
            master.dc_y_prev = 0.0;
        }

        self.stereo_limiter.reset();
        self.sidechain_a_to_b.reset();
        self.sidechain_b_to_a.reset();
    }

    // NOTE: The previous `processRaw` (raw byte-offset) entry point lived here.
    // It depended on `wasm_bindgen::memory()` / js-sys for a bounds check, which
    // forced wasm-bindgen imports into the worklet wasm. The AudioWorklet boundary
    // now lives in the mixi-dsp crate's `lean_dsp`, which owns its I/O buffers and
    // calls the safe slice-based `process()` above — no raw pointers, no js-sys,
    // zero wasm imports.
}
