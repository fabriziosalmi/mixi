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
    in_a_l: Vec<f32>,
    in_a_r: Vec<f32>,
    in_b_l: Vec<f32>,
    in_b_r: Vec<f32>,
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
        in_a_l: vec![0.0; BUF_CAP],
        in_a_r: vec![0.0; BUF_CAP],
        in_b_l: vec![0.0; BUF_CAP],
        in_b_r: vec![0.0; BUF_CAP],
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
// True stereo: JS writes Deck A (L/R) → in_a_l/in_a_r, Deck B (L/R) → in_b_l/in_b_r,
// the 512-byte param bus → params, calls `dsp_process`, then reads out_l / out_r.

/// # Safety
/// `p` must be a valid handle from [`dsp_engine_new`].
#[no_mangle]
pub extern "C" fn dsp_in_a_l_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_a_l.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_in_a_r_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_a_r.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_in_b_l_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_b_l.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_in_b_r_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_b_r.as_mut_ptr() } }
/// Legacy alias for Deck A Left (`dsp_in_a_l_ptr`).
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_in_l_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_a_l.as_mut_ptr() } }
/// Legacy alias for Deck B Left (`dsp_in_b_l_ptr`).
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_in_r_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).in_b_l.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_out_l_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).out_l.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_out_r_ptr(p: *mut LeanDsp) -> *mut f32 { unsafe { (*p).out_r.as_mut_ptr() } }
/// # Safety
/// See [`dsp_in_a_l_ptr`].
#[no_mangle]
pub extern "C" fn dsp_param_ptr(p: *mut LeanDsp) -> *mut u8 { unsafe { (*p).params.as_mut_ptr() } }

