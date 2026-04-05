# BPM & Beatgrid Detection Engine — Technical Reference

**Module**: `mixi-core/src/bpm.rs`
**Language**: Rust (compiled to WebAssembly via `wasm-bindgen`)
**Version**: v3
**Test coverage**: 58 unit tests

---

## 1. System Architecture and Pipeline Overview

The BPM detection engine operates as a three-phase pipeline that transforms raw PCM audio into a tempo estimate (BPM), a beatgrid phase offset (first beat time in seconds), and a confidence score.

```
Input (PCM f32[])
    |
    v
[mix_to_mono] ─── NaN/Inf sanitization ───> mono f32[]
    |
    v
Phase 1: Smart Chunking ──> coarse BPM consensus from 3 strategic positions
    |
    v
Phase 2: Multi-Band Analysis ──> onset detection (low/mid/high), genre classification
    |
    v
Phase 3: Refinement ──> octave resolution, grid alignment, PLL phase lock
    |
    v
Output: BpmResult { bpm: f32, offset: f32, confidence: f32 }
```

### 1.1 Entry Points

The module exports three public functions via `#[wasm_bindgen]`:

| Function | Purpose | Typical latency |
|----------|---------|-----------------|
| `detect_bpm` | Full three-phase analysis | 50–200ms |
| `detect_bpm_fast` | First 15 seconds only, no genre analysis | <50ms |
| `detect_bpm_legacy` | Returns `Vec<f32>` for backward-compatible JS callers | Same as `detect_bpm` |

Both `detect_bpm` and `detect_bpm_fast` return `BpmResult`, a `#[wasm_bindgen]`-exported struct with three public `f32` fields. This avoids the heap allocation overhead of returning a `Vec<f32>`.

### 1.2 WebAssembly Memory Boundary

The current API accepts `&[f32]`, which causes `wasm-bindgen` to copy the entire audio buffer from JavaScript heap to Wasm linear memory on each call. For `detect_bpm_fast` (15 seconds = ~661K samples), this copy is negligible. For `detect_bpm` on a 6-minute stereo file (~31M samples, ~120MB), the copy dominates wall-clock time. A future zero-copy path using exported Wasm memory pointers is documented as a known improvement.

### 1.3 Confidence Rejection

If the pipeline produces a confidence score below `MIN_CONFIDENCE` (0.15), the engine returns a default BPM of 120.0 with the actual confidence value, signaling to the UI that manual beatgrid adjustment is recommended.

---

## 2. Phase 1: Pre-Processing and Onset Detection

### 2.1 Mono Downmix

Multi-channel input is reduced to mono by averaging all channels with `1/num_channels` gain. Each sample is checked with `is_finite()` to reject `NaN` and `Inf` values from corrupted audio files.

### 2.2 Energy Envelope Computation

The function `compute_energy` divides the mono signal into non-overlapping windows of `ENERGY_WINDOW` (441 samples, ~10ms at 44.1kHz) and computes the mean squared amplitude of each window:

```
E[i] = (1/N) * sum(s[j]^2)  for j in [i*N, (i+1)*N)
```

where `N` is the actual number of samples in the window (not the nominal `ENERGY_WINDOW`), which corrects for the final partial window that may contain fewer samples.

The `sqrt()` operation is deliberately omitted. Squared energy exaggerates transient peaks relative to sustained signals, which improves onset detection on compressed material where the RMS envelope is nearly flat.

### 2.3 Half-Wave Rectified Spectral Flux

The function `detect_onsets` computes onsets by analyzing the first derivative of the energy envelope:

```
flux[i] = max(0, E[i] - E[i-1])
```

The half-wave rectification (clamping negative values to zero) ensures that only *rising* energy transitions register as onsets. This is critical for heavily compressed electronic music where the energy level rarely drops significantly between beats — the absolute energy is nearly constant, but the positive derivative still marks transient attacks.

### 2.4 Adaptive Thresholding

An onset is registered when `flux[i]` exceeds a locally adaptive threshold:

```
threshold = local_mean + 1.5 * local_stddev + epsilon
```

