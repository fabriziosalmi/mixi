---
layout: home

hero:
  name: "MixiDAW"
  text: "Deterministische Audio-Workstation"
  tagline: "Professionelle WebAudio-Verarbeitung mit latenzfreiem DSP, hardwaremodellierten Signalketten und einer intelligenten Automatisierungsschicht. Kostenlos für Künstler. Offen konzipiert."
  actions:
    - theme: brand
      text: Web-Version Öffnen
      link: /play
    - theme: alt
      text: Technische Dokumentation
      link: /guide/architecture

features:
  - title: "Deterministischer DSP-Motor"
    details: "AudioContext-Timeline-Scheduling mit τ=12ms Glättung. 3-Band-Kill-EQs nach analogem Vorbild, Band-Split-Verzerrung, Parallelkompression und Broadcast-taugliche Brickwall-Limitierung. Null Jitter."
  - title: "Intelligente Automatisierung"
    details: "Ein zustandsloser 50ms-Tick-Arbiter überwacht kontinuierlich Phasenausrichtung, spektrale Konflikte und Headroom. Korrektive Aktionen werden als transparente Ghost Mutations ausgeführt — sichtbar, aber nicht invasiv."
  - title: "Modulare Architektur"
    details: "Vollständig entkoppelter Step-Sequencer-Bus, CSS-Variablen-gesteuertes Skinning und eine offene Plugin-Schnittstelle für Community-Instrumente. Forke es, gestalte es, erweitere es."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="MixiDAW Oberfläche" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Live-Oberfläche — Dual Deck + Integrierte Groovebox</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item">
    <span class="stat-number">44.1</span>
    <span class="stat-label">kHz Abtastrate</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">&lt;1</span>
    <span class="stat-label">ms DSP-Latenz</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">18</span>
    <span class="stat-label">KI-Intents</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">20</span>
    <span class="stat-label">Hz Tick-Rate</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">0</span>
    <span class="stat-label">Externe Audio-Abhängigkeiten</span>
  </div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Open Core. Frei zum Spielen. Geschützt gegen Ausbeutung.</h2>
    <p class="manifesto-text">
      MixiDAW steht unter der <strong>PolyForm Noncommercial 1.0.0</strong>-Lizenz. Der vollständige Quellcode ist zur Einsicht, Modifikation und nicht-kommerziellen Nutzung verfügbar. Künstler, Hobbyisten und Forscher haben uneingeschränkten Zugang. Kommerzielle Verpackung, SaaS-Deployment und kommerzielle Weiterverbreitung erfordern eine explizite Lizenz.
    </p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        Quellcode auf GitHub ansehen
      </a>
      <a href="/de/guide/architecture" class="manifesto-link manifesto-link-alt">
        Vollständiges Architekturdokument lesen →
      </a>
    </div>
  </div>
</div>
