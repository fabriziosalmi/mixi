//! PLL Analysis — Onset correlation, phase cancellation, variable beatgrid.
//!
//! These functions are called from the main thread (not audio thread)
//! at low frequency (every 4–10 seconds). They process short audio chunks
//! (~1 second) and return analysis results.
//!
//! Ported from JavaScript:
//! - onsetCorrelation.ts → cross_correlate_phase()
//! - phaseCancellation.ts → detect_phase_cancellation(), extract_low_freq()
//! - variableBeatgrid.ts → detect_variable_tempo()

use wasm_bindgen::prelude::*;

/// Hop size for onset envelope: 10ms windows.
const HOP_MS: f32 = 10.0;

// ─────────────────────────────────────────────────────────────
// Onset Cross-Correlation
// ─────────────────────────────────────────────────────────────

/// Compute onset flux envelope: RMS in 10ms windows, positive deltas only.
fn compute_onset_flux(samples: &[f32], sample_rate: f32) -> Vec<f32> {
    let hop = (sample_rate * HOP_MS / 1000.0).round() as usize;
    if hop == 0 || samples.is_empty() {
        return Vec::new();
    }
    let num_frames = (samples.len() + hop - 1) / hop;
    let mut flux = Vec::with_capacity(num_frames);
    let mut prev_rms: f32 = 0.0;

    for f in 0..num_frames {
        let start = f * hop;
        let end = (start + hop).min(samples.len());
        let window_len = end - start;
        if window_len == 0 {
            break;
        }
        let sum_sq: f32 = samples[start..end].iter().map(|s| s * s).sum();
        let rms = (sum_sq / window_len as f32).sqrt();
        let delta = rms - prev_rms;
        flux.push(if delta > 0.0 { delta } else { 0.0 });
        prev_rms = rms;
    }
    flux
}

/// Cross-correlate two audio chunks to find phase offset in seconds.
///
/// Returns the offset in seconds, or f64::NAN if correlation is too weak.
/// Positive = slave is behind master.
#[wasm_bindgen]
pub fn cross_correlate_phase(
    master_chunk: &[f32],
    slave_chunk: &[f32],
    sample_rate: f32,
    max_shift_ms: f32,
) -> f64 {
    let master_flux = compute_onset_flux(master_chunk, sample_rate);
    let slave_flux = compute_onset_flux(slave_chunk, sample_rate);

    if master_flux.len() < 4 || slave_flux.len() < 4 {
        return f64::NAN;
    }

    let hop_samples = (sample_rate * HOP_MS / 1000.0).round() as usize;
    let max_shift_frames = (max_shift_ms / HOP_MS).round() as i32;
    let min_len = master_flux.len().min(slave_flux.len());

    // Inner correlation function
    let correlate_at = |shift: i32| -> f64 {
        let mut sum: f64 = 0.0;
        for i in 0..min_len {
            let j = i as i32 + shift;
            if j >= 0 && (j as usize) < slave_flux.len() {
                sum += master_flux[i] as f64 * slave_flux[j as usize] as f64;
            }
        }
        sum
    };

    // Search for best correlation
    let mut best_corr: f64 = f64::NEG_INFINITY;
    let mut best_shift: i32 = 0;

    for shift in -max_shift_frames..=max_shift_frames {
        let corr = correlate_at(shift);
        if corr > best_corr {
            best_corr = corr;
            best_shift = shift;
        }
    }

    // Noise floor reject
    if best_corr < 1e-8 {
        return f64::NAN;
    }

    // Parabolic interpolation for sub-frame precision
    let prev = correlate_at(best_shift - 1);
    let next = correlate_at(best_shift + 1);
    let denom = prev - 2.0 * best_corr + next;
    let refined = if denom.abs() > 1e-12 {
        best_shift as f64 + 0.5 * (prev - next) / denom
    } else {
        best_shift as f64
    };

    // Convert to seconds
    let offset_seconds = (refined * hop_samples as f64) / sample_rate as f64;

    // Reject if outside max range
    if (offset_seconds * 1000.0).abs() > max_shift_ms as f64 {
        return f64::NAN;
    }

    offset_seconds
}

// ─────────────────────────────────────────────────────────────
// Phase Cancellation Detection
// ─────────────────────────────────────────────────────────────