The local mean and standard deviation are computed over a sliding window of `AVG_WINDOW_SIZE` (21 frames, ~210ms). This adapts to the dynamic range of the signal: on a track mastered at -4 LUFS (typical Freetekno), a fixed multiplier threshold would never trigger because the mean equals the peak. The standard deviation component isolates genuine transients from the noise floor.

#### Numerical Stability (f64 Accumulators)

The sliding window accumulates `win_sum` and `win_sq_sum` as `f64` (64-bit double precision). With `f32` accumulators, the subtract-and-add pattern over millions of frames causes catastrophic cancellation: the accumulated rounding error eventually makes `win_sq_sum` slightly negative, producing `NaN` from the subsequent `sqrt()`. The `f64` path provides 15 decimal digits of precision, which is sufficient for audio files of arbitrary length.

### 2.5 Inter-Onset Interval Constraint

A minimum inter-onset interval of `MIN_IOI` (60ms) suppresses double-triggering. At 190 BPM, a 1/16th note subdivision occurs every 78ms, so the 60ms constraint preserves fill patterns while rejecting spurious re-triggers from reverb tails or hi-hat bleed.

---

## 3. Phase 2: Tempo Estimation

### 3.1 Multi-Band Onset Detection

The function `detect_multiband_onsets` splits the signal into three frequency bands using single-pole IIR filters, fused into a single-pass loop that never allocates intermediate filtered audio arrays.

| Band | Frequency range | IIR type | Onset weight |
|------|----------------|----------|-------------|
| Low | < 200 Hz | Lowpass | 2.0x (kick) |
| Mid | 200–3000 Hz | Complementary (s - low - high) | 1.5x (snare) |
| High | > 3000 Hz | Highpass | 0.5x (hi-hat) |

The IIR filter coefficients are:

```
alpha_low  = dt / (RC_low + dt)       where RC_low = 1 / (2*pi*200)
alpha_high = RC_high / (RC_high + dt)  where RC_high = 1 / (2*pi*3000)
```

The mid-band is computed as `s - low_state - high_state`. This is a "dirty" complementary filter that introduces phase artifacts at the crossover frequencies. Since only the energy envelope is used (not the audible signal), these artifacts are negligible for onset detection purposes.

#### Anti-Denormal Protection

Each input sample receives a `+1e-15` DC offset before filtering. This prevents the IIR state variables from decaying into subnormal float territory after loud-to-silence transitions, which would trigger the CPU's slow-path denormal handling and cause unpredictable latency spikes.

#### Memory Optimization

The original implementation allocated 6 heap arrays (3 filtered signals + 3 energy envelopes). The fused single-pass approach allocates only 3 energy vectors (`Vec<f32>` of size `num_frames`), reducing peak memory from `O(6 * num_samples)` to `O(3 * num_frames)`, where `num_frames = num_samples / 441`.

### 3.2 Multi-Hop IOI Histogram

The function `estimate_bpm_ioi` constructs a histogram of candidate BPM values by measuring the time intervals between all onset pairs up to `MAX_HOPS` (8) apart:

```
for hop in 1..=8:
    for each onset pair (i, i-hop):
        single_ioi = (time[i] - time[i-hop]) / hop
        raw_bpm = 60 / single_ioi
        vote(raw_bpm, weight)
        vote(raw_bpm * 2, weight * 0.7)  // octave harmonic
        vote(raw_bpm / 2, weight * 0.7)  // sub-octave harmonic
```

The histogram has `BIN_RESOLUTION` of 0.25 BPM, covering the range 65–200 BPM (540 bins). Each vote is weighted by the geometric mean of the onset strengths and inversely by the hop distance.

#### Gaussian Smoothing

The histogram is convolved with a pre-computed Gaussian kernel (sigma=2, radius=4, 9 taps). The kernel weights are hardcoded as a compile-time constant array, eliminating the `exp()` computation that would otherwise dominate the smoothing step.

#### Peak Extraction (Center of Mass)

The peak BPM is refined using a 5-bin center-of-mass calculation:

```
com = sum(smoothed[k] * k) / sum(smoothed[k])  for k in [peak-2, peak+2]
bpm = bpm_min + com * BIN_RESOLUTION
```

