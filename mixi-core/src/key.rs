//! Musical Key Detection module.
//!
//! Port of `KeyDetector.ts` — detects the musical key using:
//!   1. Goertzel algorithm for pitch-class energy (chromagram)
//!   2. Krumhansl-Kessler key profiles for classification
//!   3. Camelot wheel notation for DJ harmonic mixing

use wasm_bindgen::prelude::*;

// ── Constants ──────────────────────────────────────────────────

const PITCH_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const C2_FREQ: f64 = 65.406;
const OCTAVES: usize = 4;

/// Krumhansl-Kessler major key profile.
const MAJOR_PROFILE: [f64; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
/// Krumhansl-Kessler minor key profile.
const MINOR_PROFILE: [f64; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/// Camelot minor mapping: pitch_class → camelot code.
const CAMELOT_MINOR: [&str; 12] = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];
/// Camelot major mapping: pitch_class → camelot code.
const CAMELOT_MAJOR: [&str; 12] = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];

// ── Helpers ────────────────────────────────────────────────────

fn pitch_freq(pitch_class: usize, octave: usize) -> f64 {
    C2_FREQ * (2.0_f64).powf(pitch_class as f64 / 12.0 + octave as f64)
}

/// Goertzel algorithm: compute energy at a single frequency.
/// O(N) time, O(1) space — much faster than FFT for 48 bins.
fn goertzel_energy(samples: &[f32], start: usize, end: usize, target_freq: f64, sample_rate: f64) -> f64 {
    let n = (end - start) as f64;
    let k = (n * target_freq / sample_rate).round();
    let omega = 2.0 * std::f64::consts::PI * k / n;
    let coeff = 2.0 * omega.cos();

    let mut s1: f64 = 0.0;
    let mut s2: f64 = 0.0;

    for i in start..end {
        let s0 = samples[i] as f64 + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }

    s1 * s1 + s2 * s2 - coeff * s1 * s2
}

/// Pearson correlation coefficient between two slices.
fn pearson_correlation(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len() as f64;
    let (mut sum_a, mut sum_b, mut sum_ab, mut sum_a2, mut sum_b2) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for i in 0..a.len() {
        sum_a += a[i];
        sum_b += b[i];
        sum_ab += a[i] * b[i];
        sum_a2 += a[i] * a[i];
        sum_b2 += b[i] * b[i];
    }
    let num = n * sum_ab - sum_a * sum_b;
    let den = ((n * sum_a2 - sum_a * sum_a) * (n * sum_b2 - sum_b * sum_b)).sqrt();
    if den == 0.0 { 0.0 } else { num / den }
}

/// Rotate a 12-element array by `n` positions.
fn rotate_profile(profile: &[f64; 12], n: usize) -> [f64; 12] {
    let mut result = [0.0; 12];
    let shift = n % 12;
    for i in 0..12 {
        result[i] = profile[(i + 12 - shift) % 12];
    }
    result
}

fn mix_to_mono_f32(channels: &[f32], num_channels: usize, samples_per_channel: usize) -> Vec<f32> {
    if num_channels == 1 {
        return channels[..samples_per_channel].to_vec();
    }
    let mut mono = vec![0.0_f32; samples_per_channel];
    let inv = 1.0 / num_channels as f32;
    for ch in 0..num_channels {
        let offset = ch * samples_per_channel;
        for i in 0..samples_per_channel {
            mono[i] += channels[offset + i] * inv;
        }
    }
    mono
}

// ── Public API ─────────────────────────────────────────────────

