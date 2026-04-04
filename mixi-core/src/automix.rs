//! AutoMix computation module — beat math, phase alignment, DJ metrics.
//!
//! This module provides the pure math functions used by the AutoMix
//! AI system. The orchestration (tick timer, Zustand store, React)
//! stays in JS, but the number-crunching runs in Rust.
//!
//! ## Architecture
//!
//! The AutoMix system uses a Utility AI pattern:
//!   1. Blackboard: sensor fusion (this module's domain)
//!   2. Intent evaluation: scored 0.0–1.0 per intent
//!   3. Arbitration: sort + domain locking
//!   4. Execution: mutate Zustand store
//!
//! Steps 1 (blackboard math) and part of 2 (pure scoring functions)
//! are ported to Rust. Steps 3-4 stay in JS (store access).

use wasm_bindgen::prelude::*;

// ── Beat Math Utilities ────────────────────────────────────────

/// Convert a time position (seconds) to a beat number on the grid.
/// beat = (time - gridOffset) / (60 / bpm)
#[wasm_bindgen]
pub fn time_to_beat(time: f64, bpm: f64, grid_offset: f64) -> f64 {
    if bpm <= 0.0 { return 0.0; }
    let beat_period = 60.0 / bpm;
    (time - grid_offset) / beat_period
}

/// Convert a beat number back to seconds.
/// time = gridOffset + beat * (60 / bpm)
#[wasm_bindgen]
pub fn beat_to_time(beat: f64, bpm: f64, grid_offset: f64) -> f64 {
    let beat_period = 60.0 / bpm;
    grid_offset + beat * beat_period
}

/// Snap a beat number to the nearest phrase boundary (default 16 beats).
#[wasm_bindgen]
pub fn snap_to_phrase(beat: f64, phrase_length: f64) -> f64 {
    (beat / phrase_length).round() * phrase_length
}

/// Calculate the mix-out beat: last phrase boundary minus one phrase.
/// This is where the AI should start transitioning to the next track.
#[wasm_bindgen]
pub fn calc_mix_out_beat(duration: f64, bpm: f64, grid_offset: f64, phrase_length: f64) -> f64 {
    if bpm <= 0.0 || duration <= 0.0 { return f64::INFINITY; }
    let total_beats = time_to_beat(duration, bpm, grid_offset);
    let last_phrase = (total_beats / phrase_length).floor() * phrase_length;
    (last_phrase - phrase_length).max(0.0)
}

/// Linear interpolation: 0–1 representing progress from start to end.
#[wasm_bindgen]
pub fn lerp_progress(current: f64, start: f64, end: f64) -> f64 {
    if end <= start { return 1.0; }
    ((current - start) / (end - start)).clamp(0.0, 1.0)
}

// ── Phase Alignment ────────────────────────────────────────────

/// Compute phase alignment between two beatgrids.
///
/// Returns [phaseDeltaMs, isAligned] as a 2-element array.
/// - phaseDeltaMs: signed phase error in milliseconds
///   (positive = incoming behind master, negative = ahead)
/// - isAligned: 1.0 if within 50ms tolerance, 0.0 otherwise
///
/// Both decks must be playing with valid BPM for meaningful results.
#[wasm_bindgen]
pub fn compute_phase_alignment(
    master_beat: f64,
    incoming_beat: f64,
    master_beat_period: f64,
) -> Vec<f64> {
    let fract_a = ((master_beat % 1.0) + 1.0) % 1.0;
    let fract_b = ((incoming_beat % 1.0) + 1.0) % 1.0;

    let mut signed_delta = fract_a - fract_b;
    if signed_delta > 0.5 { signed_delta -= 1.0; }
    if signed_delta < -0.5 { signed_delta += 1.0; }

    let abs_delta = signed_delta.abs();
    let phase_delta_ms = signed_delta * master_beat_period * 1000.0;
    let is_aligned = if abs_delta * master_beat_period < 0.05 { 1.0 } else { 0.0 };

    vec![phase_delta_ms, is_aligned]
}

// ── Blackboard Computation ─────────────────────────────────────

