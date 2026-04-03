---
layout: home
hero:
  name: "MixiDAW"
  text: "Stasiun Kerja Audio Deterministik"
  tagline: "Pemrosesan WebAudio kelas profesional dengan DSP tanpa latensi, rantai sinyal berbasis perangkat keras, dan lapisan otomatisasi cerdas. Gratis untuk seniman. Terbuka secara desain."
  actions:
    - theme: brand
      text: Buka Versi Web
      link: /play
    - theme: alt
      text: Dokumentasi Teknis
      link: /guide/architecture
features:
  - title: "Mesin DSP Deterministik"
    details: "Penjadwalan timeline AudioContext dengan smoothing τ=12ms. Kill-EQ analog 3-band, distorsi band-split, kompresi paralel, brick-wall limiting kelas broadcast. Nol jitter."
  - title: "Otomatisasi Cerdas"
    details: "Arbiter stateless dengan tick 50ms secara kontinu memantau penyelarasan fase, konflik spektral, dan headroom. Tindakan korektif dieksekusi sebagai Ghost Mutation transparan."
  - title: "Arsitektur Modular"
    details: "Bus step-sequencer yang sepenuhnya terpisah, skinning berbasis variabel CSS, dan antarmuka plugin terbuka untuk instrumen komunitas. Fork, skin, extend."
---

<div class="hero-showcase"><div class="showcase-glow"></div><div class="showcase-frame"><img src="/screenshot.png" alt="Antarmuka MixiDAW" /><div class="showcase-reflection"></div></div><div class="showcase-caption"><span class="caption-dot"></span><span>Antarmuka Langsung — Dual Deck + Groovebox Terintegrasi</span></div></div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Sample Rate</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms Latensi DSP</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI Intent</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Tick Rate</span></div><div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Dependensi Audio Ext.</span></div>
</div>

<div class="manifesto-section"><div class="manifesto-inner">
  <h2 class="manifesto-title">Open Core. Bebas Bermain. Dilindungi dari Eksploitasi.</h2>
  <p class="manifesto-text">MixiDAW beroperasi di bawah lisensi <strong>PolyForm Noncommercial 1.0.0</strong>. Kode sumber lengkap tersedia untuk inspeksi, modifikasi, dan penggunaan non-komersial. Seniman, hobi, dan peneliti memiliki akses tanpa batas. Pengemasan korporat, deployment SaaS, dan redistribusi komersial memerlukan lisensi eksplisit.</p>
  <div class="manifesto-links">
    <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">Kode Sumber di GitHub</a>
    <a href="/id/guide/architecture" class="manifesto-link manifesto-link-alt">Baca Dokumen Arsitektur Lengkap →</a>
  </div>
</div></div>
