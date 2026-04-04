---
layout: home
hero:
  name: "MixiDAW"
  text: "Deterministyczna Stacja Audio"
  tagline: "Profesjonalne przetwarzanie WebAudio z zerowym opóźnieniem DSP, sprzętowo modelowanymi łańcuchami sygnału i inteligentną warstwą automatyzacji. Darmowe dla artystów. Otwarte z założenia."
  actions:
    - theme: brand
      text: Otwórz Wersję Web
      link: /app/
    - theme: alt
      text: Dokumentacja Techniczna
      link: /guide/architecture
features:
  - title: "Deterministyczny Silnik DSP"
    details: "Planowanie na osi czasu AudioContext z wygładzaniem τ=12ms. 3-pasmowe Kill-EQ modelowane analogowo, zniekształcenie dzielone pasmowo, kompresja równoległa, limitowanie brickwall klasy broadcast. Zero jittera."
  - title: "Inteligentna Automatyzacja"
    details: "Bezstanowy arbiter z tickiem 50ms w sposób ciągły monitoruje wyrównanie fazy, konflikty spektralne i zapas dynamiczny. Działania korekcyjne wykonywane jako przezroczyste Ghost Mutations."
  - title: "Architektura Modularna"
    details: "W pełni oddzielona magistrala step-sekwencera, skinning oparty na zmiennych CSS i otwarty interfejs wtyczek dla instrumentów społeczności. Forkuj, stylizuj, rozszerzaj."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="Interfejs MixiDAW" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Interfejs na żywo — Podwójny deck + Zintegrowany groovebox</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Częstotliwość próbk.</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms Opóźnienie DSP</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">Intencji AI</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Częstotliwość ticka</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Zewnętrzne zależności audio</span></div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Otwarte Jądro. Wolność Grania. Ochrona Przed Eksploatacją.</h2>
    <p class="manifesto-text">MixiDAW działa na licencji <strong>PolyForm Noncommercial 1.0.0</strong>. Pełny kod źródłowy jest dostępny do inspekcji, modyfikacji i użytku niekomercyjnego. Artyści, hobbyści i badacze mają nieograniczony dostęp. Pakowanie korporacyjne, wdrożenia SaaS i redystrybucja komercyjna wymagają wyraźnej licencji.</p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Kod źródłowy na GitHub</a>
      <a href="/pl/guide/architecture" class="manifesto-link manifesto-link-alt">Pełny dokument architektury →</a>
    </div>
  </div>
</div>
