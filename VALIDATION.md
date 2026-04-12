# VALIDATION.md — Deterministic E2E Mixer Validation Suite

## Context

MIXI has 564 unit tests and 74 E2E smoke tests, but ZERO tests that verify the actual audio mixing pipeline end-to-end: load two tracks → set levels → crossfade → verify output. A DJ app where the mixing doesn't work is a DJ app that doesn't work. We need a brickwall anti-regression suite that catches any mixer regression before it reaches users.

## Problem

No test currently verifies:
- That audio actually flows through the signal chain (source → EQ → fader → crossfader → master)
- That EQ kill actually silences a band
- That crossfader position routes audio correctly (A vs B vs center)
- That volume faders attenuate correctly
- That BPM detection works on loaded audio
- That sync actually phase-aligns two tracks
- That a complete mix transition (A→B) produces the expected output curve

## Strategy: Synthetic Audio + Real Engine + Measurement

1. **Generate synthetic audio** in the browser (OfflineAudioContext) at known BPMs
2. **Load it into the real engine** via `engine.loadTrack()`
3. **Manipulate controls** via store actions (volume, EQ, crossfader, sync)
4. **Measure output** via `engine.getLevel()` / `engine.getMasterLevel()`
5. **Assert** levels, timing, phase alignment against known ground truth

### Why synthetic audio, not demo MP3s

- **Deterministic**: same audio every run, no file dependency
- **Known ground truth**: we generate 120 BPM, we know it's 120 BPM
- **Fast**: 5-second tracks, not 5-minute songs
- **Measurable**: pure sine/kick = clean level measurement

## Prerequisites (code changes needed)

### 1. Expose MixiEngine on window (dev/test only)

**File**: `src/main.tsx` — add after store exposure:
```typescript
import('./audio/MixiEngine').then(m => {
  (window as any).__MIXI_ENGINE__ = m.MixiEngine.getInstance();
});
```

### 2. WAV encoder in test helpers

**File**: `tests/e2e/helpers/audio.ts` — browser-side WAV generator:
- `generateKickTrack(bpm, durationSec)` → ArrayBuffer (WAV)
- `generateSineTrack(freq, durationSec)` → ArrayBuffer (WAV)
- `audioBufferToWav(buffer)` → ArrayBuffer
- All run inside `page.evaluate()`

### 3. Level measurement helper

**File**: `tests/e2e/helpers/audio.ts`:
- `measureLevel(page, deck, samples, intervalMs)` → number[] (RMS samples over time)
- `measureMasterLevel(page, samples, intervalMs)` → number[]
- `waitForLevel(page, deck, threshold, timeoutMs)` → boolean

## Test File Structure

```
tests/e2e/
  helpers/
    app.ts              # existing — launchApp, store access
    audio.ts            # NEW — synth audio gen, WAV encode, level measurement
  20-mixer-validation.spec.ts   # NEW — the brickwall suite
```

## Test Suite: `20-mixer-validation.spec.ts`

### Phase 1: Signal Chain Verification (tracks play, levels respond)

```
T01 — Load synthetic 120 BPM kick track on Deck A
      Assert: BPM detected within ±2, isTrackLoaded=true, duration > 0

T02 — Play Deck A, verify non-zero level
      Assert: engine.getLevel('A') > 0.1 after 500ms playback

T03 — Pause Deck A, verify level drops to zero
      Assert: engine.getLevel('A') < 0.01 after 300ms

T04 — Load 130 BPM kick track on Deck B
      Assert: BPM detected within ±2

T05 — Play both decks simultaneously
      Assert: both levels > 0, master level > 0
```

### Phase 2: Volume & Crossfader (routing correctness)

```
T06 — Deck A volume 0 → level = 0
      Set volume A to 0, play → getLevel('A') should still show pre-fader
      But getMasterLevel() should be lower (B only at center crossfade)

T07 — Deck A volume 1 → level = max
      Restore volume A to 1 → master level should increase

T08 — Crossfader full A (0.0) → only A audible at master
      setCrossfader(0), play both → masterLevel ≈ level A

T09 — Crossfader full B (1.0) → only B audible at master
      setCrossfader(1) → masterLevel ≈ level B

T10 — Crossfader center (0.5) → both audible
      setCrossfader(0.5) → masterLevel > max(A, B) * 0.5

T11 — Crossfader curve switch (smooth vs sharp)
      Compare master levels at crossfader 0.25 with smooth vs sharp
```

### Phase 3: EQ (frequency band control)

```
T12 — EQ low kill (−32 dB) → level drops
      Set deck A EQ low to -32 → level should decrease
      (kick track is bass-heavy, killing low cuts most energy)

T13 — EQ mid kill → level drops differently
      Set deck A EQ mid to -32

T14 — EQ high kill → level drops minimally
      (kick has minimal high-freq content)

T15 — EQ flat (0 dB all bands) → level restored
      Reset all EQ to 0 → level matches T02

T16 — Master EQ sweep → master level responds
      Set master EQ low to -12, verify master level drops
```

### Phase 4: BPM Detection & Sync (phase alignment)

