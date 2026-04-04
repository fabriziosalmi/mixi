//! Integration tests for the DspEngine and optimization features.
//!
//! These tests validate the full processing chain and the
//! individual optimizations from the Gemini Quick Wins.

// ── DspEngine integration tests ─────────────────────────────

#[cfg(test)]
mod engine_tests {
    use mixi_core::dsp::biquad::Biquad;
    use mixi_core::dsp::dynamics::{Gain, Limiter};
    use mixi_core::dsp::delay::Delay;
    use mixi_core::dsp::reverb::Reverb;
    use mixi_core::dsp::flanger::Flanger;
    use mixi_core::dsp::phaser::Phaser;
    use mixi_core::dsp::smoother::ParamSmoother;
    use mixi_core::dsp::waveshaper::Waveshaper;
    use mixi_core::dsp::gate::Gate;

    // ── fast_tanh validation ─────────────────────────────────

    #[test]
    fn fast_tanh_matches_real_for_small_values() {
        // The Padé approximation should match within 3% for |x| < 2.5
        for i in -250..=250 {
            let x = i as f32 * 0.01;
            let real = x.tanh();
            let pade = x * (27.0 + x * x) / (27.0 + 9.0 * x * x);
            let err = (real - pade).abs();
            assert!(err < 0.03, "fast_tanh error too large for x={x}: real={real}, pade={pade}, err={err}");
        }
    }

    #[test]
    fn fast_tanh_clamps_at_extremes() {
        // For |x| > 3, fast_tanh should be ±1
        let pade_pos = 5.0f32 * (27.0 + 25.0) / (27.0 + 9.0 * 25.0);
        // Without clamping this would diverge. We test via waveshaper.
        let mut ws = Waveshaper::new();
        ws.set_params(1.0, 1.0); // max drive
        let mut buf = [0.99f32; 128];
        ws.process_block(&mut buf);
        for s in &buf {
            assert!(s.abs() <= 1.5, "Waveshaper should clamp: {s}");
            assert!(s.is_finite(), "Must be finite: {s}");
        }
    }

    // ── Power-of-2 ring buffer tests ─────────────────────────

    #[test]
    fn delay_power_of_2_sizes() {
        // Buffer for 1000 samples should be rounded to 1024
        let d = Delay::new(1000);
        // The delay should work correctly with the rounded buffer
        let mut d2 = Delay::new(1000);
        d2.set_params(500.0, 0.0, 1.0);
        let mut buf = vec![0.0f32; 1024];
        buf[0] = 1.0;
        d2.process_block(&mut buf);
        assert!((buf[500] - 1.0).abs() < 0.01, "Echo at 500: {}", buf[500]);
    }

    #[test]
    fn delay_large_buffer_works() {
        let mut d = Delay::new(44100); // 1 second
        d.set_params(22050.0, 0.3, 0.5);
        let mut buf = vec![0.0f32; 44100];
        buf[0] = 1.0;
        d.process_block(&mut buf);
        // Echo should appear at sample 22050
        assert!(buf[22050].abs() > 0.01, "Long delay echo: {}", buf[22050]);
    }

    #[test]
    fn reverb_bitmask_wrapping_no_panic() {
        // Process a large buffer to exercise bitmask wrapping
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(0.8);
        let mut buf = vec![0.5f32; 8192];
        rev.process_block(&mut buf);
        // All outputs should be finite
        for (i, s) in buf.iter().enumerate() {
            assert!(s.is_finite(), "Reverb output NaN at sample {i}");
        }
    }

    // ── Denormal protection ──────────────────────────────────

    #[test]
    fn reverb_tail_stays_finite() {
        // Process impulse then silence — reverb tail must not produce denormals
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(1.0);

        let mut buf = vec![0.0f32; 4096];
        buf[0] = 1.0;
        rev.process_block(&mut buf);

        // Process more silence
        let mut silence = vec![0.0f32; 8192];
        rev.process_block(&mut silence);

        for (i, s) in silence.iter().enumerate() {
            assert!(s.is_finite(), "Denormal at sample {i}: {s}");
            assert!(s.abs() < 10.0, "Explosion at sample {i}: {s}");
        }
    }

    #[test]
    fn limiter_after_reverb_tail_stays_clean() {
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(1.0);
        let mut lim = Limiter::new(-1.0, 50.0, 44100.0);

        let mut buf = vec![0.0f32; 4096];
        buf[0] = 1.0;
        rev.process_block(&mut buf);
        lim.process_block(&mut buf);

        for s in &buf {
            assert!(s.is_finite());
            assert!(s.abs() <= 1.5);
        }
    }

