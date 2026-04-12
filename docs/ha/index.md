---
layout: home
hero:
  name: "MixiDAW"
  text: "Tashar Aiki ta Sauti Mai Tabbaci"
  tagline: "Sarrafa WebAudio na ingancin ƙwararru tare da DSP maras jinkiri, sarƙoƙin sigina da aka ƙirƙira akan kayan aiki, da mataki na wayar da kai mai hankali. Kyauta ga masu fasaha. Buɗe ta hanyar ƙira."
  actions:
    - theme: brand
      text: Buɗe Sigar Yanar Gizo
      link: /app/
    - theme: alt
      text: Takardun Fasaha
      link: /guide/architecture
features:
  - title: "Injin DSP Mai Tabbaci"
    details: "Tsara lokaci na AudioContext tare da santsi na τ=12ms. Kill-EQ na bandi 3, murdiya ta rarraba bandi, matsa lamba daidaitawa, iyakance brickwall. Jitter sifili."
  - title: "Wayar da Kai Mai Hankali"
    details: "Mai sulhu maras yanayi tare da tik na 50ms yana saka ido kan daidaiton lokaci, rikicin bakan gizo da headroom. Ayyukan gyara suna aiki a matsayin Ghost Mutations masu gaskiya."
  - title: "Ginin Tsari na Sassa"
    details: "Bas ɗin step-sequencer da aka ware gaba ɗaya, tsarin fata ta hanyar masu canji na CSS da ƙofar plugin buɗaɗɗe don kayan aikin al'umma."
---

<script setup>
import { onMounted } from 'vue'
import HomeIntro from '../.vitepress/components/HomeIntro.vue'

