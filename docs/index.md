---
layout: home

hero:
  name: "MIXI DAW"
  text: "Deterministic Audio Workstation"
  tagline: "Professional-grade WebAudio processing with zero-latency DSP, hardware-modeled signal chains, and an intelligent automation layer. Free for artists. Open by design."
  actions:
    - theme: brand
      text: Open Web Version
      link: /play
    - theme: alt
      text: Technical Documentation
      link: /guide/architecture

features:
  - title: "Deterministic DSP Engine"
    details: "AudioContext timeline scheduling with τ=12ms smoothing. 3-band analog-modeled Kill-EQs, band-split distortion, parallel compression, and broadcast-grade brickwall limiting. Zero jitter."
  - title: "Intelligent Automation"
    details: "A stateless 50ms tick arbiter continuously monitors phase alignment, spectral clashes, and headroom. Corrective actions execute as transparent Ghost Mutations — visible but non-intrusive."
  - title: "Modular Architecture"
    details: "Fully decoupled step-sequencer bus, CSS-variable driven skinning, and an open plugin interface for community-built instruments. Fork it, skin it, extend it."
---

<script setup>
import { onMounted } from 'vue'
import HomeIntro from './.vitepress/components/HomeIntro.vue'

onMounted(() => {
  const DELAY = 3200
  const TGT = 'MIXI DAW'
  const G = '░▒▓█▄▀■□▪▫●○◆◇⬡⬢⎔₪₫₮₰₳₵⌘⌥'
  const rg = () => G[Math.floor(Math.random() * G.length)]
  const ROUNDS = 20
  const MS = 45

  setTimeout(() => {
    const el = document.querySelector('.VPHero .main .name')
    if (!el) return
    el.classList.add('crumbling')

    const bld = (chars) => chars.map((c, i) => {
      if (c.ch === ' ') return '<span class="cr-ch">&nbsp;</span>'
      const ok = c.ok
      const clr = i <= 1
        ? (ok ? '#00f0ff' : 'rgba(0,240,255,0.3)')
        : i <= 3
          ? (ok ? '#ff6a00' : 'rgba(255,106,0,0.3)')
          : (ok ? 'rgba(235,235,245,0.55)' : 'rgba(235,235,245,0.15)')
      const sh = ok
        ? (i <= 1 ? '0 0 20px rgba(0,240,255,0.5)' : i <= 3 ? '0 0 20px rgba(255,106,0,0.5)' : 'none')
        : 'none'
      return `<span class="cr-ch" style="color:${clr};text-shadow:${sh}">${c.ch}</span>`
    }).join('')

    let chars = TGT.split('').map(c => ({ ch: c === ' ' ? ' ' : rg(), ok: c === ' ' }))
    el.innerHTML = bld(chars)

    let r = 0
    const iv = setInterval(() => {
      r++
      chars = TGT.split('').map((c, i) => {
        if (c === ' ') return { ch: ' ', ok: true }
        const settle = Math.floor((i / TGT.length) * ROUNDS * 0.55) + ROUNDS * 0.4
        return r >= settle ? { ch: c, ok: true } : { ch: rg(), ok: false }
      })
      el.innerHTML = bld(chars)
      if (r >= ROUNDS) {
        clearInterval(iv)
        el.innerHTML = 'MIXI DAW'
        el.classList.remove('crumbling')
      }
    }, MS)
  }, DELAY)
})
</script>

<HomeIntro />

<!-- ═══════════ HERO SCREENSHOT ═══════════ -->
<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="MixiDAW Interface" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Live Interface — Dual Deck + Integrated Groovebox</span>
  </div>
</div>

<!-- ═══════════ STATS ROW ═══════════ -->
<div class="stats-row">
  <div class="stat-item">
    <span class="stat-number">44.1 kHz</span>
    <span class="stat-label">Sample Rate</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">&lt;1</span>
    <span class="stat-label">ms DSP Latency</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">18</span>
    <span class="stat-label">AI Intents</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">20</span>
    <span class="stat-label">Hz Tick Rate</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">0</span>
    <span class="stat-label">External Deps</span>
  </div>
