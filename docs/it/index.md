---
layout: home
showcaseCaption: "Interfaccia Live · Dual Deck + Groovebox · 48 kHz Stereo"

hero:
  name: "MIXI"
  text: "Workstation Audio Deterministica"
  tagline: "Motore DJ nativo nel browser con pipeline DSP true stereo in Rust/Wasm da 83 KB, limiter predittivo ISP stereo-linked e automazione deterministica. Zero installazione. Open core."
  actions:
    - theme: brand
      text: Apri la Versione Web
      link: https://fabriziosalmi.github.io/mixi/app/
    - theme: alt
      text: Documentazione Tecnica
      link: /guide/architecture

features:
  - title: "Motore DSP Stereo Rust/Wasm"
    details: "Motore true stereo 4-in/2-out compilato in un binario Wasm da 83 KB con zero import e SIMD128. Isolator EQ LR4 a 3 bande, filtri risonanti, compressione parallela, distorsione band-split e limiting predittivo ISP in 20.5 µs."
  - title: "Automazione Deterministica"
    details: "Un arbitro stateless a tick di 50 ms monitora allineamento di fase della beatgrid, conflitti spettrali e headroom master. Le azioni correttive vengono eseguite come Ghost Mutation trasparenti, sempre ispezionabili."
  - title: "Modulare e Pronto per l'Hardware"
    details: "Groovebox e synth acido TurboBass integrati, 17 skin via variabili CSS, mappatura WebMIDI, supporto nativo AudioContext a 48 kHz e build desktop Electron per macOS, Windows e Linux."
---

<VerifiedSpecs />

<DownloadStrip />

<ReleaseManifesto title="Open Core. Libero da Suonare. Blindato Contro lo Sfruttamento." text="MIXI opera sotto la licenza PolyForm Noncommercial 1.0.0. Il codice sorgente completo è disponibile per ispezione, modifica e uso non commerciale. Artisti, hobbisti e ricercatori hanno accesso illimitato. Il packaging aziendale, il deployment SaaS e la redistribuzione commerciale richiedono una licenza esplicita." />
