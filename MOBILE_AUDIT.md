# MIXI Mobile — Draconian Audit & Mission-Critical Plan

**Date:** 2026-04-08
**Scope:** Mobile UI (MobileApp, MobileLandscape, MobilePortrait, MobileBrowser, overlays)
**Status:** Pre-Pod analysis — current mobile DJ experience

---

## Executive Summary

The mobile UI is a functional but **skeleton-grade** implementation. It covers play/pause, volume, crossfader, waveform scrub, EQ, pads, and search — but **cannot load tracks from the phone's local storage**, has no visual feedback for most states, and both orientations suffer from layout problems that make it unsuitable for live use on real devices. The Pod spec depends on a solid mobile foundation: if the DJ's own mobile can't work, a Guest's phone has zero chance.

---

## PART 1: PROBLEM CATALOGUE

### P1. NO LOCAL FILE LOADING ON MOBILE (Severity: CRITICAL)

The `MobileBrowser` component shows tracks from the `browserStore` and has a search bar — but **there is no way to add tracks to the store from the phone**. The only message when the list is empty is:

```
"No tracks — load from desktop"
```

The desktop `TrackLoader` (drag & drop, file picker, SoundCloud URL) is **never rendered** on mobile. The mobile components import `MobileBrowser`, not `TrackLoader`. There is:

- No `<input type="file" accept="audio/*">` anywhere in the mobile tree
- No drag & drop handler (impossible on mobile anyway)
- No URL paste input
- No way to add tracks at all

**Impact:** Mobile is read-only. A DJ who opens MIXI on their phone at a gig with zero tracks loaded on desktop sees an empty screen with no escape hatch. This alone makes mobile unusable as a standalone experience.