onMounted(() => {
  const DELAY = 3200
  const TGT = 'MIXI DAW'
  const G = '░▒▓█▄▀■□▪▫●○◆◇⬡⬢⎔₪₫₮₰₳₵⌘⌥'
  const rg = () => G[Math.floor(Math.random() * G.length)]
  const ROUNDS = 20
  const MS = 45

  // ── D·A·W subtitle cycle pool ──
  const DAW_POOL = [
    'Deterministic Audio Workstation',
    'Dynamic Audio Workflow',
    'Direct Audio Waves',
    'Digital Art Web',
    'Deploy Audio Wasm',
    'Decentralized Audio Window',
    'Deep Acoustic Worlds',
    'Discover Audio Wonders',
    'Design Abstract Waveforms',
    'Develop Advanced Workstations',
    'Drive Audio Web',
    'Draft Audio Works',
    'Decode Audio Wavelength',
    'Deliver Absolute Wonderfulness',
    'Distribute Audio Wealth',
    'Devise Audio Worlds',
    'Dual Arbiter Workflow',
    'Dream Audio Worlds',
    'Direct Audio Workspace',
    'Dynamic Acoustic Workstation',
    'Digital Audio Wizards',
    'Decentralized Art Web',
    'Deep Audio Wisdom',
    'Discover Abstract Waves',
    'Design Audio Web',
    'Develop Audio Workflows',
    'Drive Acoustic Waves',
    'Draft Advanced Waveforms',
    'Decode Advanced Waves',
    'Distribute Art Web',
    'Devise Abstract Worlds',
    'Dual Autonomous Workstation',
    'Definitive Audio Web',
    'Dream Art Worlds',
    'Direct Audio Wasm',
    'Dynamic Art Workflow',
    'Digital Acoustic Waves',
    'Deterministic Arbiter Workflow',
    'Dynamic Automation Wasm',
    'Direct Automation Workflow',
    'Digital Audio Warp',
    'Deep Automation Worlds',
    'Deploy Automation Workflows',
    'Discover Automated Wonders',
    'Design Automation Waveforms',
    'Drive Automated Web',
    'Deliver Automated Workflow',
    'Dual Automation Workstation',
    'Definitive Automation Web',
    'Dream Automation Worlds',
    'Design Awesome Waveforms',
  ]

  // Shuffle pool once at page load
  for (let i = DAW_POOL.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [DAW_POOL[i], DAW_POOL[j]] = [DAW_POOL[j], DAW_POOL[i]]
  }

  // ── Subtitle scramble cycle ──
  function startSubtitleCycle() {
    const sub = document.querySelector('.VPHero .main .text')
    if (!sub) return
    const SG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    const sg = () => SG[Math.floor(Math.random() * SG.length)]
    const SROUNDS = 14
    const SMS = 40
    const HOLD = 4000
    let idx = 0

    function reveal(text, cb) {
      let r = 0
      const iv = setInterval(() => {
        r++
        const html = text.split('').map((c, i) => {
          if (c === ' ') return '<span style="display:inline-block;width:0.35em">&nbsp;</span>'
          const settle = Math.floor((i / text.length) * SROUNDS * 0.6) + SROUNDS * 0.35
          const ok = r >= settle
          const clr = ok ? 'rgba(235,235,245,0.55)' : 'rgba(235,235,245,0.1)'
          const ch = ok ? c : sg()
          const sh = (ok && r - settle < 2) ? 'text-shadow:0 0 8px rgba(0,212,255,0.3)' : ''
          return `<span style="color:${clr};transition:color 80ms;${sh}">${ch}</span>`
        }).join('')
        sub.innerHTML = html
        if (r >= SROUNDS) {
          clearInterval(iv)
          sub.textContent = text
          if (cb) cb()
        }
      }, SMS)
    }

    function dissolve(text, cb) {
      let r = 0
      const iv = setInterval(() => {
        r++
        const html = text.split('').map((c, i) => {
          if (c === ' ') return '<span style="display:inline-block;width:0.35em">&nbsp;</span>'
          const dissolveAt = Math.floor((i / text.length) * SROUNDS * 0.6) + SROUNDS * 0.3
          const gone = r >= dissolveAt
          const clr = gone ? 'rgba(235,235,245,0.05)' : 'rgba(235,235,245,0.55)'
          const ch = gone ? sg() : c
          return `<span style="color:${clr};transition:color 80ms">${ch}</span>`
        }).join('')
        sub.innerHTML = html
        if (r >= SROUNDS) {
          clearInterval(iv)
          if (cb) cb()
        }
      }, SMS)
    }

    function cycle() {
      const phrase = DAW_POOL[idx % DAW_POOL.length]
      idx++
      reveal(phrase, () => {
        setTimeout(() => {
          dissolve(phrase, () => {
            setTimeout(cycle, 300)
          })
        }, HOLD)
      })
    }

    // Start with rainbow sweep on first phrase, then cycle
    sub.classList.add('rainbow-sweep')
    setTimeout(() => {
      sub.classList.remove('rainbow-sweep')
      cycle()
    }, 5000)
  }

  setTimeout(() => {
    const el = document.querySelector('.VPHero .main .name')
    if (!el) return
    el.classList.add('crumbling')

    const bld = (chars, prevOk) => chars.map((c, i) => {
      if (c.ch === ' ') return '<span class="cr-ch">&nbsp;</span>'
      const ok = c.ok
      const justLanded = ok && prevOk && !prevOk[i]
      const clr = i <= 1
        ? (ok ? '#00f0ff' : 'rgba(0,240,255,0.2)')
        : i <= 3
          ? (ok ? '#ff6a00' : 'rgba(255,106,0,0.2)')
          : (ok ? 'rgba(235,235,245,0.55)' : 'rgba(235,235,245,0.08)')
      const sh = ok
        ? (i <= 1
            ? (justLanded ? '0 0 30px #00f0ff, 0 0 60px rgba(0,240,255,0.3)' : '0 0 16px rgba(0,240,255,0.4)')
            : i <= 3
              ? (justLanded ? '0 0 30px #ff6a00, 0 0 60px rgba(255,106,0,0.3)' : '0 0 16px rgba(255,106,0,0.4)')
              : 'none')
        : 'none'
      const scale = justLanded ? 'transform:scale(1.15)' : ''
      return `<span class="cr-ch" style="color:${clr};text-shadow:${sh};${scale}">${c.ch}</span>`
    }).join('')

    let chars = TGT.split('').map(c => ({ ch: c === ' ' ? ' ' : rg(), ok: c === ' ' }))
    let prevOk = null
    el.innerHTML = bld(chars, prevOk)

    let r = 0
    const iv = setInterval(() => {
      r++
      prevOk = chars.map(c => c.ok)
      chars = TGT.split('').map((c, i) => {
        if (c === ' ') return { ch: ' ', ok: true }
        const settle = Math.floor((i / TGT.length) * ROUNDS * 0.55) + ROUNDS * 0.4
        return r >= settle ? { ch: c, ok: true } : { ch: rg(), ok: false }
      })
      el.innerHTML = bld(chars, prevOk)
      if (r >= ROUNDS) {
        clearInterval(iv)
        el.innerHTML = 'MIXI DAW'
        el.classList.remove('crumbling')
        // ── Start subtitle D·A·W cycle after title settles ──
        setTimeout(startSubtitleCycle, 1000)
      }
    }, MS)
  }, DELAY)
})
</script>