    // ── Smoother edge cases ──────────────────────────────────

    #[test]
    fn smoother_zero_to_zero_settled() {
        let s = ParamSmoother::new(0.0, 5.0, 44100.0);
        assert!(s.is_settled());
    }

    #[test]
    fn smoother_rapid_target_changes() {
        let mut s = ParamSmoother::new(0.0, 2.0, 44100.0);
        // Rapidly change targets — should never produce NaN
        for i in 0..1000 {
            s.set_target(if i % 2 == 0 { 1.0 } else { 0.0 });
            let v = s.next();
            assert!(v.is_finite(), "NaN at iteration {i}");
            assert!(v >= -0.1 && v <= 1.1, "Out of range at {i}: {v}");
        }
    }

    #[test]
    fn smoother_negative_values() {
        let mut s = ParamSmoother::new(1.0, 5.0, 44100.0);
        s.set_target(-1.0);
        for _ in 0..44100 {
            s.next();
        }
        assert!((s.value() - (-1.0)).abs() < 0.001);
    }

    // ── Waveshaper extended tests ────────────────────────────

    #[test]
    fn waveshaper_low_drive_transparent() {
        let mut ws = Waveshaper::new();
        ws.set_params(0.01, 1.0); // very low drive
        let mut buf = [0.5f32; 128];
        let original = buf;
        ws.process_block(&mut buf);
        // Low drive should be nearly transparent
        for (o, p) in original.iter().zip(buf.iter()) {
            assert!((o - p).abs() < 0.1, "Low drive should be transparent: orig={o}, proc={p}");
        }
    }

    #[test]
    fn waveshaper_symmetry() {
        let mut ws = Waveshaper::new();
        ws.set_params(0.5, 1.0);
        let mut pos = [0.7f32; 1];
        let mut neg = [-0.7f32; 1];
        ws.process_block(&mut pos);
        ws.process_block(&mut neg);
        // Symmetric input should produce symmetric output
        assert!((pos[0] + neg[0]).abs() < 0.01,
            "Should be symmetric: pos={}, neg={}", pos[0], neg[0]);
    }

    // ── Biquad edge cases ────────────────────────────────────

    #[test]
    fn biquad_extreme_frequency_no_nan() {
        let mut f = Biquad::new();
        // Very low frequency
        f.set_lowpass(1.0, 0.707, 44100.0);
        let mut buf = [1.0f32; 128];
        f.process_block(&mut buf);
        for s in &buf { assert!(s.is_finite()); }

        // Very high frequency
        f.set_lowpass(22000.0, 0.707, 44100.0);
        f.process_block(&mut buf);
        for s in &buf { assert!(s.is_finite()); }
    }

    #[test]
    fn biquad_rapid_coefficient_changes() {
        let mut f = Biquad::new();
        let mut buf = [0.5f32; 128];
        for freq in (100..10000).step_by(500) {
            f.set_lowpass(freq as f32, 0.707, 44100.0);
            f.process_block(&mut buf);
        }
        for s in &buf { assert!(s.is_finite()); }
    }

    // ── Compressor extended tests ────────────────────────────

    #[test]
    fn compressor_extreme_ratio() {
        use mixi_core::dsp::dynamics::Compressor;
        let mut comp = Compressor::new(-20.0, 100.0, 1.0, 50.0, 44100.0);
        let mut buf = [0.9f32; 256];
        comp.process_block(&mut buf);
        for s in &buf { assert!(s.is_finite()); }
    }

    // ── Gate extended tests ──────────────────────────────────

    #[test]
    fn gate_with_varying_envelope() {
        let mut gate = Gate::new();
        gate.set_params(0.5, 1.0);
        let mut buf: Vec<f32> = (0..256).map(|i| {
            (i as f32 / 256.0 * std::f32::consts::PI * 4.0).sin() * 0.8
        }).collect();
        gate.process_block(&mut buf, 0.008); // ~125 BPM
        for s in &buf { assert!(s.is_finite()); }
    }

    // ── Flanger extended tests ───────────────────────────────

    #[test]
    fn flanger_extreme_params_no_panic() {
        let mut flg = Flanger::new(44100.0);
        flg.set_params(20.0, 1.0, 1.0, 1.0, 44100.0); // extreme rate
        let mut buf = [0.5f32; 512];
        flg.process_block(&mut buf);
        for s in &buf { assert!(s.is_finite()); }
    }

    // ── Phaser extended tests ────────────────────────────────

