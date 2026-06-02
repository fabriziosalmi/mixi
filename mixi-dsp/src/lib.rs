//! # mixi-dsp
//!
//! Lean, **zero-import** WebAssembly build of the Mixi DSP engine, loaded
//! directly by `mixi-dsp-worklet.js` inside the AudioWorklet.
//!
//! ## Why a separate crate?
//!
//! `mixi-core` is built with wasm-bindgen (for BPM/key/waveform analysis on the
//! main thread). wasm-bindgen emits per-build, hashed `__wbindgen_*` imports that
//! an AudioWorklet cannot satisfy — which is why feeding `mixi_core_bg.wasm` to
//! the DSP worklet caused it to fail to instantiate and silently fall back to the
//! slower WebAudio path.
//!
//! This crate compiles the **same** DSP source (`mixi-core/src/dsp`, shared via
//! `#[path]` — no duplication) with **no** wasm-bindgen and a stable, hand-written
//! `extern "C"` ABI (see [`lean_dsp`]). Built with
//! `cargo build --target wasm32-unknown-unknown --release`, the output wasm has
//! zero imports; the worklet instantiates it with `{}` and calls the C ABI.
//!
//! The DSP engine itself ([`dsp::engine::DspEngine`]) is intentionally
//! wasm-bindgen-free so it can be shared between this crate and `mixi-core`.

// The lean build intentionally uses only the engine path of the shared DSP API,
// so analysis-only helpers in the shared source read as dead code here.
#![allow(dead_code)]

// Shared DSP source tree from mixi-core (single source of truth — no copy).
#[path = "../../mixi-core/src/dsp/mod.rs"]
pub mod dsp;

// The AudioWorklet C-ABI boundary.
pub mod lean_dsp;