<!-- GET BAR -->
<div class="get-bar-spacer"></div>
<div class="get-bar">
  <div class="get-bar-inner">
    <span class="get-label">GET</span>
    <div class="get-divider"></div>
    <a href="https://fabriziosalmi.github.io/mixi/app/" class="get-item" title="Open in Browser" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span class="get-plat">Web</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item" title="macOS ARM64" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      <span class="get-plat">ARM64</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item" title="macOS Intel" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      <span class="get-plat">Intel</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item get-item-win" title="Windows" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>
      <span class="get-plat">Win</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item get-item-linux" title="Linux" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.564.517.135 1.08.133 1.526-.054.453-.231.792-.702.869-1.299.19-.001.378-.013.564-.04.594-.104 1.124-.397 1.458-.932.053-.085.104-.168.14-.268.005-.011.009-.023.013-.035.15-.332.097-.667-.12-.956-.205-.283-.493-.463-.745-.553-.573-.206-1.236-.132-1.852.06-.088.028-.178.058-.27.089.007-.112.007-.225 0-.336-.022-.327-.138-.637-.32-.846a1.46 1.46 0 00-.27-.2c-3.048-2.124-3.088-5.283-3.054-5.79.073-.837.224-1.603.55-2.348.466-1.063 1.15-2.025 1.55-3.094.452-1.255.67-2.723-.035-3.964C14.816.568 13.687.03 12.504 0z"/></svg>
      <span class="get-plat">Linux</span>
    </a>
    <a href="https://hub.docker.com/r/fabriziosalmi/mixi" class="get-item get-item-docker" title="Docker" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186H5.136a.186.186 0 00-.186.185v1.888c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/></svg>
      <span class="get-plat">Docker</span>
    </a>
  </div>
  <div class="get-scanline"></div>
</div>

<div class="install-cmd">
  <div class="install-inner">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
    <code>curl -sL https://raw.githubusercontent.com/fabriziosalmi/mixi/main/install.sh | bash</code>
  </div>
</div>
<div class="get-bar-spacer"></div>


<div class="hero-showcase"><div class="showcase-glow"></div><div class="showcase-frame"><picture><source srcset="/screenshot.webp" type="image/webp" /><img src="/screenshot.png" loading="eager" width="1920" height="1080" alt="Fuskar MixiDAW" /></picture><div class="showcase-reflection"></div></div><div class="showcase-caption"><span class="caption-dot"></span><span>Fuskar Kai Tsaye — Deki Biyu + Groovebox Haɗaɗɗe</span></div></div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Ƙimar Samfuri</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms Jinkirin DSP</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">Niyyoyin AI</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Ƙimar Tik</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Dogaron Sauti na Waje</span></div>
</div>

<div class="manifesto-section"><div class="manifesto-inner">
  <h2 class="manifesto-title">Buɗaɗɗen Tushe. 'Yancin Wasa. Kariya Daga Cin Gajiyar.</h2>
  <p class="manifesto-text">MixiDAW yana aiki a ƙarƙashin lasisin <strong>PolyForm Noncommercial 1.0.0</strong>. Cikakken lambar tushe yana samuwa don duba, gyara da amfani maras kasuwanci.</p>
  <div class="manifesto-links">
    <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Duba Tushe a GitHub</a>
    <a href="/ha/guide/architecture" class="manifesto-link manifesto-link-alt">Karanta Cikakken Takardun Tsarin →</a>
  </div>
