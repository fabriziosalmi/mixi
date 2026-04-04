//! BPM & Beatgrid Detection module.
//!
//! Port of `BpmDetector.ts` — detects tempo and grid offset from a
//! bass-filtered audio signal using:
//!   1. Adaptive spectral-flux onset detection
//!   2. Multi-hop IOI histogram with Gaussian smoothing
//!   3. Octave resolution (DJ range preference)
//!   4. Grid alignment refinement + integer BPM snap

use wasm_bindgen::prelude::*;

// ── Constants ──────────────────────────────────────────────────

const ENERGY_WINDOW: usize = 441;     // ~10ms at 44.1kHz
const THRESHOLD_ALPHA: f32 = 1.3;
const AVG_HALF_WINDOW: usize = 10;
const MIN_IOI: f32 = 0.12;            // seconds
const DEFAULT_BPM_MIN: f32 = 65.0;
const DEFAULT_BPM_MAX: f32 = 200.0;
const BIN_RESOLUTION: f32 = 0.25;
const MAX_HOPS: usize = 4;

// ── Internal types ─────────────────────────────────────────────

#[derive(Clone)]
struct Onset {
    time: f32,
    strength: f32,
}

// ── Helpers ────────────────────────────────────────────────────

fn compute_energy(samples: &[f32], window_size: usize) -> Vec<f32> {
    let num_frames = samples.len() / window_size;
    let mut energy = Vec::with_capacity(num_frames);

    for i in 0..num_frames {
        let offset = i * window_size;
        let mut sum: f32 = 0.0;
        for j in 0..window_size {
            let s = samples[offset + j];
            sum += s * s;
        }
        energy.push((sum / window_size as f32).sqrt());
    }
    energy
}

fn detect_onsets(energy: &[f32], sample_rate: f32, window_size: usize) -> Vec<Onset> {
    let mut onsets = Vec::new();
    let min_ioi_frames = ((MIN_IOI * sample_rate) / window_size as f32).ceil() as usize;
    let mut last_onset_frame: isize = -(min_ioi_frames as isize) - 1;

    if energy.len() <= 2 * AVG_HALF_WINDOW {
        return onsets;
    }

    for i in AVG_HALF_WINDOW..(energy.len() - AVG_HALF_WINDOW) {
        let mut sum: f32 = 0.0;
        for j in (i - AVG_HALF_WINDOW)..=(i + AVG_HALF_WINDOW) {
            sum += energy[j];
        }
        let local_mean = sum / (2 * AVG_HALF_WINDOW + 1) as f32;
        let threshold = local_mean * THRESHOLD_ALPHA;

        if energy[i] > threshold && (i as isize - last_onset_frame) >= min_ioi_frames as isize {
            let time_sec = (i * window_size) as f32 / sample_rate;
            let strength = (energy[i] - local_mean).max(0.01);
            onsets.push(Onset { time: time_sec, strength });
            last_onset_frame = i as isize;
        }
    }
    onsets
}

fn estimate_bpm(onsets: &[Onset], bpm_min: f32, bpm_max: f32) -> (f32, f32) {
    if onsets.len() < 4 {
        return (120.0, 0.0);
    }

    let num_bins = ((bpm_max - bpm_min) / BIN_RESOLUTION).ceil() as usize;
    let mut histogram = vec![0.0_f32; num_bins];

    let mut vote_bin = |candidate: f32, weight: f32| {
        if candidate >= bpm_min && candidate <= bpm_max {
            let bin = ((candidate - bpm_min) / BIN_RESOLUTION).round() as usize;
            if bin < num_bins {
                histogram[bin] += weight;
            }
        }
    };

    for hop in 1..=MAX_HOPS {
        let hop_weight = 1.0 / hop as f32;
        for i in hop..onsets.len() {
            let ioi = onsets[i].time - onsets[i - hop].time;
            if ioi <= 0.0 { continue; }

            let single_ioi = ioi / hop as f32;
            let raw_bpm = 60.0 / single_ioi;

            let strength = (onsets[i].strength + onsets[i - hop].strength) * 0.5;
            let weight = strength * hop_weight;

            vote_bin(raw_bpm, weight);
            vote_bin(raw_bpm * 2.0, weight * 0.7);
            vote_bin(raw_bpm / 2.0, weight * 0.7);
        }
    }

    // Gaussian smoothing (σ=2 bins)
    let sigma: f32 = 2.0;
    let kernel_radius: isize = 4;
    let mut smoothed = vec![0.0_f32; num_bins];

    for i in 0..num_bins {
        let mut sum: f32 = 0.0;
        let mut w_sum: f32 = 0.0;
        for k in -kernel_radius..=kernel_radius {
            let j = i as isize + k;
            if j >= 0 && (j as usize) < num_bins {
                let g = (-(k * k) as f32 / (2.0 * sigma * sigma)).exp();
                sum += histogram[j as usize] * g;
                w_sum += g;
            }
        }
        smoothed[i] = sum / w_sum;
    }

    // Find peak bin
    let mut peak_bin: usize = 0;
    let mut peak_val: f32 = 0.0;
    for i in 0..num_bins {
        if smoothed[i] > peak_val {
            peak_val = smoothed[i];
            peak_bin = i;
        }
    }

    // Parabolic interpolation
    let mut bpm = bpm_min + peak_bin as f32 * BIN_RESOLUTION;
    if peak_bin > 0 && peak_bin < num_bins - 1 {
        let y0 = smoothed[peak_bin - 1];
        let y1 = smoothed[peak_bin];
        let y2 = smoothed[peak_bin + 1];
        let denom = y0 - 2.0 * y1 + y2;
        if denom.abs() > 0.001 {
            let delta = 0.5 * (y0 - y2) / denom;
            bpm += delta * BIN_RESOLUTION;
        }
    }

    // Confidence
    let total_votes: f32 = smoothed.iter().sum();
    let confidence = if total_votes > 0.0 { peak_val / total_votes } else { 0.0 };

    (bpm, confidence)
}

