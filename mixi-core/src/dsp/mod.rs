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
pub mod engine;