</div></div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">99.7%</span><span class="stat-label">CPU Headroom</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">1.61</span><span class="stat-label">&micro;s Pipeline</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">1030</span><span class="stat-label">Tests</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">17</span><span class="stat-label">Skins</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">143</span><span class="stat-label">KB Wasm</span></div>
</div>

<div class="manifesto-section"><div class="manifesto-inner">
  <h2 class="manifesto-title">Buɗaɗɗen Tushe. 'Yancin Wasa. Kariya Daga Cin Gajiyar.</h2>
  <p class="manifesto-text">MixiDAW yana aiki a ƙarƙashin lasisin <strong>PolyForm Noncommercial 1.0.0</strong>. Cikakken lambar tushe yana samuwa don duba, gyara da amfani maras kasuwanci.</p>
  <div class="manifesto-links">
    <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Duba Tushe a GitHub</a>
    <a href="/ha/guide/architecture" class="manifesto-link manifesto-link-alt">Karanta Cikakken Takardun Tsarin →</a>
  </div>
</div></div>

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

/* ── Nav bar title: MI=cyan XI=orange ── */
.VPNavBarTitle .title {
  background: linear-gradient(90deg, #00f0ff 0%, #00f0ff 50%, #ff6a00 50%, #ff6a00 100%) !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  font-weight: 700 !important;
}

/* ── Hero MIXI DAW title — force center layout ── */
.VPHero .container { max-width: 1100px !important; margin: 0 auto !important; }
.VPHero .main {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  text-align: center !important;
  width: 100% !important;
}
.VPHero .actions {
  display: none !important; /* replaced by custom download bar */
}
.VPHero .main .tagline {
  margin-left: auto !important;
  margin-right: auto !important;
}

/* ── Title: massive, cinematic ── */
.VPHero .main .name {
  font-weight: 800 !important;
  letter-spacing: 0.12em !important;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif !important;
  font-size: clamp(3.5rem, 10vw, 6rem) !important;
  width: 100% !important;
  text-align: center !important;
  display: block !important;
  line-height: 1 !important;
  position: relative;
}

/* Ambient glow behind the title */
.VPHero .main .name::after {
  content: '';
  position: absolute;
  inset: -20px -40px;
  background: radial-gradient(ellipse 60% 50% at 30% 50%, rgba(0,240,255,0.06) 0%, transparent 70%),
              radial-gradient(ellipse 60% 50% at 70% 50%, rgba(255,106,0,0.05) 0%, transparent 70%);
  filter: blur(30px);
  pointer-events: none;
  z-index: -1;
}

/* During JS crumble: disable gradient, let span colors show */
.VPHero .main .name.crumbling {
  -webkit-text-fill-color: unset !important;
  background: none !important;
}
.VPHero .main .name .cr-ch {
  display: inline-block;
  min-width: 0.55em;
  text-align: center;
  transition: color 0.06s, text-shadow 0.2s ease-out, transform 0.15s ease-out;
  font-variant-numeric: tabular-nums;
}

/* Paint MI cyan + XI orange + DAW dim on .name.clip */
.VPHero .main .name.clip {
  background: linear-gradient(90deg, #00f0ff 0%, #00f0ff 25%, #ff6a00 25%, #ff6a00 50%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.12) 55%, rgba(235,235,245,0.55) 55%, rgba(235,235,245,0.55) 100%) !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
}

/* ── Subtitle: elegant, wide, premium ── */
.VPHero .main .text {
  font-weight: 300 !important;
  letter-spacing: 0.18em !important;
  text-transform: uppercase !important;
  color: rgba(235, 235, 245, 0.55) !important;
  font-size: clamp(0.9rem, 2.5vw, 1.35rem) !important;
  white-space: nowrap !important;
  text-align: center !important;
  width: 100% !important;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif !important;
  margin-top: 0.5rem !important;
  padding-bottom: 0.5rem !important;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  position: relative;
}

/* Thin accent line under subtitle */
.VPHero .main .text::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 60px;
  height: 1px;
  background: linear-gradient(90deg, #00f0ff, #ff6a00);
  opacity: 0.4;
}

/* ── Rainbow sweep: one-shot reflection on subtitle ── */
@keyframes rainbowSweep {
  0%   { background-position: -120% center; -webkit-text-fill-color: rgba(235, 235, 245, 0.55); }
  5%   { -webkit-text-fill-color: transparent; }
  25%  { background-position: 220% center; -webkit-text-fill-color: transparent; }
  35%  { background-position: 220% center; -webkit-text-fill-color: rgba(235, 235, 245, 0.55); }
  100% { background-position: 220% center; -webkit-text-fill-color: rgba(235, 235, 245, 0.55); }
}
.VPHero .main .text.rainbow-sweep {
  background: linear-gradient(
    90deg,
    transparent 0%, transparent 15%,
    #ff0055 15%, #ff4500 22%, #ff8c00 30%, #ffd700 38%,
    #00ff88 46%, #00cfff 54%, #a78bfa 62%, #ff0055 70%,
    transparent 70%, transparent 100%
  ) no-repeat;
  background-size: 350% 100%;
  background-position: -120% center;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: rgba(235, 235, 245, 0.55);
  animation: rainbowSweep 4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.VPHero .main .tagline {
  font-size: 1.05rem;
  line-height: 1.7;
  color: rgba(235, 235, 245, 0.4);
  max-width: 560px;
  margin-top: 1.5rem !important;
}
/* Hide hero image slot — we use custom showcase */
.VPHero .image-container { display: none !important; }

/* ═══════════ UNIFIED GET BAR ═══════════ */
.get-bar-spacer {
  height: 1.5rem;
}

.get-bar {
  position: relative;
  max-width: 640px;
  margin: 0 auto;
  padding: 0 1rem;
  opacity: 0;
  transform: translateY(12px);
  animation: demaskIn 0.6s ease-out 3.3s forwards;
}

.get-bar-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.6rem 1.2rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(0, 212, 255, 0.12);
  backdrop-filter: blur(16px) saturate(140%);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.4),
    0 0 30px rgba(0, 212, 255, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  overflow: hidden;
  position: relative;
}

.get-label {
  font-size: 1.15rem;
  font-weight: 800;
  color: #00d4ff;
  text-transform: uppercase;
  letter-spacing: 3px;
  text-shadow: 0 0 18px rgba(0, 212, 255, 0.35);
  padding: 0 0.3rem;
  flex-shrink: 0;
}

.get-divider {
  width: 1px;
  height: 32px;
  background: linear-gradient(180deg, transparent, rgba(0, 212, 255, 0.25), transparent);
  margin: 0 0.4rem;
  flex-shrink: 0;
}

.get-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  color: rgba(235, 235, 245, 0.55);
  text-decoration: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.get-item::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: border-color 0.25s ease;
}

.get-item:hover {
  color: #00d4ff;
  background: rgba(0, 212, 255, 0.06);
  transform: translateY(-2px);
}
.get-item:hover::before {
  border-color: rgba(0, 212, 255, 0.2);
}

.get-item svg {
  filter: drop-shadow(0 0 0px transparent);
  transition: filter 0.25s ease;
}
.get-item:hover svg {
  filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.4));
}

