//!
//! Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
//!
//! This file is part of MIXI.
//! MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
//!
//! BPM Detection — powered by open-bpm
//!
//! Delegates to the open-bpm crate which provides a 7-estimator
//! architecture (IOI + Comb + AC + Spectral FFT + Hopf + Tempogram
//! + Low-band AC) with SuperFlux onset detection and metrical fusion.
//!
//! The wasm-bindgen API remains identical to mixi-core v3 for
//! backward compatibility with the TypeScript bridge.

use wasm_bindgen::prelude::*;
use open_bpm::{detect_with_options, DetectOptions};

// ── Result struct (unchanged from v3 — TS consumers don't change) ──

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct BpmResult {
    pub bpm: f32,
    pub offset: f32,
    pub confidence: f32,
}

// ── Mono downmix helper ───────────────────────────────────────

/// Mix multi-channel planar audio to mono.
/// Input layout: [ch0_sample0..ch0_sampleN, ch1_sample0..ch1_sampleN, ...]
fn mix_to_mono(samples: &[f32], num_channels: usize, samples_per_channel: usize) -> Vec<f32> {
    if num_channels <= 1 {
        return samples[..samples_per_channel.min(samples.len())].to_vec();
    }
    let inv = 1.0 / num_channels as f32;
    let mut mono = vec![0.0f32; samples_per_channel];
    for ch in 0..num_channels {
        let offset = ch * samples_per_channel;
        let end = (offset + samples_per_channel).min(samples.len());
        for i in 0..(end - offset) {
            mono[i] += samples[offset + i] * inv;
        }
    }
    mono
}

// ── Public API (wasm-bindgen) ─────────────────────────────────

/// Full BPM detection with segmented analysis.
/// Uses all 7 estimators, smart chunking, and metrical fusion.
#[wasm_bindgen]
pub fn detect_bpm(
    samples: &[f32],
    num_channels: usize,
    samples_per_channel: usize,
    sample_rate: f32,
    bpm_min: f32,
    bpm_max: f32,
) -> BpmResult {
    let mono = mix_to_mono(samples, num_channels, samples_per_channel);

    let opts = DetectOptions {
        min_bpm: bpm_min as f64,
        max_bpm: bpm_max as f64,
        segmented: true,
        ..Default::default()
    };

    let result = detect_with_options(&mono, sample_rate as u32, &opts);

    BpmResult {
        bpm: result.bpm as f32,
        offset: result.grid_offset as f32,
        confidence: result.confidence as f32,
    }
}

/// Fast BPM detection — single segment, no chunking.
/// For quick preview during track loading (~50ms).
#[wasm_bindgen]
pub fn detect_bpm_fast(
    samples: &[f32],
    num_channels: usize,
    samples_per_channel: usize,
    sample_rate: f32,
    bpm_min: f32,
    bpm_max: f32,
) -> BpmResult {
    let mono = mix_to_mono(samples, num_channels, samples_per_channel);

    let opts = DetectOptions {
        min_bpm: bpm_min as f64,
        max_bpm: bpm_max as f64,
        segmented: false, // single pass, faster
        ..Default::default()
    };

    let result = detect_with_options(&mono, sample_rate as u32, &opts);

    BpmResult {
        bpm: result.bpm as f32,
        offset: result.grid_offset as f32,
        confidence: result.confidence as f32,
    }
}

/// Legacy API returning [bpm, offset, confidence] as Vec<f32>.
#[wasm_bindgen]
pub fn detect_bpm_legacy(
    samples: &[f32],
    num_channels: usize,
    samples_per_channel: usize,
    sample_rate: f32,
    bpm_min: f32,
    bpm_max: f32,
) -> Vec<f32> {
    let r = detect_bpm(samples, num_channels, samples_per_channel, sample_rate, bpm_min, bpm_max);
    vec![r.bpm, r.offset, r.confidence]
}

// ── Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_silence_returns_low_confidence() {
        let silence = vec![0.0f32; 44100 * 5]; // 5 seconds of silence
        let r = detect_bpm(&silence, 1, silence.len(), 44100.0, 60.0, 200.0);
        assert!(r.confidence < 0.3, "Silence should have low confidence, got {}", r.confidence);
    }

    #[test]
    fn detect_120bpm_click_track() {
        let sr = 44100;
        let duration_s = 10;
        let bpm = 120.0;
        let beat_period = 60.0 / bpm;
        let total_samples = sr * duration_s;
        let mut samples = vec![0.0f32; total_samples];

        // Generate click track at 120 BPM
        for beat in 0..((duration_s as f64 / beat_period) as usize) {
            let sample_idx = (beat as f64 * beat_period * sr as f64) as usize;
            if sample_idx < total_samples {
                // Short click: 10 samples of impulse
                for i in 0..10.min(total_samples - sample_idx) {
                    samples[sample_idx + i] = 0.8 * (-0.5 * i as f32).exp();
                }
            }
        }

        let r = detect_bpm(&samples, 1, total_samples, sr as f32, 60.0, 200.0);
        // Should detect close to 120 BPM
        assert!((r.bpm - 120.0).abs() < 2.0, "Expected ~120 BPM, got {}", r.bpm);
        assert!(r.confidence > 0.3, "Click track should have decent confidence, got {}", r.confidence);
    }

    #[test]
    fn fast_mode_returns_result() {
        let silence = vec![0.0f32; 44100 * 3];
        let r = detect_bpm_fast(&silence, 1, silence.len(), 44100.0, 60.0, 200.0);
        // Should return something without panicking
        assert!(r.bpm >= 0.0);
    }

    #[test]
    fn legacy_api_returns_3_floats() {
        let silence = vec![0.0f32; 44100 * 3];
        let v = detect_bpm_legacy(&silence, 1, silence.len(), 44100.0, 60.0, 200.0);
        assert_eq!(v.len(), 3, "Legacy API should return [bpm, offset, confidence]");
    }

    #[test]
    fn stereo_downmix_works() {
        let sr = 44100;
        let spc = sr * 2; // 2 seconds
        // Stereo planar: L channel then R channel
        let mut stereo = vec![0.0f32; spc * 2];
        // Put a click on L channel only
        stereo[0] = 1.0;
        stereo[sr] = 1.0; // beat at 1s = 60 BPM

        let r = detect_bpm(&stereo, 2, spc, sr as f32, 50.0, 200.0);
        // Should not panic and should process the stereo input
        assert!(r.bpm >= 0.0);
    }
}