/// Extract low frequencies (~100Hz) using two-pass moving average (zero-phase).
#[wasm_bindgen]
pub fn extract_low_freq(samples: &[f32], sample_rate: f32) -> Vec<f32> {
    let window_size = (sample_rate / 100.0).round().max(4.0) as usize;
    let len = samples.len();
    if len == 0 {
        return Vec::new();
    }

    // Pass 1: Forward moving average
    let mut forward = vec![0.0f32; len];
    let mut sum: f64 = 0.0;
    for i in 0..len {
        sum += samples[i] as f64;
        if i >= window_size {
            sum -= samples[i - window_size] as f64;
        }
        let count = (i + 1).min(window_size);
        forward[i] = (sum / count as f64) as f32;
    }

    // Pass 2: Backward moving average (zero-phase)
    let mut result = vec![0.0f32; len];
    sum = 0.0;
    for i in (0..len).rev() {
        sum += forward[i] as f64;
        let idx = i + window_size;
        if idx < len {
            sum -= forward[idx] as f64;
        }
        let count = (len - i).min(window_size);
        result[i] = (sum / count as f64) as f32;
    }

    result
}

/// Detect destructive phase cancellation between two low-pass filtered chunks.
///
/// Returns true if the combined RMS drops below 60% of the expected
/// uncorrelated sum (indicating destructive interference in the bass).
#[wasm_bindgen]
pub fn detect_phase_cancellation(master_low: &[f32], slave_low: &[f32]) -> bool {
    let len = master_low.len().min(slave_low.len());
    if len < 64 {
        return false;
    }

    let mut sum_m2: f64 = 0.0;
    let mut sum_s2: f64 = 0.0;
    let mut sum_c2: f64 = 0.0;

    for i in 0..len {
        let m = master_low[i] as f64;
        let s = slave_low[i] as f64;
        sum_m2 += m * m;
        sum_s2 += s * s;
        let c = m + s;
        sum_c2 += c * c;
    }

    let rms_m = (sum_m2 / len as f64).sqrt();
    let rms_s = (sum_s2 / len as f64).sqrt();
    let rms_c = (sum_c2 / len as f64).sqrt();

    // Reject weak signals
    if rms_m < 0.005 || rms_s < 0.005 {
        return false;
    }

    // Expected RMS if uncorrelated
    let expected = (rms_m * rms_m + rms_s * rms_s).sqrt();

    // Cancellation if combined drops below 60% of expected
    rms_c < expected * 0.6
}

// ─────────────────────────────────────────────────────────────
// Variable Beatgrid Detection
// ─────────────────────────────────────────────────────────────

/// Estimate local BPM for a chunk using onset envelope + autocorrelation.
fn estimate_local_bpm(data: &[f32], sr: f32, start_sec: f64, end_sec: f64, expected_bpm: f32) -> f32 {
    let i0 = (start_sec * sr as f64).floor().max(0.0) as usize;
    let i1 = (end_sec * sr as f64).ceil().min(data.len() as f64) as usize;

    if i1 <= i0 || (i1 - i0) < (sr * 0.5) as usize {
        return 0.0;
    }

    let chunk = &data[i0..i1];
    let envelope = compute_onset_flux(chunk, sr);

    if envelope.len() < 20 {
        return 0.0;
    }

    // Autocorrelation around expected beat period
    let expected_lag = (60.0 / expected_bpm) / (HOP_MS / 1000.0);
    let search_min = 1.max((expected_lag * 0.85).round() as usize);
    let search_max = (envelope.len() / 2).min((expected_lag * 1.15).round() as usize);

    if search_min >= search_max {
        return 0.0;
    }

    let mut best_corr: f64 = f64::NEG_INFINITY;
    let mut best_lag = expected_lag as usize;

    for lag in search_min..=search_max {
        let mut corr: f64 = 0.0;
        for i in 0..(envelope.len() - lag) {
            corr += envelope[i] as f64 * envelope[i + lag] as f64;
        }
        if corr > best_corr {
            best_corr = corr;
            best_lag = lag;
        }
    }

    let period_ms = best_lag as f32 * HOP_MS;
    if period_ms <= 0.0 {
        return 0.0;
    }

    60000.0 / period_ms
}

