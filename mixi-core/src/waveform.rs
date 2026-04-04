//! Waveform analysis module — RMS computation, normalization, peak detection.
//!
//! These functions replace the hot inner loops of `WaveformAnalyzer.ts`.
//! The OfflineAudioContext band-separation stays in JS (browser API),
//! but the number-crunching over millions of samples runs in Rust.

use wasm_bindgen::prelude::*;

/// Compute windowed RMS energy for an interleaved audio buffer.
///
/// `samples`: raw float samples from one AudioBuffer channel
/// `chunk_size`: samples per window (sampleRate / POINTS_PER_SECOND)
///
/// Returns a Float32Array of RMS values, one per window.
#[wasm_bindgen]
pub fn compute_rms(samples: &[f32], chunk_size: usize) -> Vec<f32> {
    if samples.is_empty() || chunk_size == 0 {
        return Vec::new();
    }
    let num_chunks = (samples.len() + chunk_size - 1) / chunk_size;
    let mut rms = Vec::with_capacity(num_chunks);

    for i in 0..num_chunks {
        let start = i * chunk_size;
        let end = (start + chunk_size).min(samples.len());
        let count = (end - start) as f32;

        let mut sum_sq: f32 = 0.0;
        for s in &samples[start..end] {
            sum_sq += s * s;
        }
        rms.push((sum_sq / count).sqrt());
    }

    rms
}

/// Compute windowed RMS for multi-channel audio.
///
/// `channels`: flat array of all channel data concatenated
/// `num_channels`: number of audio channels (1 = mono, 2 = stereo)
/// `samples_per_channel`: total samples in one channel
/// `chunk_size`: window size in samples
///
/// This avoids multiple Wasm calls — pass all channels at once.
#[wasm_bindgen]
pub fn compute_rms_multichannel(
    channels: &[f32],
    num_channels: usize,
    samples_per_channel: usize,
    chunk_size: usize,
) -> Vec<f32> {
    if channels.is_empty() || chunk_size == 0 || num_channels == 0 {
        return Vec::new();
    }
    let num_chunks = (samples_per_channel + chunk_size - 1) / chunk_size;
    let mut rms = Vec::with_capacity(num_chunks);

    for i in 0..num_chunks {
        let start = i * chunk_size;
        let end = (start + chunk_size).min(samples_per_channel);
        let count = ((end - start) * num_channels) as f32;

        let mut sum_sq: f32 = 0.0;
        for ch in 0..num_channels {
            let ch_offset = ch * samples_per_channel;
            for s in start..end {
                let sample = channels[ch_offset + s];
                sum_sq += sample * sample;
            }
        }
        rms.push((sum_sq / count).sqrt());
    }

    rms
}

/// Normalise a Float32Array in-place so the peak value equals 1.0.
/// Returns the original peak value (needed for auto-gain).
#[wasm_bindgen]
pub fn normalise(data: &mut [f32]) -> f32 {
    let mut peak: f32 = 0.0;
    for &v in data.iter() {
        if v > peak {
            peak = v;
        }
    }
    if peak > 0.0 {
        let inv = 1.0 / peak;
        for v in data.iter_mut() {
            *v *= inv;
        }
    }
    peak
}

/// Scan all channels for the absolute peak sample value.
///
/// `channels`: flat array of all channel data concatenated
/// `num_channels`: number of channels
/// `samples_per_channel`: samples in one channel
///
/// Returns the peak absolute value (0.0–1.0+).
#[wasm_bindgen]
pub fn peak_level(
    channels: &[f32],
    num_channels: usize,
    samples_per_channel: usize,
) -> f32 {
    if channels.is_empty() || num_channels == 0 {
        return 1.0;
    }
    let mut peak: f32 = 0.0;
    for ch in 0..num_channels {
        let offset = ch * samples_per_channel;
        let end = (offset + samples_per_channel).min(channels.len());
        for &s in &channels[offset..end] {
            let abs = s.abs();
            if abs > peak {
                peak = abs;
            }
        }
    }
    if peak == 0.0 { 1.0 } else { peak }
}

/// Build the interleaved WaveformPoint[] data from 3 normalized
/// RMS arrays (low, mid, high). Returns a flat f32 array where
/// every 3 consecutive values are [low, mid, high] for one point.
///
/// This avoids creating JS objects from Rust — the JS side
/// reconstructs WaveformPoint[] from the flat array.
#[wasm_bindgen]
pub fn build_waveform(low: &[f32], mid: &[f32], high: &[f32]) -> Vec<f32> {
    let len = low.len().min(mid.len()).min(high.len());
    let mut out = Vec::with_capacity(len * 3);
    for i in 0..len {
        out.push(low[i]);
        out.push(mid[i]);
        out.push(high[i]);
    }
    out
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_rms_basic() {
        let samples = vec![1.0, 1.0, 1.0, 1.0];
        let rms = compute_rms(&samples, 4);
        assert_eq!(rms.len(), 1);
        assert!((rms[0] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_compute_rms_multiple_chunks() {
        let samples = vec![1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0];
        let rms = compute_rms(&samples, 4);
        assert_eq!(rms.len(), 2);
        // First chunk: [1,1,0,0] → RMS = sqrt(2/4) = 0.707
        assert!((rms[0] - 0.7071).abs() < 0.01);
        assert!((rms[1] - 0.7071).abs() < 0.01);
    }

    #[test]
    fn test_compute_rms_empty() {
        assert!(compute_rms(&[], 4).is_empty());
        assert!(compute_rms(&[1.0], 0).is_empty());
    }

    #[test]
    fn test_compute_rms_multichannel() {
        // 2 channels, 4 samples each: [1,1,1,1, 0,0,0,0]
        let channels = vec![1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0];
        let rms = compute_rms_multichannel(&channels, 2, 4, 4);
        assert_eq!(rms.len(), 1);
        // Mixed: (4×1.0² + 4×0.0²) / 8 = 0.5, sqrt ≈ 0.707
        assert!((rms[0] - 0.7071).abs() < 0.01);
    }

    #[test]
    fn test_normalise() {
        let mut data = vec![0.0, 0.25, 0.5, 0.75, 1.0];
        let peak = normalise(&mut data);
        assert!((peak - 1.0).abs() < 0.001);
        assert!((data[4] - 1.0).abs() < 0.001);

        let mut data2 = vec![0.0, 0.1, 0.2, 0.5];
        let peak2 = normalise(&mut data2);
        assert!((peak2 - 0.5).abs() < 0.001);
        assert!((data2[3] - 1.0).abs() < 0.001);
        assert!((data2[1] - 0.2).abs() < 0.001);
    }

    #[test]
    fn test_peak_level() {
        let channels = vec![0.1, 0.5, -0.3, 0.2, -0.8, 0.4, 0.1, 0.0];
        let peak = peak_level(&channels, 2, 4);
        assert!((peak - 0.8).abs() < 0.001);
    }

    #[test]
    fn test_peak_level_empty() {
        assert!((peak_level(&[], 0, 0) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_build_waveform() {
        let low = vec![0.1, 0.2, 0.3];
        let mid = vec![0.4, 0.5, 0.6];
        let high = vec![0.7, 0.8, 0.9];
        let flat = build_waveform(&low, &mid, &high);
        assert_eq!(flat.len(), 9);
        assert!((flat[0] - 0.1).abs() < 0.001); // point 0 low
        assert!((flat[1] - 0.4).abs() < 0.001); // point 0 mid
        assert!((flat[2] - 0.7).abs() < 0.001); // point 0 high
        assert!((flat[6] - 0.3).abs() < 0.001); // point 2 low
    }
}