fn grid_alignment_score(bpm: f32, onsets: &[Onset]) -> f32 {
    if onsets.len() < 4 { return 0.0; }

    let beat_period = 60.0 / bpm;
    let tolerance = beat_period * 0.12;
    let search_count = onsets.len().min(80);

    let mut best_phase_score: f32 = 0.0;
    let phase_candidates = 12.min(search_count);

    for c in 0..phase_candidates {
        let phase = onsets[c].time;
        let mut score: f32 = 0.0;
        let mut weight_sum: f32 = 0.0;

        for j in 0..search_count {
            let delta = onsets[j].time - phase;
            let beat_frac = (delta / beat_period) % 1.0;
            let beat_frac = if beat_frac < 0.0 { beat_frac + 1.0 } else { beat_frac };
            let dist = beat_frac.min(1.0 - beat_frac) * beat_period;

            let w = onsets[j].strength;
            weight_sum += w;
            if dist < tolerance {
                score += w;
            }
        }

        let normalized_score = if weight_sum > 0.0 { score / weight_sum } else { 0.0 };
        if normalized_score > best_phase_score {
            best_phase_score = normalized_score;
        }
    }

    best_phase_score
}

fn resolve_octave(bpm: f32, onsets: &[Onset], bpm_min: f32, bpm_max: f32) -> f32 {
    let mut candidates = vec![bpm];
    if bpm * 2.0 <= bpm_max { candidates.push(bpm * 2.0); }
    if bpm / 2.0 >= bpm_min { candidates.push(bpm / 2.0); }

    let mut best_bpm = bpm;
    let mut best_score: f32 = -1.0;

    for &candidate in &candidates {
        let score = grid_alignment_score(candidate, onsets);
        let in_dj_range = candidate >= 100.0 && candidate <= 185.0;
        let adjusted = score * if in_dj_range { 1.15 } else { 1.0 };

        if adjusted > best_score {
            best_score = adjusted;
            best_bpm = candidate;
        }
    }
    best_bpm
}

fn refine_bpm(coarse_bpm: f32, onsets: &[Onset], bpm_min: f32, bpm_max: f32) -> f32 {
    if onsets.len() < 8 { return coarse_bpm; }

    let search_radius = 2.5_f32;
    let step = 0.1_f32;
    let mut best_bpm = coarse_bpm;
    let mut best_score: f32 = -1.0;

    let mut candidate = coarse_bpm - search_radius;
    while candidate <= coarse_bpm + search_radius {
        if candidate >= bpm_min && candidate <= bpm_max {
            let score = grid_alignment_score(candidate, onsets);
            if score > best_score {
                best_score = score;
                best_bpm = candidate;
            }
        }
        candidate += step;
    }
    best_bpm
}

fn snap_to_common_bpm(bpm: f32, onsets: &[Onset]) -> f32 {
    let rounded = bpm.round();
    if (bpm - rounded).abs() > 0.5 { return bpm; }

    let score_original = grid_alignment_score(bpm, onsets);
    let score_rounded = grid_alignment_score(rounded, onsets);

    if score_rounded >= score_original * 0.95 {
        rounded
    } else {
        bpm
    }
}