/// Detect tempo variations in 16-beat chunks.
///
/// Returns a flat array of (time, beatNum, localBpm) triplets.
/// Empty array = constant tempo, no variation detected.
/// Called from JS: `const markers = detect_variable_tempo(data, sr, bpm, offset, threshold)`
#[wasm_bindgen]
pub fn detect_variable_tempo(
    data: &[f32],
    sample_rate: f32,
    initial_bpm: f32,
    first_beat_offset: f64,
    threshold: f32,
) -> Vec<f32> {
    if initial_bpm <= 0.0 || data.is_empty() {
        return Vec::new();
    }

    let beat_period = 60.0 / initial_bpm as f64;
    let duration = data.len() as f64 / sample_rate as f64;

    // First marker: start position with initial BPM
    let mut markers: Vec<f32> = vec![
        first_beat_offset as f32,
        0.0,
        initial_bpm,
    ];
    let mut has_variation = false;

    let mut chunk_beat = 16u32;
    loop {
        let chunk_start = first_beat_offset + chunk_beat as f64 * beat_period;
        let chunk_end = chunk_start + 16.0 * beat_period;
        if chunk_end > duration {
            break;
        }

        let local_bpm = estimate_local_bpm(data, sample_rate, chunk_start, chunk_end, initial_bpm);
        if local_bpm <= 0.0 {
            chunk_beat += 16;
            continue;
        }

        if (local_bpm - initial_bpm).abs() > threshold {
            has_variation = true;
            markers.push(chunk_start as f32);
            markers.push(chunk_beat as f32);
            markers.push(local_bpm);
        }

        chunk_beat += 16;
    }

    if has_variation { markers } else { Vec::new() }
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn onset_flux_basic() {
        let sr = 44100.0;
        let samples = vec![0.0f32; 4410]; // 100ms of silence
        let flux = compute_onset_flux(&samples, sr);
        assert!(!flux.is_empty());
        assert!(flux.iter().all(|&v| v == 0.0), "Silence should produce zero flux");
    }

    #[test]
    fn cross_correlate_identical_returns_zero() {
        let sr = 44100.0;
        let chunk: Vec<f32> = (0..44100).map(|i| (i as f32 * 0.01).sin()).collect();
        let offset = cross_correlate_phase(&chunk, &chunk, sr, 50.0);
        assert!(!offset.is_nan(), "Identical chunks should correlate");
        assert!((offset * 1000.0).abs() < 5.0, "Identical chunks should have near-zero offset");
    }

    #[test]
    fn phase_cancellation_inverted_signal() {
        let signal: Vec<f32> = (0..4410).map(|i| (i as f32 * 0.1).sin() * 0.5).collect();
        let inverted: Vec<f32> = signal.iter().map(|s| -s).collect();
        // Extract low freq first
        let low_a = extract_low_freq(&signal, 44100.0);
        let low_b = extract_low_freq(&inverted, 44100.0);
        let cancelling = detect_phase_cancellation(&low_a, &low_b);
        assert!(cancelling, "Inverted signal should detect cancellation");
    }

    #[test]
    fn phase_cancellation_same_signal_no_cancel() {
        let signal: Vec<f32> = (0..4410).map(|i| (i as f32 * 0.1).sin() * 0.5).collect();
        let low = extract_low_freq(&signal, 44100.0);
        let cancelling = detect_phase_cancellation(&low, &low);
        assert!(!cancelling, "Same signal should not detect cancellation");
    }

    #[test]
    fn extract_low_freq_reduces_energy() {
        let signal: Vec<f32> = (0..4410).map(|i| (i as f32 * 0.5).sin()).collect();
        let low = extract_low_freq(&signal, 44100.0);
        let rms_orig: f32 = (signal.iter().map(|s| s * s).sum::<f32>() / signal.len() as f32).sqrt();
        let rms_low: f32 = (low.iter().map(|s| s * s).sum::<f32>() / low.len() as f32).sqrt();
        assert!(rms_low < rms_orig, "Low-pass should reduce high-frequency energy");
    }

    #[test]
    fn variable_tempo_constant_returns_empty() {
        // Constant tempo with actual signal — sine wave at constant rate
        let sr = 44100.0;
        let signal: Vec<f32> = (0..(sr as usize * 30))
            .map(|i| ((i as f32 / sr) * 128.0 / 60.0 * std::f32::consts::TAU).sin() * 0.3)
            .collect();
        let result = detect_variable_tempo(&signal, sr, 128.0, 0.0, 0.5);
        // A constant-tempo signal should return empty (no variation detected)
        assert!(result.is_empty(), "Constant tempo should have no variation markers");
    }
}