/* Platform-specific hover tints */
.get-item-win:hover {
  color: #4fc3f7;
  background: rgba(0, 120, 215, 0.08);
}
.get-item-win:hover::before {
  border-color: rgba(0, 120, 215, 0.2);
}
.get-item-win:hover svg {
  filter: drop-shadow(0 0 8px rgba(79, 195, 247, 0.4));
}

.get-item-linux:hover {
  color: #ffc107;
  background: rgba(255, 193, 7, 0.06);
}
.get-item-linux:hover::before {
  border-color: rgba(255, 193, 7, 0.2);
}
.get-item-linux:hover svg {
  filter: drop-shadow(0 0 8px rgba(255, 193, 7, 0.4));
}

.get-plat {
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  opacity: 0.7;
  font-weight: 500;
}

/* Scanning line — horizontal sweep */
.get-scanline {
  position: absolute;
  top: 0;
  left: -30%;
  width: 30%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(0, 212, 255, 0.04), transparent);
  animation: scanSweep 5s linear infinite;
  pointer-events: none;
  border-radius: 12px;
}

@keyframes scanSweep {
  0%   { left: -30%; }
  100% { left: 130%; }
}

/* Docker hover tint */
.get-item-docker:hover {
  color: #2496ed;
  background: rgba(36, 150, 237, 0.06);
}
.get-item-docker:hover::before {
  border-color: rgba(36, 150, 237, 0.2);
}
.get-item-docker:hover svg {
  filter: drop-shadow(0 0 8px rgba(36, 150, 237, 0.4));
}