fn find_grid_offset(onsets: &[Onset], bpm: f32) -> f32 {
    if onsets.is_empty() { return 0.0; }

    let beat_period = 60.0 / bpm;
    let tolerance = beat_period * 0.12;
    let search_window = onsets.len().min(80);

    let mut best_offset = onsets[0].time;
    let mut best_score: f32 = 0.0;

    let candidates = search_window.min(20);
    for c in 0..candidates {
        let candidate = onsets[c].time;
        let mut score: f32 = 0.0;

        for j in c..search_window {
            let delta = onsets[j].time - candidate;
            let beat_frac = (delta / beat_period) % 1.0;
            let beat_frac = if beat_frac < 0.0 { beat_frac + 1.0 } else { beat_frac };
            let dist = beat_frac.min(1.0 - beat_frac) * beat_period;
            if dist < tolerance {
                score += onsets[j].strength;
            }
        }

        if score > best_score {
            best_score = score;
            best_offset = candidate;
        }
    }
    best_offset
}

fn mix_to_mono(channels: &[f32], num_channels: usize, samples_per_channel: usize) -> Vec<f32> {
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

/// Detect BPM and beatgrid offset from bass-filtered audio.
///
/// `samples`: concatenated channel data (ch0 ++ ch1 ++ ...)
/// `num_channels`: 1 (mono) or 2 (stereo)
/// `samples_per_channel`: length of one channel
/// `sample_rate`: e.g. 44100.0
/// `bpm_min` / `bpm_max`: search range
///
/// Returns [bpm, firstBeatOffset, confidence] as a 3-element Vec.
#[wasm_bindgen]
pub fn detect_bpm(
    samples: &[f32],
    num_channels: usize,
    samples_per_channel: usize,
    sample_rate: f32,
    bpm_min: f32,
    bpm_max: f32,
) -> Vec<f32> {
    let mono = mix_to_mono(samples, num_channels, samples_per_channel);

    // Step 1: Energy envelope
    let energy = compute_energy(&mono, ENERGY_WINDOW);

    // Step 2: Onset detection
    let onsets = detect_onsets(&energy, sample_rate, ENERGY_WINDOW);

    // Step 3: BPM estimation (multi-hop IOI histogram)
    let (mut bpm, confidence) = estimate_bpm(&onsets, bpm_min, bpm_max);

    // Step 4: Octave resolution
    bpm = resolve_octave(bpm, &onsets, bpm_min, bpm_max);

    // Step 5: Fine refinement
    bpm = refine_bpm(bpm, &onsets, bpm_min, bpm_max);

    // Step 6: Snap to integer BPM
    bpm = snap_to_common_bpm(bpm, &onsets);

    // Round to 1 decimal
    bpm = (bpm * 10.0).round() / 10.0;

    // Step 7: Grid offset
    let first_beat_offset = find_grid_offset(&onsets, bpm);

    vec![bpm, first_beat_offset, confidence]
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_energy() {
        let samples = vec![1.0_f32; 882]; // 2 windows of 441
        let energy = compute_energy(&samples, 441);
        assert_eq!(energy.len(), 2);
        assert!((energy[0] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_mix_to_mono_stereo() {
        let channels = vec![1.0, 1.0, 1.0, 0.0, 0.0, 0.0]; // ch0=[1,1,1], ch1=[0,0,0]
        let mono = mix_to_mono(&channels, 2, 3);
        assert_eq!(mono.len(), 3);
        assert!((mono[0] - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_mix_to_mono_mono() {
        let samples = vec![0.5, 0.5, 0.5];
        let mono = mix_to_mono(&samples, 1, 3);
        assert_eq!(mono.len(), 3);
        assert!((mono[0] - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_detect_bpm_returns_three_values() {
        // Very short signal — should return default BPM
        let samples = vec![0.0_f32; 44100]; // 1 second of silence
        let result = detect_bpm(&samples, 1, 44100, 44100.0, 65.0, 200.0);
        assert_eq!(result.len(), 3);
        assert!(result[0] > 0.0); // BPM > 0
    }

    #[test]
    fn test_detect_bpm_with_clicks() {
        // Create a signal with clicks at 120 BPM (0.5s apart)
        let sr = 44100;
        let duration_secs = 10;
        let total = sr * duration_secs;
        let mut samples = vec![0.0_f32; total];

        let beat_interval = sr / 2; // 0.5s = 120 BPM
        for beat in 0..20 {
            let pos = beat * beat_interval;
            if pos < total {
                // Short click (5 samples)
                for j in 0..5.min(total - pos) {
                    samples[pos + j] = 0.9;
                }
            }
        }

        let result = detect_bpm(&samples, 1, total, sr as f32, 65.0, 200.0);
        assert_eq!(result.len(), 3);
        let bpm = result[0];
        // Should detect something close to 120 BPM
        assert!(bpm >= 110.0 && bpm <= 130.0, "Expected ~120 BPM, got {}", bpm);
    }

    #[test]
    fn test_grid_alignment_score_basic() {
        let onsets: Vec<Onset> = (0..20)
            .map(|i| Onset { time: i as f32 * 0.5, strength: 1.0 })
            .collect();
        let score = grid_alignment_score(120.0, &onsets);
        assert!(score > 0.8, "Perfect 120BPM grid should score high, got {}", score);
    }
}