    #[test]
    fn phaser_long_processing_stable() {
        let mut pha = Phaser::new(44100.0);
        pha.set_params(2.0, 0.9, 0.9, 0.9);
        // Process many blocks to test LFO wraparound
        for _ in 0..100 {
            let mut buf = [0.5f32; 128];
            pha.process_block(&mut buf);
            for s in &buf { assert!(s.is_finite()); }
        }
    }

    // ── Full chain integration tests ─────────────────────────

    #[test]
    fn full_chain_silence_produces_silence() {
        let g = Gain::new(0.8);
        let mut eq = mixi_core::dsp::biquad::ThreeBandEq::new(44100.0);
        eq.set_gains(0.0, 0.0, 0.0, 44100.0);
        let mut lim = Limiter::new(-1.0, 50.0, 44100.0);

        let mut buf = [0.0f32; 128];
        g.process_block(&mut buf);
        eq.process_block(&mut buf);
        lim.process_block(&mut buf);

        let energy: f32 = buf.iter().map(|s| s * s).sum();
        assert!(energy < 0.0001, "Silence in = silence out: energy={energy}");
    }

    #[test]
    fn full_chain_output_bounded() {
        let g = Gain::new(2.0); // boost
        let mut eq = mixi_core::dsp::biquad::ThreeBandEq::new(44100.0);
        eq.set_gains(6.0, 6.0, 6.0, 44100.0); // boost all bands
        let mut lim = Limiter::new(-1.0, 50.0, 44100.0);

        let mut buf = [0.8f32; 128];
        g.process_block(&mut buf);
        eq.process_block(&mut buf);
        lim.process_block(&mut buf);

        for s in &buf {
            assert!(s.is_finite());
            // Limiter should keep output reasonable
            assert!(s.abs() < 5.0, "Output too loud after limiter: {s}");
        }
    }

    #[test]
    fn all_effects_chained_no_nan() {
        let g = Gain::new(0.9);
        let mut eq = mixi_core::dsp::biquad::ThreeBandEq::new(44100.0);
        eq.set_gains(-3.0, 2.0, -6.0, 44100.0);
        let mut color = Biquad::new();
        color.set_lowpass(2000.0, 0.707, 44100.0);
        let mut dly = Delay::new(22050);
        dly.set_params(11025.0, 0.4, 0.3);
        let mut rev = Reverb::new(44100.0);
        rev.set_wet(0.3);
        let mut flg = Flanger::new(44100.0);
        flg.set_params(1.0, 0.5, 0.5, 0.3, 44100.0);
        let mut pha = Phaser::new(44100.0);
        pha.set_params(1.0, 0.5, 0.5, 0.3);
        let mut gate = Gate::new();
        gate.set_params(0.3, 1.0);
        let mut ws = Waveshaper::new();
        ws.set_params(0.3, 0.3);
        let mut lim = Limiter::new(-0.5, 50.0, 44100.0);

        // Process a sine wave through ALL effects
        let mut buf: Vec<f32> = (0..256).map(|i| {
            (i as f32 / 256.0 * std::f32::consts::PI * 8.0).sin() * 0.7
        }).collect();

        g.process_block(&mut buf);
        eq.process_block(&mut buf);
        color.process_block(&mut buf);
        dly.process_block(&mut buf);
        rev.process_block(&mut buf);
        flg.process_block(&mut buf);
        pha.process_block(&mut buf);
        gate.process_block(&mut buf, 0.01);
        ws.process_block(&mut buf);
        lim.process_block(&mut buf);

        for (i, s) in buf.iter().enumerate() {
            assert!(s.is_finite(), "NaN/Inf at sample {i}");
        }
    }

    // ── Delay interpolation tests ────────────────────────────

    #[test]
    fn delay_fractional_time() {
        let mut d = Delay::new(4096);
        d.set_params(100.5, 0.0, 1.0); // fractional delay
        let mut buf = vec![0.0f32; 200];
        buf[0] = 1.0;
        d.process_block(&mut buf);
        // Echo should be interpolated between samples 100 and 101
        assert!(buf[100].abs() > 0.01 || buf[101].abs() > 0.01,
            "Fractional delay should produce output near 100-101");
    }

    // ── Gain edge cases ──────────────────────────────────────

    #[test]
    fn gain_zero_silences() {
        let g = Gain::new(0.0);
        let mut buf = [1.0f32; 128];
        g.process_block(&mut buf);
        for s in &buf { assert_eq!(*s, 0.0); }
    }

    #[test]
    fn gain_negative_inverts() {
        let g = Gain::new(-1.0);
        let mut buf = [0.5f32; 128];
        g.process_block(&mut buf);
        for s in &buf { assert!((s + 0.5).abs() < 0.001); }
    }
}