/* ═══════════ INSTALL ONE-LINER ═══════════ */
.install-cmd {
  max-width: 640px;
  margin: 0.6rem auto 0;
  padding: 0 1rem;
  opacity: 0;
  transform: translateY(8px);
  animation: demaskIn 0.6s ease-out 3.5s forwards;
}

.install-inner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}

.install-inner svg {
  color: rgba(0, 212, 255, 0.5);
  flex-shrink: 0;
}

.install-inner code {
  font-size: 0.72rem;
  color: rgba(235, 235, 245, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: none;
  padding: 0;
  letter-spacing: 0.3px;
}

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

/* ═══════════════════════════════════════
   MOBILE RESPONSIVE (≤ 640px)
   ═══════════════════════════════════════ */
@media (max-width: 640px) {

  /* ── Hero title + subtitle responsive ── */
  .VPHero .main .name {
    letter-spacing: 0.06em !important;
  }
  .VPHero .main .name::after {
    display: none;
  }
  .VPHero .main .text {
    white-space: normal !important;
    font-size: 0.85rem !important;
    line-height: 1.6 !important;
    letter-spacing: 0.12em !important;
  }
  .VPHero .main .text::after {
    width: 40px;
  }
  .VPHero .main .tagline {
    font-size: 0.9rem;
    padding: 0 0.5rem;
  }

  /* ── GET bar: 2 rows of 3 icons ── */
  .get-bar-inner {
    flex-wrap: wrap;
    gap: 0.2rem;
    padding: 0.5rem 0.6rem;
  }

  .get-label {
    width: 100%;
    text-align: center;
    font-size: 1rem;
    margin-bottom: 0.2rem;
  }

  .get-divider {
    display: none;
  }

  .get-item {
    flex: 0 0 calc(33.33% - 0.2rem);
    padding: 0.4rem 0.3rem;
  }

  .get-item svg {
    width: 24px;
    height: 24px;
  }

  .get-plat {
    font-size: 0.5rem;
  }

  /* ── Install cmd: horizontal scroll ── */
  .install-inner {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .install-inner code {
    font-size: 0.62rem;
  }

  /* ── Stats: 2-column grid ── */
  .stats-row {
    display: grid !important;
    grid-template-columns: 1fr 1fr;
    gap: 1.2rem 0;
    padding: 1.2rem 1rem;
    margin: 2rem auto;
  }

  .stat-divider {
    display: none;
  }

  .stat-item:last-child {
    grid-column: 1 / -1;
  }

  .stat-number {
    font-size: 1.5rem;
  }

  .stat-label {
    font-size: 0.65rem;
  }

  /* ── Showcase: tighter margins ── */
  .hero-showcase {
    margin-top: -1rem;
    padding: 0 0.5rem;
  }

  .showcase-caption {
    font-size: 0.7rem;
  }

  /* ── Manifesto: stack buttons ── */
  .manifesto-inner {
    padding: 2rem 1.2rem;
  }

  .manifesto-title {
    font-size: 1.15rem;
  }

  .manifesto-text {
    font-size: 0.85rem;
  }

  .manifesto-links {
    flex-direction: column;
    gap: 0.8rem;
  }

  .manifesto-link {
    width: 100%;
    justify-content: center;
  }
}

/* ═══════════ Tablet (641–960px) ═══════════ */
@media (min-width: 641px) and (max-width: 960px) {
  .stats-row {
    gap: 0;
    padding: 1.4rem 1rem;
  }

  .stat-number {
    font-size: 1.4rem;
  }

  .stat-label {
    font-size: 0.6rem;
  }

  .get-item {
    padding: 0.45rem 0.5rem;
  }

  .get-item svg {
    width: 26px;
    height: 26px;
  }
}
</style>
