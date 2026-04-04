//! DSP Benchmark Suite
//!
//! Measures processing throughput for all DSP modules at realistic
//! block sizes (128 samples = one AudioWorklet quantum at 44.1kHz).
//!
//! Run: cargo test --release bench_ -- --nocapture
//!
//! Results are in nanoseconds per sample, microseconds per block,
//! and estimated CPU load percentage.

use std::time::Instant;

// ── Import all DSP modules ─────────────────────────────────
use mixi_core::dsp::biquad::{Biquad, ThreeBandEq};
use mixi_core::dsp::dynamics::{Gain, Limiter, Compressor};
use mixi_core::dsp::delay::Delay;
use mixi_core::dsp::reverb::Reverb;
use mixi_core::dsp::flanger::Flanger;
use mixi_core::dsp::phaser::Phaser;
use mixi_core::dsp::gate::Gate;
use mixi_core::dsp::waveshaper::Waveshaper;

const SR: f32 = 44100.0;
const BLOCK_SIZE: usize = 128;
const ITERATIONS: usize = 10_000;

/// Time budget for one 128-sample block at 44.1kHz (in microseconds).
const BUDGET_US: f64 = (BLOCK_SIZE as f64 / SR as f64) * 1_000_000.0; // ~2902 µs

struct BenchResult {
    name: &'static str,
    ns_per_sample: f64,
    us_per_block: f64,
    cpu_pct: f64,
}

fn bench<F: FnMut(&mut [f32])>(name: &'static str, mut process: F) -> BenchResult {
    // Warm up
    let mut buf = [0.5f32; BLOCK_SIZE];
    for _ in 0..100 {
        process(&mut buf);
    }

    // Measure
    let mut total_ns: u128 = 0;
    for _ in 0..ITERATIONS {
        let mut buf = [0.5f32; BLOCK_SIZE];
        let start = Instant::now();
        process(&mut buf);
        total_ns += start.elapsed().as_nanos();
    }

    let total_samples = ITERATIONS * BLOCK_SIZE;
    let ns_per_sample = total_ns as f64 / total_samples as f64;
    let us_per_block = ns_per_sample * BLOCK_SIZE as f64 / 1000.0;
    let cpu_pct = (us_per_block / BUDGET_US) * 100.0;

    BenchResult { name, ns_per_sample, us_per_block, cpu_pct }
}

fn print_results(results: &[BenchResult]) {
    println!();
    println!("╔══════════════════════════════════════════════════════════════════╗");
    println!("║           Mixi DSP Benchmark (128 samples @ 44.1kHz)           ║");
    println!("║              {} iterations per test                         ║", ITERATIONS);
    println!("║     Budget per block: {:.0} µs ({:.2} ms)                       ║", BUDGET_US, BUDGET_US / 1000.0);
    println!("╠══════════════════════════════════════════════════════════════════╣");
    println!("║ {:22} │ {:>8} │ {:>10} │ {:>8} ║", "Module", "ns/samp", "µs/block", "CPU %");
    println!("╠══════════════════════════════════════════════════════════════════╣");
    for r in results {
        println!("║ {:22} │ {:>8.1} │ {:>10.2} │ {:>7.3}% ║", 
            r.name, r.ns_per_sample, r.us_per_block, r.cpu_pct);
    }
    println!("╠══════════════════════════════════════════════════════════════════╣");

    let total_cpu: f64 = results.iter().map(|r| r.cpu_pct).sum();
    let total_us: f64 = results.iter().map(|r| r.us_per_block).sum();
    println!("║ {:22} │ {:>8} │ {:>10.2} │ {:>7.3}% ║",
        "TOTAL (full chain)", "", total_us, total_cpu);
    println!("╠══════════════════════════════════════════════════════════════════╣");

    let headroom_pct = 100.0 - total_cpu;
    let status = if headroom_pct > 80.0 { "EXCELLENT" }
        else if headroom_pct > 50.0 { "GOOD" }
        else if headroom_pct > 20.0 { "WARNING" }
        else { "CRITICAL" };
    println!("║ Headroom: {:.1}% ({})                                     ║", headroom_pct, status);
    println!("╚══════════════════════════════════════════════════════════════════╝");
    println!();
}

