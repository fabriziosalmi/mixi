//! Lean C-ABI DSP exports for the AudioWorklet.
//!
//! Compiled (with `--no-default-features --features lean-dsp`) into a dedicated,
//! **zero-import** wasm — no wasm-bindgen, no js-sys — that `mixi-dsp-worklet.js`
//! loads directly from bytes. The engine owns its I/O buffers; JS writes the deck
//! inputs and the param bus to the exposed pointers, calls [`dsp_process`], then
//! reads the output pointers.
//!
//! This replaces the old `DspEngine::processRaw` path, which pulled in
//! `wasm_bindgen::memory()` (and therefore per-build hashed wasm-bindgen imports)
//! that the worklet could not satisfy — causing it to time out and fall back to
//! the WebAudio path. With a stable `extern "C"` ABI and owned buffers there are
//! no imports, no hashed names, and no raw-pointer bounds games.

use crate::dsp::engine::DspEngine;

/// Maximum frames per `dsp_process` call. The AudioWorklet quantum is 128; we
/// allocate a generous fixed capacity so `len` can never exceed the buffers.
const BUF_CAP: usize = 1024;
/// Param-bus size in bytes — must match `PARAM_BUS_SIZE` in `ParamLayout.ts`.
const PARAM_BYTES: usize = 512;

/// A DSP engine plus its pre-allocated, JS-visible I/O buffers.
///
/// Buffers are allocated once at construction (zero per-block allocation), which
/// keeps the audio thread deterministic.
pub struct LeanDsp {
    engine: DspEngine,
    in_l: Vec<f32>,
    in_r: Vec<f32>,
    out_l: Vec<f32>,
    out_r: Vec<f32>,
    params: Vec<u8>,
}

/// Create a DSP engine. Returns an opaque handle used by the other functions.
/// Free it with [`dsp_engine_free`].
#[no_mangle]
pub extern "C" fn dsp_engine_new(sample_rate: f32) -> *mut LeanDsp {
    let boxed = Box::new(LeanDsp {
        engine: DspEngine::new(sample_rate),
        in_l: vec![0.0; BUF_CAP],
        in_r: vec![0.0; BUF_CAP],
        out_l: vec![0.0; BUF_CAP],
        out_r: vec![0.0; BUF_CAP],
        params: vec![0u8; PARAM_BYTES],
    });
    Box::into_raw(boxed)
}

/// Free an engine created by [`dsp_engine_new`].
///
/// # Safety
/// `ptr` must be a handle returned by [`dsp_engine_new`] and not used afterwards.
#[no_mangle]
pub extern "C" fn dsp_engine_free(ptr: *mut LeanDsp) {
    if !ptr.is_null() {
        unsafe { drop(Box::from_raw(ptr)); }
    }
}

// ── Buffer pointer accessors (byte offsets into wasm linear memory) ──────────
// JS writes deck A → in_l, deck B → in_r, the 512-byte param bus → params, then
// reads out_l / out_r after `dsp_process`.

/// # Safety
/// `p` must be a valid handle from [`dsp_engine_new`].
#[no_mangle]
pub extern "C" fn dsp_in_l_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_l.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_in_r_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_r.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_out_l_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).out_l.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_out_r_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).out_r.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_param_ptr(p: *mut LeanDsp) -> *mut u8 { unsafe { (*p).params.as_mut_ptr() } }

/// Process `len` frames (clamped to `BUF_CAP`). Reads `in_l`/`in_r`/`params`,
/// writes `out_l`/`out_r`.
///
/// # Safety
/// `p` must be a valid handle from [`dsp_engine_new`].
#[no_mangle]
pub extern "C" fn dsp_process(p: *mut LeanDsp, len: u32) {
    let d = unsafe { &mut *p };
    let n = (len as usize).min(BUF_CAP);
    // Disjoint field borrows: the engine reads inputs/params and writes outputs.
    let LeanDsp { engine, in_l, in_r, out_l, out_r, params } = d;
    engine.process(&mut in_l[..n], &mut in_r[..n], &mut out_l[..n], &mut out_r[..n], &params[..]);
}

/// Reset all DSP state (e.g. on track change).
///
/// # Safety
/// `p` must be a valid handle from [`dsp_engine_new`].
#[no_mangle]
pub extern "C" fn dsp_engine_reset(p: *mut LeanDsp) {
    unsafe { (*p).engine.reset(); }
}

/// Current limiter gain reduction in dB (for metering). 0.0 when idle.
///
/// # Safety
/// `p` must be a valid handle from [`dsp_engine_new`].
#[no_mangle]
pub extern "C" fn dsp_limiter_gr(p: *mut LeanDsp) -> f32 {
    unsafe { (*p).engine.get_limiter_gain_reduction() }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Param-layout version field (must match engine.rs / ParamLayout.ts).
    const PARAM_LAYOUT_VERSION_OFFSET: usize = 508;

    /// Drive the full C-ABI path on a known input and assert the output is
    /// finite, produced, and deterministic — i.e. the lean wrapper actually runs
    /// the engine and matches a direct `DspEngine::process` call.
    #[test]
    fn lean_path_processes_and_is_deterministic() {
        let sr = 48_000.0;
        let n = 128usize;

        // Build a sine test tone for deck A.
        let tone: Vec<f32> = (0..n)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / sr).sin() * 0.5)
            .collect();

        // A valid param bus: version=2, rest zero (engines treat 0 as neutral).
        let mut params = vec![0u8; PARAM_BYTES];
        params[PARAM_LAYOUT_VERSION_OFFSET..PARAM_LAYOUT_VERSION_OFFSET + 4]
            .copy_from_slice(&2.0f32.to_le_bytes());

        // ── Reference: direct DspEngine ────────────────────────────────────
        let mut ref_engine = DspEngine::new(sr);
        let mut r_inl = tone.clone();
        let mut r_inr = vec![0.0f32; n];
        let mut r_outl = vec![0.0f32; n];
        let mut r_outr = vec![0.0f32; n];
        ref_engine.process(&mut r_inl, &mut r_inr, &mut r_outl, &mut r_outr, &params);

        // ── C-ABI path: write to pointers, call dsp_process, read pointers ──
        let p = dsp_engine_new(sr);
        unsafe {
            std::slice::from_raw_parts_mut(dsp_in_l_ptr(p), n).copy_from_slice(&tone);
            std::slice::from_raw_parts_mut(dsp_in_r_ptr(p), n).fill(0.0);
            std::slice::from_raw_parts_mut(dsp_param_ptr(p), PARAM_BYTES).copy_from_slice(&params);
        }
        dsp_process(p, n as u32);
        let lean_outl: Vec<f32> =
            unsafe { std::slice::from_raw_parts(dsp_out_l_ptr(p), n).to_vec() };

        // Finite + produced.
        assert!(lean_outl.iter().all(|x| x.is_finite()), "output must be finite");
        assert!(lean_outl.iter().any(|&x| x != 0.0), "engine must produce output");

        // Parity with the direct engine (same construction, same input).
        for (a, b) in lean_outl.iter().zip(r_outl.iter()) {
            assert!((a - b).abs() < 1e-6, "lean path must match DspEngine::process");
        }

        dsp_engine_free(p);
    }
}
