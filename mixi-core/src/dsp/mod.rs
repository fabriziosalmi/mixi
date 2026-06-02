//! DSP primitives for real-time audio processing.
//!
//! These modules implement the core audio effects that will
//! run inside the AudioWorklet when Wasm DSP is enabled.
//!
//! Each module is a standalone, testable audio processor
//! with no WebAudio dependencies.

pub mod biquad;
pub mod dynamics;
pub mod delay;
pub mod reverb;
pub mod flanger;
pub mod phaser;
pub mod gate;
pub mod waveshaper;
pub mod smoother;
pub mod predictive_limiter;
pub mod pitch_shift;
pub mod spectral_sidechain;
pub mod engine;

/// Flush a subnormal (or NaN/Inf) float to zero.
///
/// Subnormals cost ~100× a normal op on most CPUs and Wasm exposes no
/// flush-to-zero mode, so recursive filter state must be cleaned explicitly:
/// once a signal decays into the subnormal range, an IIR filter's feedback
/// keeps it there and pins the audio thread for as long as the deck stays
/// silent. NaN/Inf are flushed too — a single one would otherwise poison a
/// feedback path permanently (self-healing).
#[inline(always)]
pub(crate) fn flush_denorm(x: f32) -> f32 {
    if x.is_normal() { x } else { 0.0 }
}