/// Compute all derived blackboard metrics from raw deck state.
///
/// Input: flat f64 array with raw deck data:
///   [0]  master_time        [8]  incoming_time
///   [1]  master_bpm         [9]  incoming_bpm
///   [2]  master_offset      [10] incoming_offset
///   [3]  master_duration    [11] incoming_eq_low
///   [4]  master_volume      [12] incoming_volume
///   [5]  master_eq_low      [13] incoming_color_fx
///   [6]  master_eq_mid      [14] incoming_eq_mid
///   [7]  master_color_fx    [15] crossfader
///   [16] master_is_playing (1.0 or 0.0)
///   [17] incoming_is_playing (1.0 or 0.0)
///
/// Output: flat f64 array with derived metrics:
///   [0]  masterBeat
///   [1]  masterTotalBeats
///   [2]  mixOutBeat
///   [3]  beatsToOutro
///   [4]  beatsToEnd
///   [5]  incomingBeat
///   [6]  phaseDeltaMs
///   [7]  isPhaseAligned (1.0 / 0.0)
///   [8]  bassClash (1.0 / 0.0)
///   [9]  midClash (1.0 / 0.0)
///   [10] masterBeatInPhrase
///   [11] masterBeatsToPhrase
///   [12] incomingBeatInPhrase
///   [13] masterOnDownbeat (1.0 / 0.0)
///   [14] isBlending (1.0 / 0.0)
///   [15] incomingBassKilled (1.0 / 0.0)
///   [16] masterBassKilled (1.0 / 0.0)
///   [17] masterHasFilter (1.0 / 0.0)
///   [18] deadAirImminent (1.0 / 0.0)
///   [19] masterBeatPeriod
#[wasm_bindgen]
pub fn compute_blackboard(raw: &[f64]) -> Vec<f64> {
    if raw.len() < 18 {
        return vec![0.0; 20];
    }

    let master_time = raw[0];
    let master_bpm = if raw[1] > 0.0 { raw[1] } else { 120.0 };
    let master_offset = raw[2];
    let master_duration = raw[3];
    let master_volume = raw[4];
    let master_eq_low = raw[5];
    let master_eq_mid = raw[6];
    let master_color_fx = raw[7];
    let incoming_time = raw[8];
    let incoming_bpm = if raw[9] > 0.0 { raw[9] } else { 120.0 };
    let incoming_offset = raw[10];
    let incoming_eq_low = raw[11];
    let incoming_volume = raw[12];
    let _incoming_color_fx = raw[13];
    let incoming_eq_mid = raw[14];
    let _crossfader = raw[15];
    let master_playing = raw[16] > 0.5;
    let incoming_playing = raw[17] > 0.5;

    let master_beat_period = 60.0 / master_bpm;

    // Beat calculations
    let master_beat = time_to_beat(master_time, master_bpm, master_offset);
    let master_total_beats = time_to_beat(master_duration, master_bpm, master_offset);
    let mix_out_beat = calc_mix_out_beat(master_duration, master_bpm, master_offset, 16.0);
    let beats_to_outro = mix_out_beat - master_beat;
    let beats_to_end = master_total_beats - master_beat;
    let incoming_beat = time_to_beat(incoming_time, incoming_bpm, incoming_offset);

    // Phase alignment
    let both_playing = master_playing && incoming_playing;
    let (phase_delta_ms, is_phase_aligned) = if both_playing && raw[1] > 0.0 && raw[9] > 0.0 {
        let result = compute_phase_alignment(master_beat, incoming_beat, master_beat_period);
        (result[0], result[1])
    } else {
        (0.0, 0.0)
    };

    // Clash detection
    let bass_clash = both_playing && master_eq_low > -10.0 && incoming_eq_low > -10.0;
    let mid_clash = both_playing && master_eq_mid > -6.0 && incoming_eq_mid > -6.0;

    // Rhythmic position
    let master_beat_in_phrase = ((master_beat % 16.0) + 16.0) % 16.0;
    let master_beats_to_phrase = 16.0 - master_beat_in_phrase;
    let incoming_beat_in_phrase = ((incoming_beat % 16.0) + 16.0) % 16.0;
    let master_on_downbeat = ((master_beat % 4.0) + 4.0) % 4.0 < 0.5;

    // Volume/energy state
    let is_blending = both_playing && master_volume > 0.5 && incoming_volume > 0.5;
    let incoming_bass_killed = incoming_eq_low < -15.0;
    let master_bass_killed = master_eq_low < -15.0;
    let master_has_filter = master_color_fx.abs() > 0.3;

    // Dead air detection
    let dead_air_imminent = master_playing && beats_to_end < 8.0 && beats_to_end > 0.0;

    vec![
        master_beat,                                    // [0]
        master_total_beats,                             // [1]
        mix_out_beat,                                   // [2]
        beats_to_outro,                                 // [3]
        beats_to_end,                                   // [4]
        incoming_beat,                                  // [5]
        phase_delta_ms,                                 // [6]
        is_phase_aligned,                               // [7]
        if bass_clash { 1.0 } else { 0.0 },           // [8]
        if mid_clash { 1.0 } else { 0.0 },            // [9]
        master_beat_in_phrase,                          // [10]
        master_beats_to_phrase,                         // [11]
        incoming_beat_in_phrase,                        // [12]
        if master_on_downbeat { 1.0 } else { 0.0 },   // [13]
        if is_blending { 1.0 } else { 0.0 },          // [14]
        if incoming_bass_killed { 1.0 } else { 0.0 },  // [15]
        if master_bass_killed { 1.0 } else { 0.0 },    // [16]
        if master_has_filter { 1.0 } else { 0.0 },     // [17]
        if dead_air_imminent { 1.0 } else { 0.0 },     // [18]
        master_beat_period,                              // [19]
    ]
}

