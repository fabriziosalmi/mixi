---
layout: home
hero:
  name: "MixiDAW"
  text: "Deterministik Ses İş İstasyonu"
  tagline: "Sıfır gecikmeli DSP, donanım modellemeli sinyal zincirleri ve akıllı otomasyon katmanı ile profesyonel düzeyde WebAudio işleme. Sanatçılar için ücretsiz. Tasarımdan açık."
  actions:
    - theme: brand
      text: Web Sürümünü Aç
      link: /play
    - theme: alt
      text: Teknik Dokümantasyon
      link: /guide/architecture
features:
  - title: "Deterministik DSP Motoru"
    details: "τ=12ms yumuşatma ile AudioContext zaman çizelgesi planlaması. 3 bantlı analog modelli Kill-EQ, bant bölmeli distorsiyon, paralel kompresyon, yayın kalitesinde brickwall limitleme. Sıfır jitter."
  - title: "Akıllı Otomasyon"
    details: "Durumsuz 50ms tick arbitörü sürekli olarak faz hizalamasını, spektral çakışmaları ve headroom'u izler. Düzeltici eylemler şeffaf Ghost Mutation olarak yürütülür."
  - title: "Modüler Mimari"
    details: "Tamamen ayrıştırılmış step-sequencer veri yolu, CSS değişken tabanlı tema sistemi ve topluluk enstrümanları için açık eklenti arayüzü. Fork'la, temala, genişlet."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="MixiDAW Arayüzü" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>Canlı Arayüz — Çift Deck + Entegre Groovebox</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz Örnekleme Hızı</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms DSP Gecikmesi</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI Niyetleri</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz Tick Hızı</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">Harici Ses Bağımlılığı</span></div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Açık Çekirdek. Özgürce Çal. Sömürüye Karşı Korumalı.</h2>
    <p class="manifesto-text">MixiDAW, <strong>PolyForm Noncommercial 1.0.0</strong> lisansı altında çalışır. Tam kaynak kodu inceleme, değiştirme ve ticari olmayan kullanım için mevcuttur. Sanatçılar, hobi sahipleri ve araştırmacılar sınırsız erişime sahiptir. Kurumsal paketleme, SaaS dağıtımı ve ticari yeniden dağıtım açık lisans gerektirir.</p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">GitHub'da Kaynak Kodunu Gör</a>
      <a href="/tr/guide/architecture" class="manifesto-link manifesto-link-alt">Tam Mimari Belgesini Oku →</a>
    </div>
  </div>
</div>