**Files:**
- [MobileBrowser.tsx:134](src/components/mobile/MobileBrowser.tsx#L134) — "No tracks — load from desktop"
- [TrackLoader.tsx](src/components/deck/TrackLoader.tsx) — desktop-only, never imported by mobile

---

### P2. LANDSCAPE LAYOUT — CRITICALLY SPARSE (Severity: HIGH)

`MobileLandscape.tsx` renders:

```
┌──────────────────────────────────────────────┐
│ [TRACK picker]      MIXI      [TRACK picker] │  ← 28px header
│                                              │
│ ▶ track name... ═══WAVEFORM═══ BPM SYNC VOL │  ← Deck A row (56px)
│ ▶ track name... ═══WAVEFORM═══ BPM SYNC VOL │  ← Deck B row (56px)
│                                              │
│           ◄━━━━━ XFADER ━━━━━►               │  ← Crossfader
│           [EQ] [PADS] [BROWSE] [PANIC]       │  ← Toolbar
└──────────────────────────────────────────────┘
```

**Problems:**

1. **Wasted vertical space.** The deck area uses `flex: 1` with `justifyContent: 'center'`, so on a typical phone (e.g. iPhone 15: 844×390 landscape) the two 56px deck rows float in a sea of black. ~270px of vertical space is unused.

2. **Waveform is tiny.** Only 32px tall in landscape. On a 390px screen that's 8% of height. Virtually impossible to see beat structure or use for navigation.

3. **No track info density.** Track name is truncated to a single 11px line. No artist, no key, no duration, no time remaining. A DJ needs to see at minimum: name, BPM, key, elapsed/remaining time.

4. **Volume slider too small.** 64×24px. On a 5-6" phone, that's ~12mm wide. Nearly impossible to make precise volume adjustments while mixing.

5. **No hot cue indicators.** The deck rows show zero information about set cues — a DJ can't see at a glance if cue points are loaded.

6. **No loop indicator.** Active loops are invisible in the deck row. The only way to know is to open the overlay.

7. **No pitch/speed control.** No pitch fader, no nudge buttons, no pitch bend. Manual beatmatching is impossible.

8. **Toolbar covers deck controls.** The EQ/PADS/BROWSE/PANIC bar is fixed at the bottom but competes for the same space as the crossfader.

---

### P3. PORTRAIT LAYOUT — CRAMPED AND NON-SCROLLABLE (Severity: HIGH)

`MobilePortrait.tsx` renders:

```
┌──────────────────────┐
│       MIXI    [PANIC]│  ← 36px header
│ ┌──────────────────┐ │
│ │ DECK A           │ │  ← DeckCard (~160px)
│ │ name  ▶  BPM SYNC│ │
│ │ ═══waveform═══   │ │
│ │ VOL ▓▓▓▓▓░░░░░░  │ │
│ └──────────────────┘ │
│ ◄━━━ XFADER ━━━━►   │
│ ┌──────────────────┐ │
│ │ DECK B           │ │  ← DeckCard (~160px)
│ │ name  ▶  BPM SYNC│ │
│ │ ═══waveform═══   │ │
│ │ VOL ▓▓▓▓▓░░░░░░  │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ Search...        │ │  ← MobileBrowser (flex: 1)
│ │ (track list)     │ │
│ └──────────────────┘ │
└──────────────────────┘
```

**Problems:**

1. **Overflow on short phones.** The fixed content (header 36 + deck A ~160 + xfader ~48 + deck B ~160 + browser padding) = ~420px before the browser. On an iPhone SE (667×375 portrait, minus iOS bars ≈ 580px usable), the browser gets ~160px — barely 3-4 tracks visible. On notch phones with safe area insets, even worse.

2. **No scroll on the deck section.** The decks + crossfader area has `flexShrink: 0` — it never shrinks. If content overflows, the browser just disappears.

3. **No safe area insets.** No `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)` handling. On iPhones with notch/Dynamic Island, the header gets clipped. On phones with gesture navigation bar, the bottom browser rows are hidden.

4. **Waveform still small.** 40px in portrait — better than landscape but still insufficient for track navigation.

5. **Same missing features as landscape.** No pitch, no hot cue indicators, no loop indicator, no elapsed time.

6. **Browser and deck compete for space.** The browser is always visible, consuming 30-40% of the screen. When no tracks are loaded, this is wasted space showing "No tracks — load from desktop".

---

### P4. MobileBrowser — DEAD END ON PHONE (Severity: CRITICAL)

- The browser fetches tracks from `browserStore.tracks` which are populated via desktop `TrackLoader` → IndexedDB
- The `loadToDeck` function does `fetch(track.audioUrl)` — this is a blob URL created from IndexedDB
- On a fresh mobile session, `audioUrl` is empty string (persisted without blob URLs)
- `hydrateAudioUrls()` runs on startup but only for tracks that were added from desktop — if IndexedDB has no blobs, no tracks appear
- **No mobile-specific track import path exists**

**Impact:** The browser component is a viewer for desktop-added content. It's architecturally incapable of being a standalone mobile experience.

---

### P5. NO SAFE AREA / NOTCH HANDLING (Severity: MEDIUM)

Both layouts use `100vh` without `env()`:

```tsx
width: '100vw',
height: '100vh',  // ← ignores notch, Dynamic Island, gesture bar
```

Missing:
- `padding-top: env(safe-area-inset-top)`
- `padding-bottom: env(safe-area-inset-bottom)`
- `<meta name="viewport" content="viewport-fit=cover">`

**Impact:** On modern iPhones (80%+ of club-goers), UI elements are clipped behind the notch/Dynamic Island and the home indicator bar.

---

### P6. NO ORIENTATION LOCK GUIDANCE (Severity: LOW)

When a DJ is mixing in landscape and accidentally rotates, the layout flips instantly with zero transition. No lock, no animation, no "rotate to switch" prompt. State is preserved (good), but the spatial disruption mid-mix is jarring.

---

### P7. MISSING PERFORMANCE-CRITICAL FEATURES (Severity: HIGH)

Features present on desktop, completely absent on mobile:

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Local file picker | Yes (drag+click) | **No** |
| SoundCloud URL import | Yes | **No** |
| Pitch fader | Yes | **No** |
| Nudge/pitch bend | Yes | **No** |
| Hot cue indicators on deck | Yes | **No** |
| Active loop indicator on deck | Yes | **No** |
| Elapsed / remaining time | Yes | **No** |
| Track key display on deck | Yes (landscape) **No**, (portrait) **No** |
| VU meters | Yes | **No** |
| Master FX | Yes | **No** |
| Recording | Yes | **No** |
| Settings panel | Yes | **No** |
| Track waveform overview | Yes | **No** (only scrolling mini) |

---

### P8. TOUCH TARGET ACCESSIBILITY (Severity: MEDIUM)

While most buttons meet the 48×48px minimum, several don't:

| Element | Size | Minimum | Status |
|---------|------|---------|--------|
| ToolBtn (landscape) | 26px height | 48px | FAIL |
| PortraitToolBtn | 22px height | 48px | FAIL |
| SYNC button (landscape) | 48×32px | 48×48px | FAIL (height) |
| Browser load buttons [A] [B] | 28×28px | 48×48px | FAIL |
| MobileDeckPicker chip | 22px height | 48px | FAIL |
| Search input | 32px height | 48px | FAIL |
| Volume slider (landscape) | 64×24px | n/a, but too narrow | BORDERLINE |

The touch targets marked FAIL are physically difficult to hit on a phone while standing in a dark club, with sweaty fingers, on a vibrating surface.

---

### P9. NO AUDIO CONTEXT INITIALIZATION GATE (Severity: HIGH)

Mobile browsers (especially Safari/iOS) require a user gesture to create/resume an AudioContext. The desktop has an "Inizia" button. The mobile UI has **no equivalent gate**. If the AudioContext isn't initialized, `MixiEngine.getInstance().isInitialized` returns false and all operations silently fail — play, load, seek, everything.

The `TrackLoader` checks `engine.isInitialized` and shows an error. Mobile has no such check: pressing play on a deck does `setPlaying(deckId, !isPlaying)` in the store but the audio engine may be dormant.

---

### P10. NO OFFLINE / PWA SUPPORT (Severity: MEDIUM)

No `manifest.json`, no service worker. This means:
- Can't "Add to Home Screen" with a proper icon
- No splash screen
- Always shows browser chrome (URL bar eats ~60px)
- No offline caching of already-loaded tracks
- If Pod eventually needs a Guest PWA, the infrastructure doesn't exist

---

### P11. INLINE STYLES EVERYWHERE (Severity: LOW — but maintainability drag)

Every mobile component uses `style={{...}}` objects. No CSS classes, no Tailwind on mobile components (desktop TrackLoader uses Tailwind). This means:
- No hover/focus/active pseudo-states (critical for touch feedback)
- No media queries
- No `:active` press state for buttons
- No CSS animations (only JS-driven)
- Every button re-creates its style object on render (minor perf cost, 8 buttons × 50Hz)

---

### P12. MobileScaleWrapper — DESKTOP UI SCALED DOWN ≠ MOBILE UI (Severity: MEDIUM)

`MobileScaleWrapper` exists but is used for the **desktop** UI on tablets, not for the mobile components. However, its existence creates confusion: which phones get the mobile UI vs. the scaled desktop? The breakpoint is:

```
minDim < 500 && navigator.maxTouchPoints > 0 → MobileApp
else → DesktopRoot (which may use MobileScaleWrapper if viewport < 1100×700)
```

An iPad Mini (744px min) gets the desktop UI scaled to ~67%. A Galaxy Fold inner screen (674px min) gets the desktop UI scaled. The mobile UI only activates on devices narrower than 500px on the short side. This is correct for phones, but the desktop-scaled experience on small tablets is also subpar.

---

## PART 2: MISSION-CRITICAL PLAN

### Tier 0 — BLOCKER (must fix before mobile is usable at all)

#### M0.1: Mobile Track Loader

**What:** Add a file picker + URL input to the mobile experience.

**How:**
- Create `MobileTrackLoader.tsx` — simplified version of desktop `TrackLoader`:
  - Large, thumb-friendly "+" button (80×80px, centered)
  - `<input type="file" accept="audio/*" multiple>` triggered on tap
  - On file select → `file.arrayBuffer()` → `MixiEngine.loadTrack()` → `browserStore.addTrack()`
  - Optional: URL paste input (collapsible, below the button)
- In **portrait**: show the loader when no tracks are in the browser (empty state replacement)
- In **landscape**: add a "+" button to the toolbar that opens a modal file picker
- Handle `multiple` file selection: add all to browser, load first to active deck
- Show loading progress (file name + spinner)

**Files to modify:**
- New: `src/components/mobile/MobileTrackLoader.tsx`
- Edit: `MobilePortrait.tsx` — replace "No tracks — load from desktop" with the loader
- Edit: `MobileLandscape.tsx` — add "+" button to toolbar
- Edit: `MobileBrowser.tsx` — empty state → show loader inline

#### M0.2: AudioContext Initialization Gate

**What:** Require a user gesture before any audio operations on mobile.

**How:**
- Create a `MobileInitGate.tsx` — full-screen overlay on first launch:
  - MIXI logo + "Tap to start" (large, centered)
  - On tap: `MixiEngine.getInstance().initialize()` → dismiss overlay
  - Stores initialized state in a ref to avoid re-showing
- Wrap `MobileApp` return in the gate component
- Alternatively: auto-init on first Play/Load tap, but the gate is safer for iOS Safari

**Files to modify:**
- New: `src/components/mobile/MobileInitGate.tsx`
- Edit: `MobileApp.tsx` — wrap content in gate

#### M0.3: Safe Area Insets

**What:** Respect device notch, Dynamic Island, and gesture navigation bar.

**How:**
- Add `viewport-fit=cover` to the viewport meta tag in `index.html`
- Apply `env(safe-area-inset-*)` padding to the root containers in both layouts
- Portrait header: `paddingTop: max(env(safe-area-inset-top), 8px)`
- Portrait bottom: `paddingBottom: env(safe-area-inset-bottom)`
- Landscape: `paddingLeft: env(safe-area-inset-left)`, `paddingRight: env(safe-area-inset-right)`

**Files to modify:**
- Edit: `index.html` — viewport meta
- Edit: `MobileLandscape.tsx` — root div padding
- Edit: `MobilePortrait.tsx` — root div padding

---

### Tier 1 — ESSENTIAL (required for live use)

#### M1.1: Landscape Layout Overhaul

**What:** Fill the wasted space, increase information density.

**Redesign:**
```
┌──────────────────────────────────────────────────┐
│ [A▼]  Artist - Title         128.0  Am    [B▼]   │  ← Header: deck info
├──────────────────────────────────────────────────┤
│ ════════════ WAVEFORM A (60px) ══════════════    │
│ ▶  [<<] [>>]  CUE  1 2 3 4  │VOL│  00:00/03:45 │  ← Controls row A
├──────────────────────────────────────────────────┤
│ ════════════ WAVEFORM B (60px) ══════════════    │
│ ▶  [<<] [>>]  CUE  1 2 3 4  │VOL│  00:00/04:12 │  ← Controls row B
├──────────────────────────────────────────────────┤
│ A ◄━━━━━━━━━━ XFADER ━━━━━━━━━━► B              │
│ [EQ] [PADS] [+] [BROWSE] [PANIC]                │
└──────────────────────────────────────────────────┘
```

Changes:
- Waveform height: 32px → 60px
- Add per-deck info in header: artist, title, BPM, key
- Add elapsed/remaining time per deck
- Add mini hot cue indicators (4 colored dots)
- Add nudge buttons (`<<` `>>`)
- Volume slider: vertical instead of horizontal, 48px wide
- Active loop indicator (colored border on waveform)

#### M1.2: Portrait Layout Overhaul

**What:** Scrollable, space-efficient, usable on small phones.

**Redesign:**
```
┌─────────────────────────┐
│ MIXI        [+] [PANIC] │  ← Header (with file add button)
├─────────────────────────┤
│ ▶A  Title - Art   128.0 │  ← Compact deck A (one-line + waveform)
│ ═══ WAVEFORM A (48px) ══│
│ ◄━━━━ XFADER ━━━━►      │
│ ▶B  Title - Art   126.3 │  ← Compact deck B
│ ═══ WAVEFORM B (48px) ══│
├─────────────────────────┤
│ [EQ A] [EQ B] [PADS] ↑↑│  ← Quick access bar
├─────────────────────────┤
│ Search...                │
│ ┌───────────────────┐   │  ← Browser (scrollable, flex:1)
│ │ Track 1    128 Am │   │
│ │ Track 2    126 Cm │   │
│ │ Track 3    130 F  │   │
│ └───────────────────┘   │
└─────────────────────────┘
```

Changes:
- Compact one-line deck summary (play + name + BPM on one row)
- Waveform: 40px → 48px, wider padding
- Quick access bar between decks and browser
- Browser takes remaining space
- Whole deck section scrollable if viewport < 580px

#### M1.3: Touch Target Fixes

**What:** All interactive elements ≥ 48×48px tap area.

| Element | Current | Target |
|---------|---------|--------|
| ToolBtn | 26px h | 48px h |
| PortraitToolBtn | 22px h | 48px h |
| SYNC | 48×32 | 48×48 |
| Browser [A] [B] | 28×28 | 44×44 (with 2px margin → 48px touch area) |
| DeckPicker chip | 22px h | 40px h + 8px padding → 48px touch area |
| Search input | 32px h | 44px h |

#### M1.4: Pitch / Nudge Controls

**What:** Add basic manual beatmatching capability.

**How:**
- Two nudge buttons per deck (`−` `+`): apply ±0.02 pitch bend on press, release to center
- Use pointer down/up events (not click) for press-and-hold behavior
- In landscape: fit beside the play button
- In portrait: add to the per-deck control row in the overlay

---

### Tier 2 — IMPORTANT (required for polish)

#### M2.1: PWA Manifest + Service Worker

**What:** Make MIXI installable on home screen.

- `manifest.json` with icons, `display: standalone`, `orientation: any`
- Minimal service worker: cache app shell + WASM binary
- Splash screen with MIXI branding
- Removes browser chrome → gains ~60px vertical space

#### M2.2: Haptic Feedback Expansion

**What:** Extend haptics beyond shake-to-panic and crossfader snap.

Add haptic feedback to:
- Play/pause toggle → `tick()`
- Hot cue trigger → `snap()`
- Loop engage → `confirm()`
- Beat jump → `tick()`
- Track loaded → `confirm()`
- EQ kill → `snap()`
- Error → `panic()`

#### M2.3: Press States & Visual Feedback

**What:** Add `:active` visual feedback to all buttons.

Since inline styles can't do `:active`, either:
- Migrate mobile buttons to a shared `MobileButton` component with `onPointerDown/Up` → state-driven opacity/scale
- Or add a minimal CSS class system for mobile (`.m-btn:active { opacity: 0.7; transform: scale(0.95); }`)

#### M2.4: Elapsed / Remaining Time Display

**What:** Show current position and duration per deck.

- Format: `01:23 / 03:45` or `01:23 -02:22`
- Update at 1 Hz (don't need 30fps for a clock)
- In landscape: right side of the controls row
- In portrait: below the waveform

#### M2.5: Orientation Transition

**What:** Smooth transition between portrait ↔ landscape.

- Add a 200ms CSS transition on the root container
- Consider showing a brief "rotating..." overlay to prevent mis-taps during orientation change
- Or: add a lock button in settings that prevents orientation switch

---

### Tier 3 — NICE-TO-HAVE (pre-Pod polish)

#### M3.1: VU Meters (Mini)

- Thin horizontal bar below each waveform showing RMS level
- Reuse desktop VU meter logic, render as a 4px colored bar

#### M3.2: Master FX Toggle

- Single button per deck: cycle through the FX chain presets
- Show active FX name on the deck row

#### M3.3: Settings Panel (Mobile)

- Slide-up panel (reuse OverlayPanel) for basic settings:
  - Crossfader curve
  - Pitch range
  - Auto-BPM filter toggle
  - Pod enable (future)

#### M3.4: Track Swipe Actions

- Swipe right on a browser track → load to Deck A
- Swipe left → load to Deck B
- Replaces the tiny [A] [B] buttons with a natural gesture

#### M3.5: Waveform Overview

- Thin (8px) full-track overview bar above the scrolling waveform
- Shows playhead position in the full track at a glance
- Tap to jump to position

---

## PART 3: IMPLEMENTATION PRIORITY MATRIX

```
                    IMPACT
                    HIGH ─────────────────── LOW
            ┌────────────────┬──────────────────┐
  EFFORT    │  M0.1 Loader   │                  │
  LOW       │  M0.2 InitGate │  M2.2 Haptics    │
            │  M0.3 SafeArea │  M2.3 Press st.  │
            │  M1.3 Touch    │  M2.4 Time disp  │
            ├────────────────┼──────────────────┤
  EFFORT    │  M1.1 Landscape│  M2.1 PWA        │
  HIGH      │  M1.2 Portrait │  M2.5 Orient.    │
            │  M1.4 Pitch    │  M3.1-M3.5       │
            └────────────────┴──────────────────┘
```

**Suggested order:**

1. **M0.1** — File loader (unblocks everything)
2. **M0.2** — AudioContext gate (unblocks playback on iOS)
3. **M0.3** — Safe area insets (5 min fix, huge visual impact)
4. **M1.3** — Touch targets (quick pass on all buttons)
5. **M1.1** — Landscape redesign
6. **M1.2** — Portrait redesign
7. **M1.4** — Pitch/nudge
8. **M2.4** — Time display
9. **M2.3** — Press states
10. **M2.1** — PWA
11. **M2.2** — Haptics expansion
12. Rest of Tier 3

**Estimated scope:** Tier 0 = 1 session. Tier 1 = 2-3 sessions. Tier 2 = 1-2 sessions. Tier 3 = ongoing.

---

*This audit covers the MIXI mobile UI as of 2026-04-08. Pod mobile (Guest PWA) is a separate scope that depends on this foundation being solid first.*
