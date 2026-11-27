---
layout: home

hero:
  name: "MIXI"
  text: "Deterministic Audio Workstation"
  tagline: "Browser-native DJ engine powered by an 83 KB Rust/Wasm true stereo DSP pipeline, stereo-linked predictive ISP limiting, and deterministic automation. Zero install. Open core."
  actions:
    - theme: brand
      text: Launch Web App
      link: https://fabriziosalmi.github.io/mixi/app/
    - theme: alt
      text: Technical Docs
      link: /guide/architecture

features:
  - title: "Rust/Wasm Stereo DSP"
    details: "True stereo 4-in/2-out engine compiled to an 83 KB Wasm binary with zero host imports and SIMD128. 3-band LR4 isolator EQ, resonant filters, parallel compression, band-split distortion, and stereo-linked predictive ISP limiting in 20.5 µs."
  - title: "Deterministic Automation"
    details: "A stateless 50 ms tick arbiter monitors beatgrid phase alignment, spectral clash, and master headroom. Corrective actions execute as transparent Ghost Mutations you can inspect or override at any time."
  - title: "Modular & Hardware-Ready"
    details: "Built-in Groovebox and TurboBass acid synth, 17 CSS-variable skins, WebMIDI controller mapping, native 48 kHz AudioContext support, and Electron desktop builds for macOS, Windows, and Linux."
---

<VerifiedSpecs />

<DownloadStrip />

<ReleaseManifesto />