This provides sub-bin resolution without the instability of 3-point parabolic interpolation on broad histogram peaks.

### 3.3 Comb Filter Resonator Bank

The function `comb_filter_bpm` implements a bank of 280 resonators, one per candidate BPM (60.0 to 200.0 in steps of 0.5). Each resonator accumulates the energy at its corresponding beat period:

```
for each candidate BPM:
    period = frame_rate * 60 / BPM    (float, not truncated)
    pos = 0.0
    while pos < energy.len() - 1:
        acc += lerp(energy, pos)       (linear interpolation)
        pos += period                  (float accumulation)
```

#### Phase Drift Prevention

The accumulation position `pos` is maintained as `f32` throughout the sweep. Integer truncation of the period (e.g., `3891.76 → 3891` at 170 BPM) causes a cumulative drift of 0.76 frames per beat. After 100 beats, the resonator is 76 frames out of phase and fails to correlate with the signal. Float accumulation eliminates this drift entirely.

#### Linear Interpolation

Energy values are read using linear interpolation between adjacent frames:

```
value = energy[idx] + frac * (energy[idx+1] - energy[idx])
```

The boundary condition (last frame) is handled outside the inner loop to avoid a conditional branch that would defeat SIMD vectorization and branch prediction.

#### Off-Beat Penalty

Each resonator also accumulates energy at half-period offsets. This off-beat energy is subtracted with a 0.3 coefficient to penalize candidates where the detected "beat" is actually a hi-hat or off-beat percussion pattern.

### 3.4 Fusion of IOI and Comb Filter Estimates

The function `fuse_bpm_estimates` reconciles the two independent BPM estimates:

1. **Agreement** (|IOI - Comb| < 3.0 BPM): Weighted average with IOI weighted 1.5x (higher frequency resolution due to finer binning).
2. **Disagreement**: The estimate with higher confidence is selected.

---

## 4. Phase 3: Grid Alignment and Phase-Locked Loop

### 4.1 Grid Alignment Score

The function `grid_alignment_score` evaluates how well a candidate BPM fits the observed onset pattern. For each of 16 candidate phase offsets, it computes:

```
for each onset j:
    bf = fract((onset_time - phase) / beat_period)
    dist = min(bf, 1 - bf)             // distance to nearest beat
    nd = dist / 0.08
    score += onset_weight * max(0, 1 - nd^2)   // parabolic window
```

The parabolic approximation `(1 - x^2).max(0)` replaces the Gaussian `exp(-x^2/2sigma^2)` in the inner loop. The function `exp()` requires approximately 20 floating-point operations on typical hardware; the parabola requires 2 (one multiply, one subtract). The approximation has compact support (exactly zero beyond `|x| > 1`), which matches the intent of the scoring function: onsets more than 8% of a beat period away from the nearest grid line contribute zero to the score.

### 4.2 Octave Resolution

The function `resolve_octave` tests the grid alignment score at the detected BPM and its octave variants (x2, /2). A DJ-range bonus is applied:

| BPM range | Multiplier | Rationale |
|-----------|-----------|-----------|
| 120–185 | 1.15x | Standard DJ tempo range |
| 100–120 | 1.05x | Mild preference |
| < 100 | 0.85x | Penalty (likely half-time error) |
| > 185 | 1.0x | Neutral |

The asymmetry penalizes sub-100 BPM results more aggressively than super-185 results, reflecting the empirical observation that half-time detection errors are more common than double-time errors in electronic music.

### 4.3 Genre-Specific Octave Heuristic

The function `genre_octave_heuristic` analyzes the phase relationship between low-band (kick) and mid-band (snare) onsets to detect half-time or double-time genres:

- **Half-time detection** (Dubstep, Trap): If BPM > 140, the kick/snare half-beat alignment ratio is < 0.2, and the kick onset count is less than half the hi-hat count, the BPM is halved.
- **Double-time detection** (Drum & Bass): If BPM < 90 and hi-hat onsets outnumber kick onsets by 3x, the BPM is doubled.

The half-beat ratio measures how many kick-snare pairs have a timing delta that aligns with 0.5 beats (the "K...S...K...S" pattern of 4/4 music) versus 0.0 beats (kick and snare coinciding, typical of half-time grooves).