/// Detect the musical key of an audio signal.
///
/// `samples`: concatenated channel data (ch0 ++ ch1 ++ ...)
/// `num_channels`: 1 or 2
/// `samples_per_channel`: samples in one channel
/// `sample_rate`: e.g. 44100.0
///
/// Returns a string in the format "camelot|name|confidence"
/// e.g. "8A|Am|0.85"
#[wasm_bindgen]
pub fn detect_key(
    samples: &[f32],
    num_channels: usize,
    samples_per_channel: usize,
    sample_rate: f32,
) -> String {
    let mono = mix_to_mono_f32(samples, num_channels, samples_per_channel);

    // Select analysis window (middle 60 seconds)
    let window_samples = (sample_rate as usize * 60).min(mono.len());
    let start_sample = (mono.len() - window_samples) / 2;
    let end_sample = start_sample + window_samples;
    let sr = sample_rate as f64;

    // Build chromagram
    let mut chroma = [0.0_f64; 12];
    for pc in 0..12 {
        for oct in 0..OCTAVES {
            let freq = pitch_freq(pc, oct);
            if freq > sr / 2.0 { continue; } // Nyquist
            chroma[pc] += goertzel_energy(&mono, start_sample, end_sample, freq, sr);
        }
    }

    // Normalise chromagram
    let max_chroma = chroma.iter().cloned().fold(0.0_f64, f64::max);
    if max_chroma > 0.0 {
        for v in chroma.iter_mut() {
            *v /= max_chroma;
        }
    }

    // Correlate with all 24 key profiles
    let chroma_vec: Vec<f64> = chroma.to_vec();
    let mut best_key: usize = 0;
    let mut best_corr: f64 = f64::NEG_INFINITY;
    let mut best_is_minor = false;

    for root in 0..12 {
        let major = rotate_profile(&MAJOR_PROFILE, root);
        let corr_major = pearson_correlation(&chroma_vec, &major);
        if corr_major > best_corr {
            best_corr = corr_major;
            best_key = root;
            best_is_minor = false;
        }

        let minor = rotate_profile(&MINOR_PROFILE, root);
        let corr_minor = pearson_correlation(&chroma_vec, &minor);
        if corr_minor > best_corr {
            best_corr = corr_minor;
            best_key = root;
            best_is_minor = true;
        }
    }

    let camelot = if best_is_minor { CAMELOT_MINOR[best_key] } else { CAMELOT_MAJOR[best_key] };
    let name = format!("{}{}", PITCH_NAMES[best_key], if best_is_minor { "m" } else { "" });
    let confidence = ((best_corr + 1.0) / 2.0).clamp(0.0, 1.0);

    format!("{}|{}|{:.4}", camelot, name, confidence)
}

/// Check if two Camelot codes are harmonically compatible.
/// Compatible = same number (major/minor switch) or ±1 step on same letter.
#[wasm_bindgen]
pub fn is_harmonic_match(camelot_a: &str, camelot_b: &str) -> bool {
    if camelot_a.is_empty() || camelot_b.is_empty() { return false; }

    let letter_a = &camelot_a[camelot_a.len()-1..];
    let letter_b = &camelot_b[camelot_b.len()-1..];
    let num_a: i32 = camelot_a[..camelot_a.len()-1].parse().unwrap_or(-1);
    let num_b: i32 = camelot_b[..camelot_b.len()-1].parse().unwrap_or(-1);

    if num_a < 0 || num_b < 0 { return false; }

    // Same number → relative major/minor
    if num_a == num_b { return true; }

    // Same letter, ±1 (wrapping 12↔1)
    if letter_a == letter_b {
        let diff = (num_a - num_b).abs();
        return diff == 1 || diff == 11;
    }

    false
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pitch_freq() {
        // A4 = 440 Hz → pitch_class 9, octave 2 (since C2 is base)
        let a4 = pitch_freq(9, 2); // A in octave 2 relative to C2 = A4
        assert!((a4 - 440.0).abs() < 1.0, "A4 should be ~440Hz, got {}", a4);
    }

    #[test]
    fn test_pearson_correlation() {
        let a = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let b = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let corr = pearson_correlation(&a, &b);
        assert!((corr - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_pearson_anticorrelation() {
        let a = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let b = vec![5.0, 4.0, 3.0, 2.0, 1.0];
        let corr = pearson_correlation(&a, &b);
        assert!((corr - (-1.0)).abs() < 0.001);
    }

    #[test]
    fn test_rotate_profile() {
        let profile = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0];
        let rotated = rotate_profile(&profile, 1);
        assert!((rotated[0] - 12.0).abs() < 0.001);
        assert!((rotated[1] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_is_harmonic_match() {
        assert!(is_harmonic_match("8A", "8B"));   // Same number
        assert!(is_harmonic_match("8A", "7A"));   // ±1 same letter
        assert!(is_harmonic_match("8A", "9A"));
        assert!(is_harmonic_match("1A", "12A"));  // Wrap-around
        assert!(!is_harmonic_match("8A", "6A"));  // Too far
        assert!(!is_harmonic_match("8A", "10B")); // Different number and letter
    }

    #[test]
    fn test_detect_key_returns_valid_format() {
        // Silence → should still return a valid format
        let samples = vec![0.0_f32; 44100 * 5];
        let result = detect_key(&samples, 1, 44100 * 5, 44100.0);
        let parts: Vec<&str> = result.split('|').collect();
        assert_eq!(parts.len(), 3, "Should return camelot|name|confidence");
        assert!(parts[0].ends_with('A') || parts[0].ends_with('B'));
    }
}
