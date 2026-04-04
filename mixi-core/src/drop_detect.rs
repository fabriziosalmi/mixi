//! Drop detection — finds "drop" positions by energy-jump analysis.
//!
//! A "drop" in electronic music is a sudden large increase in
//! low-frequency energy following a breakdown/buildup section.
//!
//! Algorithm:
//!   1. Extract low-band energy from the waveform (every 3rd value
//!      in the interleaved [low, mid, high, low, mid, high, ...] array).
//!   2. Smooth with a 4-beat sliding window (running sum, O(n)).
//!   3. Compute the first derivative (energy jump per beat).
//!   4. Find positive peaks exceeding mean + 1.5*stddev.
//!   5. Filter to phrase boundaries (beat mod 16 < 2 or > 14).
//!   6. Snap to nearest 16-beat phrase, deduplicate.
//!   7. Return sorted by strength (biggest jump first).

use wasm_bindgen::prelude::*;

/// Points per second in the waveform data (must match JS POINTS_PER_SECOND).
const PPS: f32 = 100.0;

/// Detect drop positions from interleaved waveform data.
///
/// # Arguments
/// * `waveform_low` — Low-band energy values (one per waveform point).
/// * `bpm` — Detected BPM.
/// * `first_beat_offset` — Beatgrid offset in seconds.
///
/// # Returns
/// Flat `Vec<f64>` of `[beat, strength, beat, strength, ...]` pairs,
/// sorted by strength descending. Max 16 drops returned.
#[wasm_bindgen]
pub fn detect_drops(waveform_low: &[f32], bpm: f32, first_beat_offset: f32) -> Vec<f64> {
    let n = waveform_low.len();
    if bpm <= 0.0 || n < (PPS as usize) * 4 {
        return vec![];
    }

    let beat_period = 60.0 / bpm;
    let samples_per_beat = (beat_period * PPS).round() as usize;
    if samples_per_beat == 0 {
        return vec![];
    }

    // ── 1. Smooth with a 4-beat sliding window ─────────────────
    // O(n) running-sum approach.

    let window_size = samples_per_beat * 4;
    let half_window = window_size / 2;
    let mut smoothed = vec![0.0f32; n];

    // Seed running sum for position 0.
    let w_end_0 = half_window.min(n - 1);
    let mut running_sum: f32 = waveform_low[..=w_end_0].iter().sum();
    let mut prev_start = 0usize;
    let mut prev_end = w_end_0;
    smoothed[0] = running_sum / (prev_end - prev_start + 1) as f32;

    // Slide the window.
    for i in 1..n {
        let w_start = if i > half_window { i - half_window } else { 0 };
        let w_end = (i + half_window).min(n - 1);

        if w_end > prev_end {
            running_sum += waveform_low[w_end];
        }
        if w_start > prev_start {
            running_sum -= waveform_low[prev_start];
        }

        let count = (w_end - w_start + 1) as f32;
        smoothed[i] = running_sum / count;
        prev_start = w_start;
        prev_end = w_end;
    }

    // ── 2. First derivative (energy jump per beat) ─────────────
    let mut derivative = vec![0.0f32; n];
    for i in samples_per_beat..n {
        derivative[i] = smoothed[i] - smoothed[i - samples_per_beat];
    }

    // ── 3. Threshold: mean + 1.5 * stddev of positive derivatives
    let mut sum_d: f64 = 0.0;
    let mut sum_d_sq: f64 = 0.0;
    let mut pos_count: u32 = 0;
    for &d in &derivative {
        if d > 0.0 {
            let d64 = d as f64;
            sum_d += d64;
            sum_d_sq += d64 * d64;
            pos_count += 1;
        }
    }
    let mean_d = if pos_count > 0 { sum_d / pos_count as f64 } else { 0.0 };
    let variance = if pos_count > 0 {
        (sum_d_sq / pos_count as f64 - mean_d * mean_d).max(0.0)
    } else {
        0.0
    };
    let std_d = variance.sqrt();
    let threshold = (mean_d + 1.5 * std_d) as f32;

    // ── 4. Find peaks above threshold ──────────────────────────
    struct Candidate {
        beat: f64,
        strength: f32,
    }
    let mut candidates: Vec<Candidate> = Vec::new();

    let search_start = samples_per_beat * 2;
    let search_end = if n > samples_per_beat { n - samples_per_beat } else { n };

    for i in search_start..search_end {
        if derivative[i] <= threshold {
            continue;
        }

        // Local maximum check (within +/- 1 beat).
        let check_start = if i > samples_per_beat { i - samples_per_beat } else { 0 };
        let check_end = (i + samples_per_beat).min(n - 1);
        let mut is_max = true;
        for j in check_start..=check_end {
            if j != i && derivative[j] > derivative[i] {
                is_max = false;
                break;
            }
        }
        if !is_max {
            continue;
        }

        // Convert sample index to beat number.
        let time_sec = i as f64 / PPS as f64;
        let beat = (time_sec - first_beat_offset as f64) / beat_period as f64;

        // ── 5. Phrase boundary filter ──────────────────────────
        let beat_in_phrase = ((beat % 16.0) + 16.0) % 16.0;
        if beat_in_phrase > 2.0 && beat_in_phrase < 14.0 {
            continue;
        }

        // Snap to nearest phrase boundary.
        let snapped_beat = (beat / 16.0).round() * 16.0;

        // Deduplicate: skip if too close to an existing candidate.
        let too_close = candidates
            .iter()
            .any(|c| (c.beat - snapped_beat).abs() < 16.0);
        if too_close {
            continue;
        }

        candidates.push(Candidate {
            beat: snapped_beat,
            strength: derivative[i],
        });
    }

    // ── 6. Normalise strengths to 0–1 ──────────────────────────
    let max_strength = candidates
        .iter()
        .map(|c| c.strength)
        .fold(0.0f32, f32::max);
    if max_strength > 0.0 {
        for c in &mut candidates {
            c.strength /= max_strength;
        }
    }

    // ── 7. Sort by strength descending, limit to 16 ────────────
    candidates.sort_by(|a, b| b.strength.partial_cmp(&a.strength).unwrap());
    candidates.truncate(16);

    // Return flat array: [beat, strength, beat, strength, ...]
    let mut result = Vec::with_capacity(candidates.len() * 2);
    for c in &candidates {
        result.push(c.beat);
        result.push(c.strength as f64);
    }
    result
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_input() {
        assert!(detect_drops(&[], 120.0, 0.0).is_empty());
    }

    #[test]
    fn test_short_input() {
        // Less than 4 seconds of data → no drops
        let short = vec![0.5; 300]; // 3 seconds at PPS=100
        assert!(detect_drops(&short, 120.0, 0.0).is_empty());
    }

    #[test]
    fn test_zero_bpm() {
        let data = vec![0.5; 1000];
        assert!(detect_drops(&data, 0.0, 0.0).is_empty());
    }

    #[test]
    fn test_flat_signal_no_drops() {
        // Constant energy → no derivative peaks → no drops
        let flat = vec![0.5; 5000]; // 50 seconds
        let result = detect_drops(&flat, 120.0, 0.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_synthetic_drop() {
        // Simulate a realistic energy profile:
        //   0-20s: intro (medium energy 0.3)
        //  20-28s: breakdown (low energy 0.05)
        //  28-32s: buildup (ramp 0.05 → 0.2)
        //  32-60s: drop (high energy 0.9)
        //
        // At 120 BPM: beat_period=0.5s, samples_per_beat=50
        // Beat 64 = second 32 = phrase boundary (64/16 = 4)
        let n = 6000; // 60 seconds at PPS=100
        let mut data = vec![0.0f32; n];

        for i in 0..2000 { data[i] = 0.3; }        // intro: 0-20s
        for i in 2000..2800 { data[i] = 0.05; }     // breakdown: 20-28s
        for i in 2800..3200 {                         // buildup: 28-32s
            let t = (i - 2800) as f32 / 400.0;
            data[i] = 0.05 + t * 0.15;
        }
        for i in 3200..n { data[i] = 0.9; }          // drop: 32-60s

        let result = detect_drops(&data, 120.0, 0.0);
        eprintln!("Synthetic drops: {} values = {:?}", result.len(), result);
        // Should detect at least one drop
        assert!(result.len() >= 2, "Expected at least 1 drop, got {} values", result.len());
        assert!(result.len() % 2 == 0, "Result should be pairs");
        // The main drop should be near beat 64 (phrase boundary)
        let beat = result[0];
        assert_eq!(beat % 16.0, 0.0, "Drop beat {} should be on phrase boundary", beat);
    }

    #[test]
    fn test_output_format() {
        // Even if no drops, format should have pairs
        let n = 6000;
        let mut data = vec![0.1f32; n];
        for i in 3200..n { data[i] = 0.9; }
        let result = detect_drops(&data, 120.0, 0.0);
        assert!(result.len() % 2 == 0, "Output must be beat/strength pairs");
    }

    #[test]
    fn test_strength_normalised() {
        let n = 6000;
        let mut data = vec![0.1f32; n];
        for i in 3200..n { data[i] = 0.9; }
        let result = detect_drops(&data, 120.0, 0.0);
        // All strengths should be 0–1
        for i in (1..result.len()).step_by(2) {
            assert!(result[i] >= 0.0 && result[i] <= 1.0,
                "Strength {} out of range", result[i]);
        }
    }
}
