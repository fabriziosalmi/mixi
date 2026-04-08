# Contributing to MIXI

Thank you for considering contributing to MIXI. This document explains the process and expectations for contributions.

## Licensing

MIXI is licensed under the **PolyForm Noncommercial License 1.0.0**. All contributions are subject to the [Contributor License Agreement (CLA)](CLA.md).

When you open your first Pull Request, a bot will ask you to sign the CLA by posting a comment. This is a one-time requirement. By signing, you grant MIXI an unrestricted license to use your contribution in both open-source and commercial contexts, while you retain full ownership of your work.

Note: the companion repository [mixi-decks](https://github.com/fabriziosalmi/mixi-decks) is licensed under MIT.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies: `npm install`
3. Start the development server: `npm run dev:ui`
4. Run the test suite: `npm test` (555 unit tests, ~2.5s)
5. Run the BPM/sync bench: `npm run bench`

## Development Workflow

1. Create a branch from `main` with a descriptive name (`fix/octave-doubling`, `feat/midi-learn`).
2. Make your changes. Follow existing code patterns and conventions.
3. Write or update tests for any changed behavior.
4. Ensure `npm test` passes (a pre-commit hook enforces this).
5. Open a Pull Request against `main`.

## Code Standards

- **TypeScript**: strict mode, no `any` except where documented.
- **CSS**: vanilla CSS with custom properties. No Tailwind utility classes in components.
- **Tests**: vitest for unit tests, Playwright for E2E. Minimum: cover the happy path and one edge case.
- **Audio**: never call AudioContext methods from React components. Use the `useMixiSync` bridge.
- **Performance**: waveform rendering, VU meters, and phase overlay bypass React reconciliation via direct DOM writes.

## What We Accept

- Bug fixes with a test that reproduces the bug.
- New effects, instruments, or deck modes via the plugin architecture.
- New skins (copy any `skins/skin-*/` directory and modify the CSS variables).
- Documentation improvements and translations.
- BPM detection accuracy improvements backed by bench results.

## What Needs Discussion First

Open a [Discussion](https://github.com/fabriziosalmi/mixi/discussions) or issue before working on:

- Architectural changes (state management, audio graph, build system).
- New dependencies.
- Changes to the sync protocol or PLL tuning.
- Features that affect the default user experience.

## Reporting Bugs

Use the [bug report template](https://github.com/fabriziosalmi/mixi/issues/new?template=bug_report.yml). Include:

- Steps to reproduce.
- Platform and browser.
- MIXI version.
- Console errors or screenshots.

## Response Times

This is a solo-maintained project. Pull request reviews may take a few days. If you have not received a response within a week, feel free to leave a polite comment.

## Thank You

Every contribution makes MIXI better for artists, hobbyists, and researchers worldwide.
