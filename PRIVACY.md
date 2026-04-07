# Privacy Policy

**Last updated:** April 7, 2026

## Overview

MIXI is a browser-based DJ application. Your privacy is respected by design.

## Data Collection

MIXI does **not** collect, transmit, or store any personal data on external servers.

### What is stored locally

| Data | Storage | Purpose | Retention |
|------|---------|---------|-----------|
| Track library metadata | IndexedDB | Library management | Until cleared by user |
| Audio file blobs | IndexedDB | Offline playback | Until cleared by user |
| Hot cues & loop points | localStorage | Session recall | Until cleared by user |
| Settings & preferences | localStorage (`mixi-settings`) | User preferences | Until cleared by user |
| Session snapshots | localStorage (`mixi-session`) | Save/restore mixer state | Until cleared by user |
| MIDI mappings | localStorage (`mixi-midi`) | Controller configuration | Until cleared by user |
| Custom skins | localStorage | Skin persistence | Until cleared by user |

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

MIXI includes an optional watermarking system for intellectual property protection:
- **UI fingerprint**: Invisible canvas overlay (sub-1% opacity)
- **Audio container metadata**: Build info appended to recording container (no audio samples modified)
- No watermark data is transmitted externally

## Third-Party Services

| Service | When | Data sent |
|---------|------|-----------|
| SoundCloud proxy | User pastes URL | The URL only |
| GitHub Releases API | Update check (opt-in) | None (public API read) |

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
