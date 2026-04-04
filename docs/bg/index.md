---
layout: home
hero:
  name: "MixiDAW"
  text: "Детерминистична аудио работна станция"
  tagline: "Професионална WebAudio обработка с нулева латентност DSP, хардуерно моделирани сигнални вериги и интелигентен слой за автоматизация. Безплатно за артисти. Отворено по дизайн."
  actions:
    - theme: brand
      text: Отвори уеб версия
      link: /app/
    - theme: alt
      text: Техническа документация
      link: /guide/architecture
features:
  - title: "Детерминистичен DSP двигател"
    details: "Планиране по времевата линия на AudioContext с изглаждане τ=12ms. 3-лентови аналогово моделирани Kill-EQ, лентово разделена дисторшън, паралелна компресия, brickwall ограничител. Нулев джитър."
  - title: "Интелигентна автоматизация"
    details: "Безсъстоятелен арбитър с тик от 50ms непрекъснато наблюдава фазовото подравняване, спектралните конфликти и динамичния запас. Коригиращи действия като прозрачни Ghost Mutations."
  - title: "Модулна архитектура"
    details: "Напълно отделена шина за step-секвенсър, скининг чрез CSS променливи и отворен интерфейс за плъгини за инструменти на общността."
---

<div class="hero-showcase"><div class="showcase-glow"></div><div class="showcase-frame"><img src="/screenshot.png" alt="Интерфейс на MixiDAW" /><div class="showcase-reflection"></div></div><div class="showcase-caption"><span class="caption-dot"></span><span>Интерфейс на живо — Двоен дек + Интегриран грувбокс</span></div></div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Честота на семпл.</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms DSP латентност</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI интенции</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Честота на тик</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Външни аудио зависим.</span></div>
</div>

<div class="manifesto-section"><div class="manifesto-inner">
  <h2 class="manifesto-title">Отворено ядро. Свобода да свириш. Защита от експлоатация.</h2>
  <p class="manifesto-text">MixiDAW работи под лиценза <strong>PolyForm Noncommercial 1.0.0</strong>. Пълният изходен код е достъпен за инспекция, модификация и некомерсиална употреба.</p>
  <div class="manifesto-links">
    <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Изходен код в GitHub</a>
    <a href="/bg/guide/architecture" class="manifesto-link manifesto-link-alt">Прочетете пълния архитектурен документ →</a>
  </div>
</div></div>