#[test]
fn bench_all_dsp() {
    let mut results = Vec::new();

    // 1. Biquad filter (single)
    {
        let mut f = Biquad::new();
        f.set_lowpass(1000.0, 0.707, SR);
        results.push(bench("Biquad (lowpass)", |buf| f.process_block(buf)));
    }

    // 2. ThreeBandEq
    {
        let mut eq = ThreeBandEq::new(SR);
        eq.set_gains(-3.0, 2.0, -6.0, SR);
        results.push(bench("ThreeBandEq", |buf| eq.process_block(buf)));
    }

    // 3. Gain
    {
        let g = Gain::new(0.8);
        results.push(bench("Gain", |buf| g.process_block(buf)));
    }

    // 4. Gain Ramp
    {
        let mut g = Gain::new(0.5);
        results.push(bench("Gain Ramp", |buf| g.process_block_ramp(buf, 0.8)));
    }

    // 5. Limiter
    {
        let mut lim = Limiter::new(-1.0, 100.0, SR);
        results.push(bench("Limiter", |buf| lim.process_block(buf)));
    }

    // 6. Compressor
    {
        let mut comp = Compressor::new(-10.0, 4.0, 5.0, 100.0, SR);
        results.push(bench("Compressor", |buf| comp.process_block(buf)));
    }

    // 7. Delay
    {
        let mut dly = Delay::new(44100);
        dly.set_params(22050.0, 0.5, 0.5);
        results.push(bench("Delay (500ms)", |buf| dly.process_block(buf)));
    }

    // 8. Reverb
    {
        let mut rev = Reverb::new(SR);
        rev.set_wet(0.5);
        results.push(bench("Reverb (Schroeder)", |buf| rev.process_block(buf)));
    }

    // 9. Flanger
    {
        let mut flg = Flanger::new(SR);
        flg.set_params(1.0, 0.5, 0.5, 0.5, SR);
        results.push(bench("Flanger", |buf| flg.process_block(buf)));
    }

    // 10. Phaser
    {
        let mut pha = Phaser::new(SR);
        pha.set_params(1.0, 0.5, 0.5, 0.5);
        results.push(bench("Phaser (4-stage)", |buf| pha.process_block(buf)));
    }

    // 11. Gate
    {
        let mut gate = Gate::new();
        gate.set_params(0.5, 1.0);
        results.push(bench("Gate", |buf| gate.process_block(buf, 0.01)));
    }

    // 12. Waveshaper
    {
        let mut ws = Waveshaper::new();
        ws.set_params(0.7, 0.8);
        results.push(bench("Waveshaper", |buf| ws.process_block(buf)));
    }

    // ── Full Deck Chain (realistic) ────────────────────────
    // Trim → 3-Band EQ → ColorFX (LP) → Fader → Limiter
    {
        let trim = Gain::new(0.9);
        let mut eq = ThreeBandEq::new(SR);
        eq.set_gains(-3.0, 1.5, -2.0, SR);
        let mut color = Biquad::new();
        color.set_lowpass(2000.0, 0.707, SR);
        let fader = Gain::new(0.7);
        let mut limiter = Limiter::new(-1.0, 50.0, SR);

        results.push(bench("Full Deck Chain", |buf| {
            trim.process_block(buf);
            eq.process_block(buf);
            color.process_block(buf);
            fader.process_block(buf);
            limiter.process_block(buf);
        }));
    }

    // ── Full Master Chain ──────────────────────────────────
    // Master Gain → Filter (HP) → Distortion → Punch → Limiter
    {
        let master_gain = Gain::new(0.85);
        let mut filter = Biquad::new();
        filter.set_highpass(80.0, 0.707, SR);
        let mut dist = Waveshaper::new();
        dist.set_params(0.3, 0.5);
        let mut punch = Compressor::new(-12.0, 4.0, 5.0, 100.0, SR);
        let mut limiter = Limiter::new(-0.5, 50.0, SR);

        results.push(bench("Full Master Chain", |buf| {
            master_gain.process_block(buf);
            filter.process_block(buf);
            dist.process_block(buf);
            punch.process_block(buf);
            limiter.process_block(buf);
        }));
    }

    // ── Stereo Full Pipeline (2 decks + master) ────────────
    {
        // Deck A
        let trim_a = Gain::new(0.9);
        let mut eq_a = ThreeBandEq::new(SR);
        eq_a.set_gains(-3.0, 1.5, -2.0, SR);
        let fader_a = Gain::new(0.7);

        // Deck B
        let trim_b = Gain::new(0.85);
        let mut eq_b = ThreeBandEq::new(SR);
        eq_b.set_gains(0.0, -2.0, 3.0, SR);
        let fader_b = Gain::new(0.6);

        // Master
        let mut limiter = Limiter::new(-0.5, 50.0, SR);

        results.push(bench("Stereo Pipeline (2deck+master)", |buf| {
            // Deck A
            let mut a = buf.to_vec();
            trim_a.process_block(&mut a);
            eq_a.process_block(&mut a);
            fader_a.process_block(&mut a);

            // Deck B
            let mut b = buf.to_vec();
            trim_b.process_block(&mut b);
            eq_b.process_block(&mut b);
            fader_b.process_block(&mut b);

            // Mix
            for i in 0..BLOCK_SIZE {
                buf[i] = a[i] + b[i];
            }
            limiter.process_block(buf);
        }));
    }

    print_results(&results);
}