</div>

<!-- ═══════════ MANIFESTO ═══════════ -->
<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Open Core. Free to Play. No Exploitation.</h2>
    <p class="manifesto-text">
      MixiDAW operates under the <strong>PolyForm Noncommercial 1.0.0</strong> license. The complete source code is available for inspection, modification, and non-commercial use. Artists, hobbyists, and researchers have unrestricted access. Corporate packaging, SaaS deployment, and commercial redistribution require explicit licensing.
    </p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        View Source on GitHub
      </a>
      <a href="mailto:fabrizio.salmi@gmail.com?subject=Mixi%20Commercial%20Licensing" class="manifesto-link manifesto-link-commercial">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        Commercial Solutions
      </a>
    </div>
  </div>
</div>

<style>
/* ═══════════════════════════════════════════
   MixiDAW Homepage — Aerospace Enterprise
   ═══════════════════════════════════════════ */

/* ── Procedural Demask: page sections start invisible ── */
.VPHero,
.VPFeatures,
.hero-showcase,
.stats-row,
.manifesto-section {
  opacity: 0;
  transform: translateY(18px);
  animation: demaskIn 0.6s ease-out forwards;
  animation-play-state: paused;
}
/* Staggered delays — timed to appear as intro flash fades */
.VPHero              { animation-delay: 3.2s; }
.hero-showcase       { animation-delay: 3.5s; }
.VPFeatures          { animation-delay: 3.7s; }
.stats-row           { animation-delay: 3.4s; }
.manifesto-section   { animation-delay: 3.9s; }

/* Unpause once the page loads (intro overlay handles the timing) */
.VPHero,
.VPFeatures,
.hero-showcase,
.stats-row,
.manifesto-section {
  animation-play-state: running;
}

@keyframes demaskIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

:root {
  --vp-c-brand-1: #00d4ff;
  --vp-c-brand-2: #0090b8;
  --vp-c-brand-3: #7c3aed;
  --vp-c-bg: #050508;
  --vp-c-bg-soft: #0a0a10;
  --vp-c-bg-alt: #08080e;
  --vp-c-text-1: rgba(235, 235, 245, 0.92);
  --vp-c-text-2: rgba(235, 235, 245, 0.55);
  --vp-c-divider: rgba(255, 255, 255, 0.06);
  --vp-button-brand-bg: #00d4ff;
  --vp-button-brand-text: #000;
  --vp-button-brand-hover-bg: #00e8ff;
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: none;
  --vp-home-hero-image-background-image: none;
  --vp-home-hero-image-filter: none;
}

