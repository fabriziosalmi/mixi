---
layout: home
hero:
  name: "MixiDAW"
  text: "Deterministisk Ljudarbetsstation"
  tagline: "Professionell WebAudio-bearbetning med noll-latens DSP, hårdvarumodellerade signalkedjor och ett intelligent automatiseringslager. Gratis för artister. Öppet designat."
  actions:
    - theme: brand
      text: Öppna Webbversion
      link: /play
    - theme: alt
      text: Teknisk Dokumentation
      link: /guide/architecture
features:
  - title: "Deterministisk DSP-motor"
    details: "AudioContext-tidslinjeschemaläggning med τ=12ms utjämning. 3-bands analogmodellerade Kill-EQ, bandsplit-distortion, parallellkompression, sändningskvalitet brickwall-limitering. Noll jitter."
  - title: "Intelligent Automatisering"
    details: "En tillståndslös 50ms tick-arbiter övervakar kontinuerligt fasjustering, spektralkonflikter och headroom. Korrigerande åtgärder utförs som transparenta Ghost Mutations."
  - title: "Modulär Arkitektur"
    details: "Fullständigt frikopplad step-sequencer-buss, CSS-variabelstyrd skinning och öppet plugingränssnitt för communityinstrument. Forka, skinna, utöka."
---

<div class="hero-showcase"><div class="showcase-glow"></div><div class="showcase-frame"><img src="/screenshot.png" alt="MixiDAW Gränssnitt" /><div class="showcase-reflection"></div></div><div class="showcase-caption"><span class="caption-dot"></span><span>Livegränssnitt — Dubbelt deck + Integrerad Groovebox</span></div></div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Samplingsfrekvens</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms DSP-latens</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI-intents</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Tick-frekvens</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Externa ljudberoenden</span></div>
</div>

<div class="manifesto-section"><div class="manifesto-inner">
  <h2 class="manifesto-title">Öppen Kärna. Fri att Spela. Skyddad Mot Exploatering.</h2>
  <p class="manifesto-text">MixiDAW drivs under <strong>PolyForm Noncommercial 1.0.0</strong>-licensen. Fullständig källkod finns tillgänglig för granskning, modifiering och icke-kommersiellt bruk. Artister, hobbyister och forskare har obegränsad åtkomst. Företagspaketering, SaaS-distribution och kommersiell omdistribution kräver uttrycklig licens.</p>
  <div class="manifesto-links">
    <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Källkod på GitHub</a>
    <a href="/sv/guide/architecture" class="manifesto-link manifesto-link-alt">Läs fullständigt arkitekturdokument →</a>
  </div>
</div></div>
