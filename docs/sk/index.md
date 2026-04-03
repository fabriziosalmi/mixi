---
layout: home
hero:
  name: "MixiDAW"
  text: "Deterministická zvuková pracovná stanica"
  tagline: "Profesionálne spracovanie WebAudio s nulovým oneskorením DSP, hardvérovo modelovanými signálovými reťazcami a inteligentnou automatizačnou vrstvou. Zadarmo pre umelcov. Otvorené podľa dizajnu."
  actions:
    - theme: brand
      text: Otvoriť webovú verziu
      link: /play
    - theme: alt
      text: Technická dokumentácia
      link: /guide/architecture
features:
  - title: "Deterministický DSP engine"
    details: "Plánovanie na časovej osi AudioContext s vyhladením τ=12ms. 3-pásmové analógovo modelované Kill-EQ, band-split skreslenie, paralelná kompresia, brickwall limiting vysielacej kvality. Nulový jitter."
  - title: "Inteligentná automatizácia"
    details: "Bezstavový arbiter s tickom 50ms nepretržite monitoruje fázové zarovnanie, spektrálne konflikty a headroom. Korekčné akcie ako transparentné Ghost Mutations."
  - title: "Modulárna architektúra"
    details: "Plne oddelená zbernica step-sekvenceru, skinning riadený CSS premennými a otvorené rozhranie pluginov pre komunitné nástroje."
---

<div class="hero-showcase"><div class="showcase-glow"></div><div class="showcase-frame"><img src="/screenshot.png" alt="Rozhranie MixiDAW" /><div class="showcase-reflection"></div></div><div class="showcase-caption"><span class="caption-dot"></span><span>Živé rozhranie — Dvojitý deck + Integrovaný groovebox</span></div></div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Vzork. frekvencia</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms Oneskorenie DSP</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI intentov</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Frekvencia ticku</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Externé audio závislosti</span></div>
</div>

<div class="manifesto-section"><div class="manifesto-inner">
  <h2 class="manifesto-title">Otvorené jadro. Sloboda hrať. Ochrana pred zneužitím.</h2>
  <p class="manifesto-text">MixiDAW funguje pod licenciou <strong>PolyForm Noncommercial 1.0.0</strong>. Kompletný zdrojový kód je k dispozícii na inšpekciu, úpravy a nekomerčné použitie.</p>
  <div class="manifesto-links">
    <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Zdrojový kód na GitHube</a>
    <a href="/sk/guide/architecture" class="manifesto-link manifesto-link-alt">Prečítať kompletný dokument architektúry →</a>
  </div>
</div></div>