/* ── Global dark enforcement ── */
.VPHome { background: #050508 !important; }
.VPNav { backdrop-filter: blur(12px) saturate(180%) !important; }

/* ── Hero MIXI DAW title ── */
.VPHero .main .name {
  font-weight: 800;
  letter-spacing: 0.06em;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace !important;
}

/* During JS crumble: disable gradient, let span colors show */
.VPHero .main .name.crumbling {
  -webkit-text-fill-color: unset !important;
  background: none !important;
}
.VPHero .main .name .cr-ch {
  display: inline-block;
  min-width: 0.6em;
  text-align: center;
  transition: color 0.08s, text-shadow 0.15s;
}

/* Paint MI cyan + XI orange + DAW dim on .name.clip */
.VPHero .main .name.clip {
  background: linear-gradient(90deg, #00f0ff 0%, #00f0ff 25%, #ff6a00 25%, #ff6a00 50%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.12) 55%, rgba(235,235,245,0.55) 55%, rgba(235,235,245,0.55) 100%) !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
}
.VPHero .main .text {
  font-weight: 300;
  letter-spacing: 0.5px;
  color: rgba(235, 235, 245, 0.7);
}
.VPHero .main .tagline {
  font-size: 1.05rem;
  line-height: 1.7;
  color: rgba(235, 235, 245, 0.45);
  max-width: 520px;
}
/* Hide hero image slot — we use custom showcase */
.VPHero .image-container { display: none !important; }

/* ── Feature cards ── */
.VPFeature {
  background: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 8px !important;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}
.VPFeature:hover {
  border-color: rgba(0, 212, 255, 0.2) !important;
  box-shadow: 0 8px 32px rgba(0, 212, 255, 0.06);
}
.VPFeature .title {
  color: rgba(235, 235, 245, 0.92) !important;
  font-weight: 600;
  font-size: 1rem;
}
.VPFeature .details {
  color: rgba(235, 235, 245, 0.45) !important;
  line-height: 1.6;
}

/* ═══════════ HERO SHOWCASE ═══════════ */
.hero-showcase {
  position: relative;
  max-width: 960px;
  margin: -2rem auto 0;
  padding: 0 1.5rem;
}

.showcase-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80%;
  height: 70%;
  background: radial-gradient(ellipse, rgba(0, 212, 255, 0.08) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

.showcase-frame {
  position: relative;
  z-index: 1;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.3),
    0 20px 60px rgba(0, 0, 0, 0.5),
    0 4px 16px rgba(0, 0, 0, 0.3);
}

.showcase-frame img {
  display: block;
  width: 100%;
  height: auto;
}

.showcase-reflection {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    165deg,
    rgba(255, 255, 255, 0.04) 0%,
    transparent 40%,
    transparent 60%,
    rgba(0, 0, 0, 0.15) 100%
  );
  pointer-events: none;
}

.showcase-caption {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  justify-content: center;
  margin-top: 1rem;
  font-size: 0.8rem;
  color: rgba(235, 235, 245, 0.3);
  letter-spacing: 0.5px;
}

.caption-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00d4ff;
  box-shadow: 0 0 6px rgba(0, 212, 255, 0.5);
}

/* ═══════════ STATS ROW ═══════════ */
.stats-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  max-width: 800px;
  margin: 4rem auto;
  padding: 1.8rem 2rem;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}

.stat-number {
  font-size: 1.8rem;
  font-weight: 700;
  color: #00d4ff;
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 0.72rem;
  color: rgba(235, 235, 245, 0.35);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.stat-divider {
  width: 1px;
  height: 36px;
  background: rgba(255, 255, 255, 0.06);
}

/* ═══════════ MANIFESTO ═══════════ */
.manifesto-section {
  max-width: 720px;
  margin: 2rem auto 5rem;
  padding: 0 1.5rem;
}

.manifesto-inner {
  padding: 3rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
}

.manifesto-title {
  font-size: 1.4rem;
  font-weight: 600;
  color: rgba(235, 235, 245, 0.88);
  line-height: 1.4;
  margin-bottom: 1rem;
}

.manifesto-text {
  font-size: 0.95rem;
  line-height: 1.7;
  color: rgba(235, 235, 245, 0.4);
  max-width: 560px;
  margin: 0 auto;
}

.manifesto-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  margin-top: 2rem;
  flex-wrap: wrap;
}

.manifesto-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.2rem;
  font-size: 0.85rem;
  color: rgba(235, 235, 245, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  text-decoration: none;
  transition: all 0.25s ease;
}

.manifesto-link:hover {
  border-color: rgba(0, 212, 255, 0.3);
  color: #00d4ff;
  background: rgba(0, 212, 255, 0.04);
}

.manifesto-link-commercial {
  border-color: rgba(255, 106, 0, 0.25);
  color: rgba(255, 106, 0, 0.8);
}

.manifesto-link-commercial:hover {
  border-color: rgba(255, 106, 0, 0.5);
  color: #ff6a00;
  background: rgba(255, 106, 0, 0.06);
}
</style>