```
T17 — BPM detection accuracy on 120 BPM synthetic
      Generate known 120 BPM → detect → assert 118-122 range

T18 — BPM detection accuracy on 140 BPM synthetic
      Generate known 140 BPM → detect → assert 138-142 range

T19 — Sync B to A → playback rates match
      Play A (120), play B (140), sync B → B.bpm ≈ A.bpm

T20 — Sync changes B's playback rate
      After sync, B.playbackRate ≠ 1.0

T21 — Unsync restores independence
      unsyncDeck('B') → B.isSynced = false

T22 — Phase alignment after sync
      Both playing + synced → phase error < 0.1 beat
      (measure via getCurrentTime positions and BPM)
```

### Phase 5: Complete Mix Transition (the DJ test)

```
T23 — Full A→B transition (the money test)
      1. Load 120 BPM on A, 125 BPM on B
      2. Play A at full volume, B silent (vol=0)
      3. Sync B to A
      4. Master level ≈ A level (only A playing)
      5. Slowly fade: crossfader 0.5→0.6→0.7→0.8→0.9→1.0
         At each step, verify master level stays > 0 (no dropout)
      6. Set A volume to 0
      7. Master level ≈ B level (only B now)
      8. Total test: verify no silence gaps during transition
```

### Phase 6: Negative Tests (things that must NOT happen)

```
T24 — Playing with master volume 0 → master level = 0
T25 — Eject during playback → level drops to 0, no crash
T26 — Sync with BPM=0 → no crash, sync stays false
T27 — Double-sync same deck → no oscillation
T28 — Load track while other deck is playing → no interruption
```

### Phase 7: Gain & Master DSP

```
T29 — Gain boost (+6 dB) → level increases
T30 — Gain cut (-6 dB) → level decreases
T31 — Master filter LPF (-1) → level changes
T32 — Master filter HPF (+1) → level changes
T33 — Master distortion → level increases (harmonics)
```

## Terminal Output Format

Each test prints a structured line:

```
MIXER VALIDATION — 33 tests

  Signal Chain
    ✓ T01 load 120 BPM kick on A          bpm=119.2 dur=5.0s     2.1s
    ✓ T02 play A → level > 0              level=0.72              0.5s
    ✓ T03 pause A → level ≈ 0             level=0.00              0.3s
    ✓ T04 load 130 BPM kick on B          bpm=129.5               1.8s
    ✓ T05 play both → master > 0          A=0.71 B=0.68 M=0.85   0.5s

  Volume & Crossfader
    ✓ T06 A vol=0 → master drops          master=0.34             0.3s
    ✓ T07 A vol=1 → master rises          master=0.85             0.3s
    ✓ T08 xfader=0 → A only               master=0.71             0.3s
    ✓ T09 xfader=1 → B only               master=0.68             0.3s
    ✓ T10 xfader=0.5 → both               master=0.85             0.3s

  EQ
    ✓ T12 EQ low kill → level drops       before=0.72 after=0.15  0.5s
    ...

  BPM & Sync
    ✓ T17 120 BPM detection               detected=119.2 ±0.8    2.0s
    ✓ T19 sync B to A                     B.bpm=119.2 rate=0.92  0.5s
    ...

  Mix Transition
    ✓ T23 full A→B crossfade              min_level=0.42 (no gap) 3.0s

  Negative
    ✓ T24 master vol 0 → silence          master=0.00             0.3s
    ✓ T26 sync BPM=0 → no crash           synced=false            0.2s

  RESULT: 33/33 PASSED (18.5s)
```

## Measurement Functions (helpers/audio.ts)

```typescript
/** Generate WAV in browser, return ArrayBuffer */
async function generateTestTrack(page, bpm, durationSec, type): Promise<void>
  // Runs in page.evaluate, creates OfflineAudioContext
  // Generates kick/sine/clicktrack
  // Encodes to WAV ArrayBuffer
  // Calls engine.loadTrack(deck, wavBuffer)

/** Sample RMS level N times over M ms */
async function sampleLevels(page, deck, count, intervalMs): Promise<number[]>

/** Wait until level exceeds threshold */
async function waitForLevel(page, deck, threshold, timeoutMs): Promise<boolean>

/** Get phase error between two synced decks */
async function getPhaseError(page): Promise<number>
  // Reads getCurrentTime for both decks
  // Computes beat-fractional phase difference
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/main.tsx` | MODIFY | Expose `__MIXI_ENGINE__` in dev mode |
| `tests/e2e/helpers/audio.ts` | CREATE | Synth audio gen + WAV encode + level measurement |
| `tests/e2e/20-mixer-validation.spec.ts` | CREATE | 33 deterministic mixer tests |
| `VALIDATION.md` | CREATE | This document (project root, for reference) |

## Verification

1. `npx playwright test tests/e2e/20-mixer-validation.spec.ts --reporter=list` — all 33 pass
2. Each test prints measured values (BPM, levels, phase) for human inspection
3. No flaky tests — all inputs are synthetic, all measurements have thresholds
4. Runs in < 60 seconds total
5. Works in CI (Chromium headless with `--autoplay-policy=no-user-gesture-required`)
