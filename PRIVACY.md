# Privacy Policy

**Last updated:** April 7, 2026

## Overview

MIXI is a browser-based DJ application. Your privacy is respected by design.

## Data Collection

MIXI does **not** collect, transmit, or store any personal data on external servers.

### What is stored locally

| Data | Storage | Key | Retention |
|------|---------|-----|-----------|
| Track library metadata | IndexedDB | `MixiTrackDB` | Until cleared by user |
| Audio file blobs | IndexedDB | `MixiTrackDB.audio` | Until cleared by user |
| Sample pad buffers | IndexedDB | `MixiSampleDB.samples` | Until cleared by user |
| Mixer preferences | localStorage | `mixi-prefs` | Until cleared by user |
| App settings | localStorage | `mixi-settings` | Until cleared by user |
| Browser/library state | localStorage | `mixi-browser` | Until cleared by user |
| Session snapshots | localStorage | `mixi-sessions` | Until cleared by user |
| Hot cues per track | localStorage | `mixi_hotcues` | Until cleared by user |
| MIDI mappings | localStorage | `mixi-midi-bindings` | Until cleared by user |
| Playlists | localStorage | `mixi-playlists` | Until cleared by user |
| Onboarding flag | localStorage | `mixi-onboarding-done` | Boolean, permanent |

### What is NOT collected

- No analytics or telemetry
- No crash reports sent externally
- No usage tracking
- No cookies (except browser-native storage)
- No third-party SDKs or tracking scripts
- No network requests except: SoundCloud URL proxy (user-initiated), GitHub update check (opt-in)

## Audio Recordings

Mix recordings are stored **locally only** — on your filesystem (Electron) or as browser downloads (web). MIXI does not upload recordings anywhere.

## Audio Watermarking

MIXI includes a three-tier watermarking system for intellectual property protection:
- **Tier 1 — UI fingerprint**: Invisible canvas overlay at 0.8% opacity. The fingerprint hash is derived from `navigator.userAgent` and screen dimensions. This hash is stored in-memory only and never transmitted externally.
- **Tier 2 — Code fingerprint**: Zero-Width Character (ZWC) steganography may be embedded in compiled CSS and skin files at build time. This identifies the build version, not individual users. Invisible in editors and browsers.
- **Tier 3 — Audio container metadata**: Build and session metadata appended to exported recording containers. No audio samples are modified — the watermark exists in the container metadata layer only.

All three tiers operate independently. **No watermark data is transmitted externally.** The fingerprint inputs (user agent, screen size) are hashed locally and never sent to any server.

## Third-Party Services

| Service | When | Data sent |
|---------|------|-----------|
| SoundCloud proxy | User pastes URL | The URL only (resolved via yt-dlp on local backend) |
| GitHub Releases API | Automatic on Electron app launch | App version in User-Agent header (standard HTTP, no user ID) |

The GitHub update check runs automatically in the Electron desktop app on launch. It contacts the public GitHub API (`api.github.com/repos/fabriziosalmi/mixi/releases/latest`) with no authentication. Users can skip specific versions. The web browser version does not perform update checks.

## Children's Privacy

MIXI does not knowingly collect data from anyone, including children under 13.

## Your Rights

All data is stored locally on your device. You have full control:
- **View**: Inspect via browser DevTools (Application → Storage)
- **Export**: Session save feature exports mixer state as JSON
- **Delete**: Clear browser data or use Settings → Reset

## Contact

For privacy questions: fabrizio.salmi@gmail.com

## Changes

This policy may be updated. Changes will be noted in the CHANGELOG.