### 4.4 PLL Sinusoid Grid Offset

The function `pll_grid_offset` determines the exact time of the first beat by sweeping a virtual oscillator across all possible phase offsets:

```
for p in 0..100:
    phase = p * 0.01                   // 1% resolution
    beat_time = phase * beat_period
    score = 0
    while beat_time < total_duration:
        score += lerp(energy, beat_time * frame_rate)
        beat_time += beat_period        // float, no drift
    if score > best:
        best_offset = phase * beat_period
```

The phase sweep uses an integer iterator (`for p in 0..100`) rather than a float accumulator (`phase += 0.01`) to prevent accumulated rounding error. Each phase value is computed fresh as `p as f32 * step`, guaranteeing zero drift regardless of the number of test points.

Energy reads use linear interpolation for sub-frame precision. The boundary condition is handled outside the tight loop.

### 4.5 Refinement and Snap

After octave resolution, two additional passes improve precision:

1. **Fine refinement** (`refine_bpm`): Sweeps BPM in 0.1-step increments within a ±2.5 BPM window around the coarse estimate, selecting the candidate with the highest grid alignment score.

2. **Integer snap** (`snap_to_common_bpm`): If the refined BPM is within ±0.15 of an integer value and the integer value's grid score is at least 95% of the refined value's score, the BPM is rounded to the integer. This corrects for sub-decimal drift on tracks with exact integer tempos (common in electronic music production).

The final BPM is rounded to two decimal places (`(bpm * 100).round() / 100`), providing sufficient precision to prevent visible beatgrid drift over a 6-minute track.

---

## 5. Smart Chunking and Consensus

### 5.1 Chunk Selection

The function `get_chunk_ranges` selects three 15-second analysis windows at:

| Chunk | Position | Rationale |
|-------|----------|-----------|
| 1 | 0% (start) | Captures intro rhythm |
| 2 | 30% | Typically the first drop in electronic music |
| 3 | 70% | Second drop or main section |

Each chunk must contain at least 1 second of audio. For files shorter than 15 seconds, the system falls back to full-file analysis.

### 5.2 Octave-Normalized Consensus

Before comparing chunk BPM estimates, all values below 100 BPM are doubled to normalize octave variants into the same range. This prevents a breakdown section (detected at 85 BPM) from disagreeing with the drop section (170 BPM) — both normalize to 170 for the consensus check.

If all normalized chunk BPMs agree within ±3.0 BPM, the final estimate is a confidence-weighted average of the original (un-normalized) values. If chunks disagree, the system discards the chunk results and performs a full-file analysis.

---

## 6. Computational Complexity and Optimizations

### 6.1 Asymptotic Complexity

| Component | Naive | Optimized | Reduction |
|-----------|-------|-----------|-----------|
| Onset threshold | O(N*K) per frame | O(N) sliding window | K=21x speedup |
| Multi-band filter + energy | O(6*N) with 6 arrays | O(N) single-pass | 6x memory, ~3x CPU |
| Gaussian smoothing | O(N*K) with runtime `exp()` | O(N*K) with static kernel | ~20x per tap |
| Grid alignment scoring | O(C*M) with `exp()` | O(C*M) with parabola | ~10x per evaluation |

Where N = number of energy frames, K = kernel/window width, C = phase candidates, M = search window onsets.

### 6.2 Branch Elimination

The innermost loops of `comb_filter_bpm` and `pll_grid_offset` use a pattern that handles the boundary condition outside the loop:

```rust
let limit = energy.len().saturating_sub(1);
while (pos as usize) < limit {
    // branchless lerp: energy[idx] + frac * (energy[idx+1] - energy[idx])
}
// handle last frame separately
if (pos as usize) < energy.len() {
    acc += energy[pos as usize];
}
```

This eliminates a conditional branch from every iteration of the tight loop, enabling the compiler to generate branchless SIMD-friendly machine code. The `fract()` call is replaced with `pos - idx as f32` (a single subtract instruction vs. a `libm` function call).

### 6.3 Memory Allocation Strategy

