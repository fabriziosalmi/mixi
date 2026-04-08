//! Lissajous signal analysis for DVS calibration UI.
//!
//! Analyzes the shape of the L/R Lissajous figure to provide
//! diagnostic information about signal quality:
//!
//!   - Circle → perfect quadrature, clean signal
//!   - Ellipse → phase/gain mismatch between channels
//!   - Line → one channel dead or mono signal
//!   - Noise → no timecode signal

use wasm_bindgen::prelude::*;

/// Signal quality assessment from Lissajous analysis.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum SignalQuality {
    /// Perfect circle — clean quadrature signal, ready to use.
    Excellent = 0,
    /// Slight ellipse — usable but antiskating may need adjustment.
    Good = 1,
    /// Pronounced ellipse — signal level mismatch or phase error.
    Fair = 2,
    /// Collapsed to a line — one channel dead or cables swapped.
    Poor = 3,
    /// Random noise — no timecode signal detected.
    NoSignal = 4,
}

/// Analyze Lissajous figure from L/R sample pairs.
///
/// `points`: flat array [x, y, x, y, ...] where x=L, y=R
///
/// Returns [quality, circularity, gain_balance, signal_level]
///   quality: SignalQuality enum value (0-4)
///   circularity: 0.0 = line, 1.0 = perfect circle
///   gain_balance: 0.0 = R dead (all signal on L), 0.5 = balanced, 1.0 = L dead (all signal on R)
///   signal_level: RMS of the signal (0.0 = silence)
#[wasm_bindgen]
pub fn analyze_lissajous(points: &[f32]) -> Vec<f32> {
    let n = points.len() / 2;
    if n < 10 {
        return vec![SignalQuality::NoSignal as u8 as f32, 0.0, 0.5, 0.0];
    }

    // Compute signal levels per channel
    let mut sum_l2: f64 = 0.0;
    let mut sum_r2: f64 = 0.0;
    let mut sum_lr: f64 = 0.0;

    for i in 0..n {
        let l = points[i * 2] as f64;
        let r = points[i * 2 + 1] as f64;
        sum_l2 += l * l;
        sum_r2 += r * r;
        sum_lr += l * r;
    }

    let rms_l = (sum_l2 / n as f64).sqrt();
    let rms_r = (sum_r2 / n as f64).sqrt();
    let rms_total = ((sum_l2 + sum_r2) / (2.0 * n as f64)).sqrt();

    // No signal?
    if rms_total < 0.005 {
        return vec![SignalQuality::NoSignal as u8 as f32, 0.0, 0.5, rms_total as f32];
    }

    // Gain balance: 0.5 = balanced
    let gain_balance = if rms_l + rms_r > 0.0 {
        rms_r / (rms_l + rms_r)
    } else {
        0.5
    };

    // Circularity: ratio of min/max singular values of the point cloud.
    // For a perfect circle, both singular values are equal → ratio = 1.0.
    // For a line, one is zero → ratio = 0.0.
    //
    // We compute this via the covariance matrix eigenvalues.
    let mean_l = points.iter().step_by(2).map(|&x| x as f64).sum::<f64>() / n as f64;
    let mean_r = points.iter().skip(1).step_by(2).map(|&x| x as f64).sum::<f64>() / n as f64;

    let mut cov_ll: f64 = 0.0;
    let mut cov_rr: f64 = 0.0;
    let mut cov_lr: f64 = 0.0;

    for i in 0..n {
        let dl = points[i * 2] as f64 - mean_l;
        let dr = points[i * 2 + 1] as f64 - mean_r;
        cov_ll += dl * dl;
        cov_rr += dr * dr;
        cov_lr += dl * dr;
    }

    cov_ll /= n as f64;
    cov_rr /= n as f64;
    cov_lr /= n as f64;

    // Eigenvalues of 2×2 covariance matrix:
    // λ = (trace ± sqrt(trace² - 4*det)) / 2
    let trace = cov_ll + cov_rr;
    let det = cov_ll * cov_rr - cov_lr * cov_lr;
    let disc = (trace * trace - 4.0 * det).max(0.0).sqrt();

    let lambda1 = (trace + disc) / 2.0;
    let lambda2 = (trace - disc) / 2.0;

    let circularity = if lambda1 > 1e-12 {
        (lambda2 / lambda1).sqrt().clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Classify quality
    let quality = if circularity > 0.85 && gain_balance > 0.35 && gain_balance < 0.65 {
        SignalQuality::Excellent
    } else if circularity > 0.6 {
        SignalQuality::Good
    } else if circularity > 0.3 {
        SignalQuality::Fair
    } else if rms_total > 0.01 {
        SignalQuality::Poor
    } else {
        SignalQuality::NoSignal
    };

    vec![
        quality as u8 as f32,
        circularity as f32,
        gain_balance as f32,
        rms_total as f32,
    ]
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_circle(n: usize, amplitude: f32) -> Vec<f32> {
        let mut points = Vec::with_capacity(n * 2);
        for i in 0..n {
            let t = i as f32 / n as f32 * std::f32::consts::TAU;
            points.push(t.sin() * amplitude);  // L
            points.push(t.cos() * amplitude);  // R
        }
        points
    }

    fn make_line(n: usize, amplitude: f32) -> Vec<f32> {
        let mut points = Vec::with_capacity(n * 2);
        for i in 0..n {
            let t = i as f32 / n as f32 * std::f32::consts::TAU;
            let v = t.sin() * amplitude;
            points.push(v);  // L
            points.push(v);  // R (same = line at 45°)
        }
        points
    }

    #[test]
    fn test_perfect_circle() {
        let points = make_circle(200, 0.8);
        let result = analyze_lissajous(&points);
        assert_eq!(result[0] as u8, SignalQuality::Excellent as u8);
        assert!(result[1] > 0.85, "Circularity = {}", result[1]);
    }

    #[test]
    fn test_line_signal() {
        let points = make_line(200, 0.8);
        let result = analyze_lissajous(&points);
        assert!(result[1] < 0.2, "Line circularity should be low, got {}", result[1]);
        assert!(result[0] as u8 >= SignalQuality::Fair as u8);
    }

    #[test]
    fn test_silence() {
        let points = vec![0.0f32; 400];
        let result = analyze_lissajous(&points);
        assert_eq!(result[0] as u8, SignalQuality::NoSignal as u8);
    }

    #[test]
    fn test_gain_balance() {
        let mut points = Vec::new();
        for i in 0..100 {
            let t = i as f32 / 100.0 * std::f32::consts::TAU;
            points.push(t.sin() * 0.8);  // L = strong
            points.push(t.cos() * 0.2);  // R = weak
        }
        let result = analyze_lissajous(&points);
        // Gain balance should favor L (< 0.5)
        assert!(result[2] < 0.4, "Gain balance = {}", result[2]);
    }

    #[test]
    fn test_empty_input() {
        let result = analyze_lissajous(&[]);
        assert_eq!(result[0] as u8, SignalQuality::NoSignal as u8);
    }
}