// ── Intent Scoring Helpers ─────────────────────────────────────

/// Compute urgency curve for "time to event" scenarios.
/// Returns 0.0 when far away, ramps to 1.0 as beats_remaining → 0.
/// Uses a smooth cosine curve for natural urgency feel.
#[wasm_bindgen]
pub fn urgency_curve(beats_remaining: f64, ramp_beats: f64) -> f64 {
    if beats_remaining <= 0.0 { return 1.0; }
    if beats_remaining >= ramp_beats { return 0.0; }
    let t = 1.0 - (beats_remaining / ramp_beats);
    // Smooth cosine ramp: 0 → 1
    0.5 * (1.0 - (t * std::f64::consts::PI).cos())
}

/// Score for bass-swap timing: returns >0 when conditions favor swapping.
/// Higher score when:
///   - Both decks playing (blending)
///   - Master beat is near a phrase boundary
///   - Bass clash exists
#[wasm_bindgen]
pub fn score_bass_swap(
    is_blending: bool,
    bass_clash: bool,
    master_beats_to_phrase: f64,
    incoming_bass_killed: bool,
) -> f64 {
    if !is_blending { return 0.0; }
    if !bass_clash { return 0.0; }
    if incoming_bass_killed { return 0.0; } // already handled

    // Score peaks at phrase boundary (last 2 beats of phrase)
    let phrase_urgency = if master_beats_to_phrase <= 2.0 {
        1.0 - (master_beats_to_phrase / 2.0)
    } else {
        0.0
    };

    0.6 + 0.4 * phrase_urgency
}

/// Dead air prevention score.
/// Returns high urgency when track is about to end without transition.
#[wasm_bindgen]
pub fn score_dead_air(beats_to_end: f64, incoming_is_ready: bool) -> f64 {
    if beats_to_end <= 0.0 || beats_to_end > 32.0 { return 0.0; }
    if !incoming_is_ready { return 0.0; }

    if beats_to_end < 8.0 {
        // Emergency: 0.9–1.0
        0.9 + 0.1 * (1.0 - beats_to_end / 8.0)
    } else if beats_to_end < 16.0 {
        // Warning: 0.5–0.9
        0.5 + 0.4 * (1.0 - (beats_to_end - 8.0) / 8.0)
    } else {
        // Low urgency: 0.0–0.5
        0.5 * (1.0 - (beats_to_end - 16.0) / 16.0)
    }
}

