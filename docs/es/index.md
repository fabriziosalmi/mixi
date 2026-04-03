---
layout: home

hero:
  name: "MixiDAW"
  text: "Estación de Trabajo de Audio Determinista"
  tagline: "Procesamiento WebAudio de grado profesional con DSP de latencia cero, cadenas de señal modeladas en hardware y una capa de automatización inteligente. Gratuito para artistas. Abierto por diseño."
  actions:
    - theme: brand
      text: Abrir Versión Web
      link: /play
    - theme: alt
      text: Documentación Técnica
      link: /guide/architecture

features:
  - title: "Motor DSP Determinista"
    details: "Programación en línea de tiempo AudioContext con suavizado τ=12ms. Kill-EQ analógicos de 3 bandas, distorsión band-split, compresión paralela y limitación brickwall de grado broadcast. Cero jitter."
  - title: "Automatización Inteligente"
    details: "Un árbitro sin estado con tick de 50ms monitorea continuamente la alineación de fase, los conflictos espectrales y el headroom. Las acciones correctivas se ejecutan como Ghost Mutations transparentes — visibles pero no intrusivas."
  - title: "Arquitectura Modular"
    details: "Bus de step-sequencer completamente desacoplado, skinning controlado por variables CSS e interfaz de plugins abierta para instrumentos creados por la comunidad. Forkéalo, personalízalo, extiéndelo."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="Interfaz MixiDAW" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Interfaz en Vivo — Dual Deck + Groovebox Integrado</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item">
    <span class="stat-number">44.1</span>
    <span class="stat-label">kHz Tasa de Muestreo</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">&lt;1</span>
    <span class="stat-label">ms Latencia DSP</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">18</span>
    <span class="stat-label">Intents de IA</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">20</span>
    <span class="stat-label">Hz Tasa de Tick</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">0</span>
    <span class="stat-label">Deps de Audio Externas</span>
  </div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Open Core. Libre para Tocar. Blindado Contra la Explotación.</h2>
    <p class="manifesto-text">
      MixiDAW opera bajo la licencia <strong>PolyForm Noncommercial 1.0.0</strong>. El código fuente completo está disponible para inspección, modificación y uso no comercial. Artistas, aficionados e investigadores tienen acceso sin restricciones. El empaquetado corporativo, el despliegue SaaS y la redistribución comercial requieren licencia explícita.
    </p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        Ver Código Fuente en GitHub
      </a>
      <a href="/es/guide/architecture" class="manifesto-link manifesto-link-alt">
        Leer Documento de Arquitectura Completo →
      </a>
    </div>
  </div>
</div>