- **Inner loops**: Zero heap allocations. All accumulators are stack-local scalars.
- **Energy vectors**: Pre-allocated with `Vec::with_capacity(num_frames)` to avoid reallocation.
- **Histogram**: Single allocation, reused for the duration of `estimate_bpm_ioi`.
- **Multi-band**: Filter states are stack-local `f32` variables. No intermediate filtered audio arrays are materialized.

### 6.4 Numerical Precision Decisions

| Variable | Type | Rationale |
|----------|------|-----------|
| Sliding window accumulators | `f64` | Prevents catastrophic cancellation over >100K iterations |
| Comb filter position | `f32` | Sub-sample precision for beat period alignment |
| PLL phase iterator | `usize → f32` | Fresh computation per iteration prevents drift |
| Energy values | `f32` | Sufficient for envelope-level analysis |
| BPM output | `f32`, 2 decimal places | 0.01 BPM resolution prevents visible grid drift over 6 minutes |

---

## 7. Constants Reference

| Constant | Value | Unit | Purpose |
|----------|-------|------|---------|
| `ENERGY_WINDOW` | 441 | samples | ~10ms at 44.1kHz; energy frame size |
| `AVG_HALF_WINDOW` | 10 | frames | Onset threshold window radius (21 frames total) |
| `MIN_IOI` | 0.06 | seconds | Minimum inter-onset interval (60ms) |
| `BIN_RESOLUTION` | 0.25 | BPM | IOI histogram bin width |
| `MAX_HOPS` | 8 | count | Maximum onset pair distance for IOI calculation |
| `MIN_CONFIDENCE` | 0.15 | ratio | Below this, BPM is rejected (returns 120.0) |
| `COMB_BPM_MIN` | 60.0 | BPM | Comb filter bank lower bound |
| `COMB_BPM_MAX` | 200.0 | BPM | Comb filter bank upper bound |
| `COMB_BPM_STEP` | 0.5 | BPM | Comb filter bank resolution (280 resonators) |
| `BAND_LOW_HZ` | 200 | Hz | Low/mid crossover frequency |
| `BAND_HIGH_HZ` | 3000 | Hz | Mid/high crossover frequency |
| `CHUNK_DURATION` | 15.0 | seconds | Smart chunking window length |
| `CHUNK_POSITIONS` | [0.0, 0.30, 0.70] | ratio | Chunk start positions (fraction of total duration) |

---

## 8. Test Coverage Summary

The module includes 58 unit tests organized by subsystem:

| Category | Tests | Key scenarios |
|----------|-------|--------------|
| Energy computation | 1 | Squared energy, actual window size division |
| Mono downmix | 2 | Stereo averaging, mono passthrough |
| Onset detection | 4 | Basic count, timing accuracy, f64 stability (2min), DC signal rejection |
| Comb filter | 4 | 120/140/170 BPM, float precision over 60s, empty input |
| PLL grid offset | 4 | Zero phase, half-beat offset, 5-minute drift test, degenerate input |
| Multi-band | 4 | Low-only, high-only, empty, 20ms deduplication |
| Genre heuristic | 4 | Dubstep halving, D&B doubling, neutral 4/4, insufficient data |
| Fusion logic | 3 | Agreement averaging, IOI-wins, comb-wins |
| Chunking | 3 | Short audio, position correctness, same-BPM consensus |
| Grid alignment | 3 | Perfect grid, wrong BPM discrimination, minimum onset count |
| Octave resolution | 2 | DJ range preference, genre multiplier interaction |
| Full pipeline | 5 | 120/140 BPM, kick+hihat, stereo, fast vs full coherence |
| Refinement | 2 | Integer snap, refinement convergence |
| Edge cases | 5 | Silence (5 min), NaN/Inf input, empty, negative sample rate, inverted range |

All tests use synthetic audio generated by helper functions (`synth_kicks`, `synth_kick_hihat`) that produce deterministic signals at specified BPMs with configurable transient width and duration.

---

*Source: `mixi-core/src/bpm.rs` (1643 lines, Rust)*
*Compiled target: `wasm32-unknown-unknown` via `wasm-pack`*
