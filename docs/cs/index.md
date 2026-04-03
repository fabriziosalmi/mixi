---
layout: home
hero:
  name: "MixiDAW"
  text: "Deterministická zvuková pracovní stanice"
  tagline: "Profesionální zpracování WebAudio s nulovým zpožděním DSP, hardwarově modelovanými signálovými řetězci a inteligentní automatizační vrstvou. Zdarma pro umělce. Otevřené od návrhu."
  actions:
    - theme: brand
      text: Otevřít webovou verzi
      link: /play
    - theme: alt
      text: Technická dokumentace
      link: /guide/architecture
features:
  - title: "Deterministický DSP engine"
    details: "Plánování na časové ose AudioContext s vyhlazováním τ=12ms. 3-pásmové analogově modelované Kill-EQ, band-split zkreslení, paralelní komprese, brickwall limiting vysílací kvality. Nulový jitter."
  - title: "Inteligentní automatizace"
    details: "Bezstavový arbitr s tickem 50ms nepřetržitě monitoruje fázové zarovnání, spektrální konflikty a headroom. Korekční akce jako transparentní Ghost Mutations."
  - title: "Modulární architektura"
    details: "Plně oddělená sběrnice step-sekvenceru, skinning řízený CSS proměnnými a otevřené rozhraní pluginů pro komunitní nástroje."
---

<div class="hero-showcase"><div class="showcase-glow"></div><div class="showcase-frame"><img src="/screenshot.png" alt="Rozhraní MixiDAW" /><div class="showcase-reflection"></div></div><div class="showcase-caption"><span class="caption-dot"></span><span>Živé rozhraní — Dvojitý deck + Integrovaný groovebox</span></div></div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Vzork. frekvence</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms Zpoždění DSP</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI intentů</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Frekvence ticku</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Externí audio závislosti</span></div>
</div>

<div class="manifesto-section"><div class="manifesto-inner">
  <h2 class="manifesto-title">Otevřené jádro. Svoboda hrát. Ochrana proti zneužití.</h2>
  <p class="manifesto-text">MixiDAW funguje pod licencí <strong>PolyForm Noncommercial 1.0.0</strong>. Kompletní zdrojový kód je k dispozici pro inspekci, úpravy a nekomerční použití.</p>
  <div class="manifesto-links">
    <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Zdrojový kód na GitHubu</a>
    <a href="/cs/guide/architecture" class="manifesto-link manifesto-link-alt">Přečíst kompletní dokument architektury →</a>
  </div>
</div></div>