/// Phase drift correction score.
/// Returns >0 when phase delta exceeds acceptable jitter.
#[wasm_bindgen]
pub fn score_phase_correction(
    both_playing: bool,
    phase_delta_ms: f64,
    is_phase_aligned: bool,
) -> f64 {
    if !both_playing { return 0.0; }
    if is_phase_aligned { return 0.0; }

    let abs_delta = phase_delta_ms.abs();
    if abs_delta < 15.0 { return 0.0; } // Within acceptable jitter

    // Ramp from 0.3 at 15ms to 0.95 at 50ms+
    let t = ((abs_delta - 15.0) / 35.0).clamp(0.0, 1.0);
    0.3 + 0.65 * t
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_to_beat() {
        // At 120 BPM, 1 beat = 0.5s. Time 1.0s = beat 2.0
        let beat = time_to_beat(1.0, 120.0, 0.0);
        assert!((beat - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_time_to_beat_with_offset() {
        // Grid starts at 0.1s. Time 0.6s → (0.6-0.1)/0.5 = beat 1.0
        let beat = time_to_beat(0.6, 120.0, 0.1);
        assert!((beat - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_beat_to_time() {
        let time = beat_to_time(4.0, 120.0, 0.0);
        assert!((time - 2.0).abs() < 0.001); // 4 beats at 120BPM = 2s
    }

    #[test]
    fn test_snap_to_phrase() {
        assert!((snap_to_phrase(15.5, 16.0) - 16.0).abs() < 0.001);
        assert!((snap_to_phrase(7.5, 16.0) - 0.0).abs() < 0.001);
        assert!((snap_to_phrase(8.5, 16.0) - 16.0).abs() < 0.001);
    }

    #[test]
    fn test_calc_mix_out_beat() {
        // 300s track at 170 BPM, grid at 0.0
        // totalBeats = 300 * 170/60 = 850
        // lastPhrase = floor(850/16)*16 = 848
        // mixOut = 848 - 16 = 832
        let mix_out = calc_mix_out_beat(300.0, 170.0, 0.0, 16.0);
        assert!((mix_out - 832.0).abs() < 0.1);
    }

    #[test]
    fn test_lerp_progress() {
        assert!((lerp_progress(0.0, 0.0, 10.0) - 0.0).abs() < 0.001);
        assert!((lerp_progress(5.0, 0.0, 10.0) - 0.5).abs() < 0.001);
        assert!((lerp_progress(10.0, 0.0, 10.0) - 1.0).abs() < 0.001);
        assert!((lerp_progress(15.0, 0.0, 10.0) - 1.0).abs() < 0.001); // clamped
        assert!((lerp_progress(-5.0, 0.0, 10.0) - 0.0).abs() < 0.001); // clamped
    }

    #[test]
    fn test_phase_alignment_perfect() {
        let result = compute_phase_alignment(4.0, 4.0, 0.5);
        assert!(result[0].abs() < 1.0); // near zero phase delta
        assert!((result[1] - 1.0).abs() < 0.001); // aligned
    }

    #[test]
    fn test_phase_alignment_offset() {
        // Master at beat 4.0, incoming at beat 4.3 → 0.3 beat offset
        let result = compute_phase_alignment(4.0, 4.3, 0.5);
        assert!(result[0].abs() > 10.0); // significant delta
        assert!((result[1] - 0.0).abs() < 0.001); // not aligned
    }

    #[test]
    fn test_compute_blackboard() {
        // Create raw data for two decks at 120 BPM
        let raw = vec![
            1.0,    // [0] master_time
            120.0,  // [1] master_bpm
            0.0,    // [2] master_offset
            300.0,  // [3] master_duration
            0.8,    // [4] master_volume
            0.0,    // [5] master_eq_low
            0.0,    // [6] master_eq_mid
            0.0,    // [7] master_color_fx
            0.5,    // [8] incoming_time
            120.0,  // [9] incoming_bpm
            0.0,    // [10] incoming_offset
            -20.0,  // [11] incoming_eq_low (killed)
            0.3,    // [12] incoming_volume
            0.0,    // [13] incoming_color_fx
            0.0,    // [14] incoming_eq_mid
            0.5,    // [15] crossfader
            1.0,    // [16] master_playing
            1.0,    // [17] incoming_playing
        ];
        let bb = compute_blackboard(&raw);
        assert_eq!(bb.len(), 20);
        // master_beat at 1.0s, 120BPM = beat 2.0
        assert!((bb[0] - 2.0).abs() < 0.001);
        // incoming_bass_killed should be true (eq_low = -20)
        assert!((bb[15] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_urgency_curve() {
        assert!((urgency_curve(0.0, 16.0) - 1.0).abs() < 0.001);
        assert!((urgency_curve(16.0, 16.0) - 0.0).abs() < 0.001);
        assert!((urgency_curve(32.0, 16.0) - 0.0).abs() < 0.001);
        // Mid-point should be ~0.5
        let mid = urgency_curve(8.0, 16.0);
        assert!(mid > 0.4 && mid < 0.6, "Mid urgency = {}", mid);
    }

    #[test]
    fn test_score_dead_air() {
        // Far from end → 0
        assert!(score_dead_air(100.0, true) == 0.0);
        // Very close → high
        let emergency = score_dead_air(4.0, true);
        assert!(emergency > 0.9);
        // No incoming track → 0
        assert!(score_dead_air(4.0, false) == 0.0);
    }

    #[test]
    fn test_score_phase_correction() {
        // Aligned → 0
        assert!(score_phase_correction(true, 5.0, true) == 0.0);
        // Small drift → 0
        assert!(score_phase_correction(true, 10.0, false) == 0.0);
        // Significant drift → > 0
        let score = score_phase_correction(true, 30.0, false);
        assert!(score > 0.3);
        // Not playing → 0
        assert!(score_phase_correction(false, 50.0, false) == 0.0);
    }

    #[test]
    fn test_score_bass_swap() {
        // Full conditions, right at phrase boundary → high score
        let score = score_bass_swap(true, true, 0.5, false);
        assert!(score > 0.8, "Expected > 0.8, got {}", score);
        // No blend → 0
        assert!(score_bass_swap(false, true, 1.0, false) == 0.0);
        // Bass already killed → 0
        assert!(score_bass_swap(true, true, 1.0, true) == 0.0);
    }
}
