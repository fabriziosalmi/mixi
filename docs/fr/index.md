---
layout: home

hero:
  name: "MixiDAW"
  text: "Station de Travail Audio Déterministe"
  tagline: "Traitement WebAudio de qualité professionnelle avec DSP à latence nulle, chaînes de signal modélisées sur le matériel et une couche d'automatisation intelligente. Gratuit pour les artistes. Ouvert par conception."
  actions:
    - theme: brand
      text: Ouvrir la Version Web
      link: /app/
    - theme: alt
      text: Documentation Technique
      link: /guide/architecture

features:
  - title: "Moteur DSP Déterministe"
    details: "Ordonnancement sur la timeline AudioContext avec lissage τ=12ms. Kill-EQ analogiques 3 bandes, distorsion band-split, compression parallèle et limitation brickwall de qualité broadcast. Zéro jitter."
  - title: "Automatisation Intelligente"
    details: "Un arbitre sans état à tick de 50ms surveille en continu l'alignement de phase, les conflits spectraux et la marge dynamique. Les actions correctives s'exécutent comme des Ghost Mutations transparentes — visibles mais non intrusives."
  - title: "Architecture Modulaire"
    details: "Bus step-séquenceur entièrement découplé, habillage piloté par variables CSS et interface de plugins ouverte pour les instruments créés par la communauté. Forkez-le, personnalisez-le, étendez-le."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="Interface MixiDAW" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Interface Live — Double Deck + Groovebox Intégrée</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item">
    <span class="stat-number">44.1</span>
    <span class="stat-label">kHz Taux d'Échantillonnage</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">&lt;1</span>
    <span class="stat-label">ms Latence DSP</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">18</span>
    <span class="stat-label">Intents IA</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">20</span>
    <span class="stat-label">Hz Fréquence de Tick</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">0</span>
    <span class="stat-label">Dépendances Audio Externes</span>
  </div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Open Core. Libre de Jouer. Verrouillé Contre l'Exploitation.</h2>
    <p class="manifesto-text">
      MixiDAW fonctionne sous la licence <strong>PolyForm Noncommercial 1.0.0</strong>. Le code source complet est disponible pour l'inspection, la modification et l'utilisation non commerciale. Les artistes, amateurs et chercheurs ont un accès illimité. L'empaquetage commercial, le déploiement SaaS et la redistribution commerciale nécessitent une licence explicite.
    </p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        Voir le Code Source sur GitHub
      </a>
      <a href="/fr/guide/architecture" class="manifesto-link manifesto-link-alt">
        Lire le Document d'Architecture Complet →
      </a>
    </div>
  </div>
</div>
