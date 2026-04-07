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
// Linear Regression (PLL drift + predictive phase)
// ─────────────────────────────────────────────────────────────

/// Compute linear regression slope from a sample array.
/// X = index (0..N), Y = values. Returns 0 if < 10 samples.
#[wasm_bindgen]
pub fn linear_regression_slope(samples: &[f32]) -> f32 {
    let n = samples.len();
    if n < 10 { return 0.0; }

    let mut sum_x: f64 = 0.0;
    let mut sum_y: f64 = 0.0;
    let mut sum_xy: f64 = 0.0;
    let mut sum_x2: f64 = 0.0;

    for i in 0..n {
        let x = i as f64;
        let y = samples[i] as f64;
        sum_x += x;
        sum_y += y;
        sum_xy += x * y;
        sum_x2 += x * x;
    }

    let nf = n as f64;
    let denom = nf * sum_x2 - sum_x * sum_x;
    if denom.abs() < 1e-12 { return 0.0; }
    ((nf * sum_xy - sum_x * sum_y) / denom) as f32
}

/// Predictive phase correction: linear regression on a window of deltas,
/// extrapolate ahead, return damped pre-compensation.
///
/// `deltas` — sliding window of phase deltas (max ~20 elements)
/// `prediction_horizon` — how many ticks ahead to predict (default 2)
/// `damping` — fraction of predicted drift to counteract (default 0.5)
///
/// Returns pre-compensation value (negate to apply).
#[wasm_bindgen]
pub fn predictive_phase_correction(deltas: &[f32], prediction_horizon: f32, damping: f32) -> f32 {
    let n = deltas.len();
    if n < 5 { return 0.0; }

    let mut sum_x: f64 = 0.0;
    let mut sum_y: f64 = 0.0;
    let mut sum_xy: f64 = 0.0;
    let mut sum_x2: f64 = 0.0;

    for i in 0..n {
        let x = i as f64;
        let y = deltas[i] as f64;
        sum_x += x;
        sum_y += y;
        sum_xy += x * y;
        sum_x2 += x * x;
    }

    let nf = n as f64;
    let denom = nf * sum_x2 - sum_x * sum_x;
    if denom.abs() < 1e-12 { return 0.0; }

    let slope = (nf * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / nf;

    let predicted = intercept + slope * (nf + prediction_horizon as f64);
    (-predicted * damping as f64) as f32
}

// ─────────────────────────────────────────────────────────────
// Auto-Cue Point Detection
// ─────────────────────────────────────────────────────────────

/// RMS of a window of audio samples (start_sec to end_sec).
fn window_rms(data: &[f32], sr: f32, start_sec: f64, end_sec: f64) -> f32 {
    let i0 = (start_sec * sr as f64).floor().max(0.0) as usize;
    let i1 = (end_sec * sr as f64).ceil().min(data.len() as f64) as usize;
    if i1 <= i0 { return 0.0; }
    let sum: f64 = data[i0..i1].iter().map(|&s| (s as f64) * (s as f64)).sum();
    ((sum / (i1 - i0) as f64).sqrt()) as f32
}

/// Find the optimal auto-cue point (first energetic downbeat).
///
/// Scans the beatgrid for the first beat with energy above -40 dBFS,
/// then snaps to the nearest 4-beat bar boundary.
///
/// Returns cue time in seconds (guaranteed >= 0).
#[wasm_bindgen]
pub fn find_auto_cue_point(
    data: &[f32],
    sample_rate: f32,
    duration: f32,
    bpm: f32,
    first_beat_offset: f64,
) -> f64 {
    if bpm <= 0.0 { return first_beat_offset; }

    let beat_period = 60.0 / bpm as f64;
    let max_scan_beats = 128;
    let silence_threshold: f32 = 0.01; // ~-40 dBFS
    let snap_tolerance: f64 = 0.1; // 100ms

    // Step 1: Find first beat with energy
    let mut raw_cue_beat: i32 = -1;
    let mut raw_cue_time: f64 = -1.0;

    for beat_num in 0..max_scan_beats {
        let beat_time = first_beat_offset + beat_num as f64 * beat_period;
        if beat_time >= duration as f64 { break; }

        let rms = window_rms(data, sample_rate, beat_time - 0.005, beat_time + 0.050);
        if rms > silence_threshold {
            raw_cue_beat = beat_num;
            raw_cue_time = beat_time;
            break;
        }
    }

    if raw_cue_time < 0.0 { return first_beat_offset; }

    // Step 2: Snap to nearest downbeat (bar boundary)
    let nearest_downbeat = ((raw_cue_beat as f64 / 4.0).round() * 4.0) as i32;
    let snapped = first_beat_offset + nearest_downbeat as f64 * beat_period;

    if (raw_cue_time - snapped).abs() < snap_tolerance {
        return snapped.max(0.0);
    }

    // Step 3: Search next 3 downbeats for energy
    let next_down = ((raw_cue_beat as f64 / 4.0).ceil() * 4.0) as i32;
    for attempt in 0..3 {
        let candidate_beat = next_down + attempt * 4;
        let candidate_time = first_beat_offset + candidate_beat as f64 * beat_period;
        if candidate_time >= duration as f64 { break; }

        let rms = window_rms(data, sample_rate, candidate_time - 0.005, candidate_time + 0.050);
        if rms > silence_threshold {
            return candidate_time.max(0.0);
        }
    }

    raw_cue_time.max(0.0)
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
    fn linear_regression_flat_zero_slope() {
        let samples = vec![5.0f32; 20];
        let slope = linear_regression_slope(&samples);
        assert!(slope.abs() < 0.001, "Constant values should have zero slope");
    }

    #[test]
    fn linear_regression_positive_slope() {
        let samples: Vec<f32> = (0..20).map(|i| i as f32 * 2.0).collect();
        let slope = linear_regression_slope(&samples);
        assert!((slope - 2.0).abs() < 0.01, "Slope should be ~2.0, got {slope}");
    }

    #[test]
    fn predictive_phase_insufficient_data() {
        let deltas = vec![0.1, 0.2, 0.3]; // only 3 < 5 minimum
        assert_eq!(predictive_phase_correction(&deltas, 2.0, 0.5), 0.0);
    }

    #[test]
    fn auto_cue_finds_first_beat() {
        let sr = 44100.0;
        let bpm = 120.0;
        let beat_period = 60.0 / bpm as f64;
        let duration = 10.0;
        let len = (sr * duration as f32) as usize;
        let mut data = vec![0.0f32; len];

        // Put a click at beat 4 (first downbeat with energy)
        let beat4_start = (4.0 * beat_period * sr as f64) as usize;
        for i in beat4_start..(beat4_start + 100).min(len) {
            data[i] = 0.5;
        }

        let cue = find_auto_cue_point(&data, sr, duration as f32, bpm, 0.0);
        assert!(cue >= 0.0, "Cue should be non-negative");
        // Should snap to beat 4 (a downbeat)
        let expected = 4.0 * beat_period;
        assert!((cue - expected).abs() < 0.15, "Cue {cue} should be near beat 4 at {expected}");
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
