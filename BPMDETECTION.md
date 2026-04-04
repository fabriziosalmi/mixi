# BPM Detection & Timing

> Last verified against code: v0.2.6 (2026-04-04)

## Current Architecture

### Pipeline
1. `MixiEngine.loadTrack()` → `decodeAudioData()` → PCM `AudioBuffer`
2. `WaveformAnalyzer.analyzeWaveform(buffer)`:
   - Offline-renders 3 frequency bands via `OfflineAudioContext`:
     - Low: lowpass @ 250 Hz
     - Mid: bandpass @ √(250 × 4000) ≈ 1000 Hz
     - High: highpass @ 4000 Hz
   - Passes low-band buffer to `BpmDetector.detectBpm()`
   - Computes RGB waveform (RMS per chunk, `POINTS_PER_SECOND = 100` → chunk = `sampleRate / 100` samples)
   - Runs key detection (`KeyDetector.detectKey()`)
   - Runs drop detection (`DropDetector.detectDrops()`)
3. `BpmDetector.detectBpm(lowBandBuffer)`:
   - Adaptive spectral flux onset detection (ENERGY_WINDOW = 441 samples ≈ 10ms @ 44.1kHz)
   - Adaptive threshold: peak > 1.3 × local mean (half-window = 10 frames)
   - Multi-hop IOI histogram (up to 4 hops, weighted by onset strength)
   - BIN_RESOLUTION = 0.25 BPM for histogram bins
   - Octave resolution (65–200 BPM range, tests ×2 / ÷2, DJ range bonus 100–185)
   - Fine refinement (±2.5 BPM sweep at 0.1 steps via grid alignment scoring)
   - Snap to integer BPM if within 0.5 BPM AND rounded score ≥ 95% of original
   - Grid offset via best-aligning onset (tests up to 20 candidates, tolerance = beatPeriod × 0.12)

### Dual Implementation (JS + Rust/Wasm)
Both TypeScript (`BpmDetector.ts`) and Rust (`mixi-core/src/bpm.rs`) implement the **identical algorithm** with matching constants. When Wasm is loaded, the Rust fast path is used automatically (log prefix `[Rust]`). The JS fallback is seamless.

### Key Detection
- **Algorithm**: Goertzel (4 octaves, 48 frequency bins) → 12-class chromagram → Pearson correlation against 24 Krumhansl-Kessler key profiles (major + minor)
- **Output**: Camelot wheel notation (e.g., `8A`, `11B`)
- **Harmony check**: `isHarmonicMatch()` validates same Camelot number or ±1 letter step
- **Dual implementation**: JS (`KeyDetector.ts`) + Rust (`key.rs`), identical output

### Drop Detection
- **Algorithm**: 4-beat sliding window energy analysis → first derivative (energy delta) → threshold at mean + 1.5 × stddev → phrase boundary filter (beat % 16 < 2 or > 14)
- **Output**: Array of drop candidates with beat position, strength, and timestamp
- **Sort**: By strength descending, capped at 16 candidates
- **Dual implementation**: JS (`DropDetector.ts`) + Rust (`drop_detect.rs`)

### VBR Safety (Edge-Case #35)
**Status: ALREADY SAFE.** All timing calculations use decoded PCM data exclusively:
- `BpmDetector` works on `Float32Array` samples from `getChannelData(0)`, timing derived from `(frameIndex * windowSize) / sampleRate`
- `WaveformAnalyzer` chunk size = `Math.floor(buffer.sampleRate / POINTS_PER_SECOND)`
- `AudioBuffer.duration` (used in drop detection & logging) is computed by the browser as `length / sampleRate` from the decoded PCM — NOT from file metadata headers

No code path reads MP3/AAC container metadata for timing. VBR files are decoded to fixed-rate PCM by `decodeAudioData()` before any analysis runs.

---

## Known Limitations & Future Improvements

### Accuracy
- **Swing / non-4/4 time**: The detector assumes straight 4/4 time. Tracks with swing, triplet feels, or odd meters (3/4, 7/8) may get wrong BPM or poor grid alignment.
- **Variable tempo tracks**: Live recordings or DJ edits with tempo drift will get a single "average" BPM. Consider: segmented BPM detection (split track into 16-bar chunks, detect per-chunk, flag if variance > 1 BPM).
- **Very slow / very fast**: Range is 65–200 BPM. Tracks outside this (half-time DnB at 85 displayed as 170, footwork at 160 vs 80) rely on octave resolution heuristics that may pick the wrong octave.
- **Low-energy tracks**: Ambient, minimal techno, or tracks with no clear kick may produce low-confidence results. Surface the `confidence` score to UI and warn the user.

### Performance
- BPM detection: ~6–30ms for a 5-minute track (Rust fast path ~6ms, JS fallback ~30ms)
- Key detection: ~250–400ms (Goertzel on full track)
- Drop detection: ~2ms (energy analysis on pre-computed data)
- `OfflineAudioContext` rendering of 3 bands is the bottleneck (~80% of total analysis time). Could be moved to a Web Worker if loading latency becomes an issue.

### Beat Grid
- Grid offset detection picks the best-aligning onset. For tracks with intros (8 bars of atmosphere before the kick), the grid may anchor to a hi-hat or synth transient instead of the first downbeat.
- **Future**: Allow manual grid offset adjustment in the UI (tap-to-beat, drag grid).
- **Future**: Detect downbeat (bar start) vs beat — useful for phrase-synced mixing.

### Key Detection
- Uses Goertzel algorithm for pitch-class energy extraction (4 octaves, 48 bins) with Krumhansl-Kessler profile correlation. Works well for electronic music but can struggle with complex harmonic content (jazz, classical samples).
- Camelot wheel mapping is implemented with harmonic matching (`isHarmonicMatch()`). Could add "energy key" (strongest harmonic content) as a secondary display.

---

## Edge Cases Tested

| # | Case | Status |
|---|------|--------|
| 35 | VBR file timing skew | ✅ Safe — all timing from decoded PCM |
| 31 | Gate FX BPM drift | ✅ Fixed — gate rewritten as phase-based volume chop (v0.2.5) |
| 33 | Sync Zeno's paradox | ✅ Safe — instant seek, no gradual chase |
