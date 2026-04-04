---
layout: home
hero:
  name: "MixiDAW"
  text: "Детерминированная аудиостанция"
  tagline: "Профессиональная обработка WebAudio с нулевой задержкой DSP, аппаратно-моделированными сигнальными цепями и интеллектуальным слоем автоматизации. Бесплатно для артистов. Открыто по замыслу."
  actions:
    - theme: brand
      text: Открыть веб-версию
      link: /app/
    - theme: alt
      text: Техническая документация
      link: /guide/architecture
features:
  - title: "Детерминированный DSP-движок"
    details: "Планирование на временной шкале AudioContext со сглаживанием τ=12мс. 3-полосные аналоговые Kill-EQ, полосовое разделение дисторшна, параллельная компрессия, лимитирование вещательного класса. Нулевой джиттер."
  - title: "Интеллектуальная автоматизация"
    details: "Безсостоятельный арбитр с тиком 50мс непрерывно мониторит фазовое выравнивание, спектральные конфликты и запас по уровню. Корректирующие действия выполняются как прозрачные Ghost Mutation."
  - title: "Модульная архитектура"
    details: "Полностью развязанная шина степ-секвенсора, скиннинг через CSS-переменные и открытый плагинный интерфейс для инструментов сообщества. Форкай, стилизуй, расширяй."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="Интерфейс MixiDAW" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Интерфейс в реальном времени — Два дека + Встроенный грувбокс</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">кГц Частота дискр.</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">мс Задержка DSP</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">ИИ-интентов</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Гц Частота тика</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Внешних аудио-зав.</span></div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Открытое ядро. Свобода играть. Защита от эксплуатации.</h2>
    <p class="manifesto-text">MixiDAW работает по лицензии <strong>PolyForm Noncommercial 1.0.0</strong>. Полный исходный код доступен для изучения, модификации и некоммерческого использования. Артисты, любители и исследователи имеют неограниченный доступ. Корпоративная упаковка, SaaS-развёртывание и коммерческое перераспределение требуют явной лицензии.</p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Исходный код на GitHub</a>
      <a href="/ru/guide/architecture" class="manifesto-link manifesto-link-alt">Полный документ архитектуры →</a>
    </div>
  </div>
</div>
