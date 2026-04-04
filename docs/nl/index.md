---
layout: home
hero:
  name: "MixiDAW"
  text: "Deterministische Audio Werkstation"
  tagline: "Professionele WebAudio-verwerking met zero-latency DSP, hardware-gemodelleerde signaalketens en een intelligente automatiseringslaag. Gratis voor artiesten. Open by design."
  actions:
    - theme: brand
      text: Open Webversie
      link: /app/
    - theme: alt
      text: Technische Documentatie
      link: /guide/architecture
features:
  - title: "Deterministische DSP-engine"
    details: "AudioContext-timeline scheduling met τ=12ms smoothing. 3-bands analoog gemodelleerde Kill-EQ's, band-split distortion, parallelle compressie, broadcast-grade brickwall limiting. Nul jitter."
  - title: "Intelligente Automatisering"
    details: "Een stateless 50ms tick-arbiter monitort continu fase-uitlijning, spectrale conflicten en headroom. Correctieve acties worden uitgevoerd als transparante Ghost Mutations."
  - title: "Modulaire Architectuur"
    details: "Volledig ontkoppelde step-sequencer bus, CSS-variabelen gestuurde skinning en open plugin-interface voor community-instrumenten. Fork het, skin het, breid het uit."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="MixiDAW Interface" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Live Interface — Dual Deck + Geïntegreerde Groovebox</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Samplerate</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms DSP-latentie</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI-intents</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Tick-rate</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Externe audio-deps</span></div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Open Core. Vrij om te Spelen. Beschermd Tegen Uitbuiting.</h2>
    <p class="manifesto-text">MixiDAW opereert onder de <strong>PolyForm Noncommercial 1.0.0</strong>-licentie. De volledige broncode is beschikbaar voor inspectie, wijziging en niet-commercieel gebruik. Artiesten, hobbyisten en onderzoekers hebben onbeperkte toegang. Commerciële verpakking, SaaS-implementatie en commerciële herdistributie vereisen een expliciete licentie.</p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Broncode op GitHub</a>
      <a href="/nl/guide/architecture" class="manifesto-link manifesto-link-alt">Volledig architectuurdocument lezen →</a>
    </div>
  </div>
</div>