/// Process `len` frames (clamped to `BUF_CAP`) in TRUE STEREO.
/// Reads `in_a_l`/`in_a_r`/`in_b_l`/`in_b_r`/`params`, writes `out_l`/`out_r`.
///
/// # Safety
/// `p` must be a valid handle from [`dsp_engine_new`].
#[no_mangle]
pub extern "C" fn dsp_process(p: *mut LeanDsp, len: u32) {
    let d = unsafe { &mut *p };
    let n = (len as usize).min(BUF_CAP);
    // Disjoint field borrows: the engine reads stereo inputs/params and writes stereo outputs.
    let LeanDsp { engine, in_a_l, in_a_r, in_b_l, in_b_r, out_l, out_r, params } = d;
    engine.process_stereo(
        &in_a_l[..n],
        &in_a_r[..n],
        &in_b_l[..n],
        &in_b_r[..n],
        &mut out_l[..n],
        &mut out_r[..n],
        &params[..],
    );
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
    const PARAM_LAYOUT_VERSION: f32 = 3.0;
    const DECK_TRIM_OFFSET: usize = 0;
    const DECK_FADER_OFFSET: usize = 16;
    const DECK_XFADER_GAIN_OFFSET: usize = 20;
    const MASTER_GAIN_OFFSET: usize = 256;

    /// Drive the full C-ABI path on a known input and assert the output is
    /// finite, actually processed (not layout-mismatch passthrough!), and
    /// deterministic — i.e. the lean wrapper runs the engine and matches a
    /// direct `DspEngine::process` call.
    #[test]
    fn lean_path_processes_and_is_deterministic() {
        let sr = 48_000.0;
        let n = 128usize;

        // Build a sine test tone for deck A.
        let tone: Vec<f32> = (0..n)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / sr).sin() * 0.5)
            .collect();

        // A valid v3 param bus with active deck A and 0.5 master gain so the
        // processed output MUST differ from raw passthrough.
        let mut params = vec![0u8; PARAM_BYTES];
        let write_f32 = |buf: &mut [u8], off: usize, val: f32| {
            buf[off..off + 4].copy_from_slice(&val.to_le_bytes());
        };
        write_f32(&mut params, PARAM_LAYOUT_VERSION_OFFSET, PARAM_LAYOUT_VERSION);
        write_f32(&mut params, DECK_TRIM_OFFSET, 1.0);
        write_f32(&mut params, DECK_FADER_OFFSET, 1.0);
        write_f32(&mut params, DECK_XFADER_GAIN_OFFSET, 1.0);
        write_f32(&mut params, MASTER_GAIN_OFFSET, 0.5);

        // ── Reference: direct DspEngine ────────────────────────────────────
        let mut ref_engine = DspEngine::new(sr);
        let mut r_inl = tone.clone();
        let mut r_inr = vec![0.0f32; n];
        let mut r_outl = vec![0.0f32; n];
        let mut r_outr = vec![0.0f32; n];
        ref_engine.process(&mut r_inl, &mut r_inr, &mut r_outl, &mut r_outr, &params);

        // ── C-ABI path: write to stereo pointers, call dsp_process, read pointers ──
        let p = dsp_engine_new(sr);
        unsafe {
            std::slice::from_raw_parts_mut(dsp_in_a_l_ptr(p), n).copy_from_slice(&tone);
            std::slice::from_raw_parts_mut(dsp_in_a_r_ptr(p), n).copy_from_slice(&tone);
            std::slice::from_raw_parts_mut(dsp_in_b_l_ptr(p), n).fill(0.0);
            std::slice::from_raw_parts_mut(dsp_in_b_r_ptr(p), n).fill(0.0);
            std::slice::from_raw_parts_mut(dsp_param_ptr(p), PARAM_BYTES).copy_from_slice(&params);
        }
        dsp_process(p, n as u32);
        let lean_outl: Vec<f32> =
            unsafe { std::slice::from_raw_parts(dsp_out_l_ptr(p), n).to_vec() };

        // Finite + produced.
        assert!(lean_outl.iter().all(|x| x.is_finite()), "output must be finite");
        assert!(lean_outl.iter().any(|&x| x != 0.0), "engine must produce output");

        // Break-test against passthrough: with SUM_HEADROOM * master_gain(0.5),
        // processed output must measurably differ from the raw input tone.
        let max_diff = lean_outl
            .iter()
            .zip(tone.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            max_diff > 0.05,
            "lean path must actually process audio (not layout-mismatch passthrough), max_diff={max_diff}"
        );

        // Parity with the direct engine (same construction, same input).
        for (a, b) in lean_outl.iter().zip(r_outl.iter()) {
            assert!((a - b).abs() < 1e-6, "lean path must match DspEngine::process");
        }

        dsp_engine_free(p);
    }

    /// SE-01 break-test: true stereo separation. Signal fed ONLY on Deck A Left
    /// must appear on Master Left and remain silent on Master Right (never mono-summed).
    #[test]
    fn lean_path_preserves_true_stereo_separation() {
        let sr = 48_000.0;
        let n = 128usize;
        let tone: Vec<f32> = (0..n)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / sr).sin() * 0.5)
            .collect();

        let mut params = vec![0u8; PARAM_BYTES];
        let write_f32 = |buf: &mut [u8], off: usize, val: f32| {
            buf[off..off + 4].copy_from_slice(&val.to_le_bytes());
        };
        write_f32(&mut params, PARAM_LAYOUT_VERSION_OFFSET, PARAM_LAYOUT_VERSION);
        write_f32(&mut params, DECK_TRIM_OFFSET, 1.0);
        write_f32(&mut params, DECK_FADER_OFFSET, 1.0);
        write_f32(&mut params, DECK_XFADER_GAIN_OFFSET, 1.0);
        write_f32(&mut params, MASTER_GAIN_OFFSET, 1.0);

        let p = dsp_engine_new(sr);
        unsafe {
            std::slice::from_raw_parts_mut(dsp_in_a_l_ptr(p), n).copy_from_slice(&tone);
            std::slice::from_raw_parts_mut(dsp_in_a_r_ptr(p), n).fill(0.0);
            std::slice::from_raw_parts_mut(dsp_in_b_l_ptr(p), n).fill(0.0);
            std::slice::from_raw_parts_mut(dsp_in_b_r_ptr(p), n).fill(0.0);
            std::slice::from_raw_parts_mut(dsp_param_ptr(p), PARAM_BYTES).copy_from_slice(&params);
        }
        dsp_process(p, n as u32);
        let out_l = unsafe { std::slice::from_raw_parts(dsp_out_l_ptr(p), n) };
        let out_r = unsafe { std::slice::from_raw_parts(dsp_out_r_ptr(p), n) };

        let peak_l = out_l.iter().map(|x| x.abs()).fold(0.0f32, f32::max);
        let peak_r = out_r.iter().map(|x| x.abs()).fold(0.0f32, f32::max);
        assert!(peak_l > 0.2, "Left channel must carry Deck A Left signal, peak_l={peak_l}");
        assert!(peak_r < 1e-6, "Right channel must stay silent when only Deck A Left is driven, peak_r={peak_r}");

        dsp_engine_free(p);
    }

    /// SE-03 break-test: ColorFX HPF mode (+1) must pass highs and cut lows
    /// (previously engine.rs always called set_lowpass, muting the track on HPF).
    #[test]
    fn lean_path_color_fx_highpass_works() {
        let sr = 48_000.0;
        let n = 512usize;
        let write_f32 = |buf: &mut [u8], off: usize, val: f32| {
            buf[off..off + 4].copy_from_slice(&val.to_le_bytes());
        };

        let run_sine = |freq_hz: f32, mode: f32, cutoff: f32| -> f32 {
            let tone: Vec<f32> = (0..n)
                .map(|i| (i as f32 * freq_hz * std::f32::consts::TAU / sr).sin() * 0.5)
                .collect();
            let mut params = vec![0u8; PARAM_BYTES];
            write_f32(&mut params, PARAM_LAYOUT_VERSION_OFFSET, PARAM_LAYOUT_VERSION);
            write_f32(&mut params, DECK_TRIM_OFFSET, 1.0);
            write_f32(&mut params, DECK_FADER_OFFSET, 1.0);
            write_f32(&mut params, DECK_XFADER_GAIN_OFFSET, 1.0);
            write_f32(&mut params, MASTER_GAIN_OFFSET, 1.0);
            write_f32(&mut params, 24, cutoff); // DECK_COLOR_FREQ
            write_f32(&mut params, 28, 0.707);  // DECK_COLOR_RES
            write_f32(&mut params, 104, mode);  // DECK_COLOR_MODE

            let p = dsp_engine_new(sr);
            let mut last_rms = 0.0f32;
            for _ in 0..8 {
                unsafe {
                    std::slice::from_raw_parts_mut(dsp_in_a_l_ptr(p), n).copy_from_slice(&tone);
                    std::slice::from_raw_parts_mut(dsp_in_a_r_ptr(p), n).copy_from_slice(&tone);
                    std::slice::from_raw_parts_mut(dsp_param_ptr(p), PARAM_BYTES).copy_from_slice(&params);
                }
                dsp_process(p, n as u32);
                let out_l = unsafe { std::slice::from_raw_parts(dsp_out_l_ptr(p), n) };
                last_rms = (out_l.iter().map(|x| x * x).sum::<f32>() / n as f32).sqrt();
            }
            dsp_engine_free(p);
            last_rms
        };

        // HPF at 2000 Hz: 8 kHz treble passes loudly, 100 Hz bass is heavily attenuated.
        let hpf_high = run_sine(8000.0, 1.0, 2000.0);
        let hpf_low = run_sine(100.0, 1.0, 2000.0);
        assert!(hpf_high > 0.2, "HPF at 2kHz must pass 8kHz treble, rms={hpf_high}");
        assert!(hpf_low < 0.02, "HPF at 2kHz must attenuate 100Hz bass, rms={hpf_low}");
    }
}
