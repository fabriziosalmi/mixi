---
layout: home

hero:
  name: "MixiDAW"
  text: "決定論的オーディオワークステーション"
  tagline: "ゼロレイテンシーDSP、ハードウェアモデルの信号チェーン、インテリジェント自動化レイヤーを備えたプロフェッショナルグレードのWebAudio処理。アーティストは無料。設計からオープン。"
  actions:
    - theme: brand
      text: Web版を開く
      link: /app/
    - theme: alt
      text: 技術ドキュメント
      link: /guide/architecture

features:
  - title: "決定論的DSPエンジン"
    details: "τ=12msスムージングによるAudioContextタイムラインスケジューリング。3バンドアナログモデルKill-EQ、バンドスプリットディストーション、パラレルコンプレッション、放送グレードのブリックウォールリミッティング。ジッターゼロ。"
  - title: "インテリジェント自動化"
    details: "ステートレスな50msティックアービターが位相アライメント、スペクトル衝突、ヘッドルームを継続的に監視。修正アクションは透過的なGhost Mutationとして実行 — 可視的だが非侵入的。"
  - title: "モジュラーアーキテクチャ"
    details: "完全分離型ステップシーケンサーバス、CSS変数駆動のスキニング、コミュニティ製楽器のためのオープンプラグインインターフェース。フォークし、スキンし、拡張する。"
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <picture><source srcset="/screenshot.webp" type="image/webp" /><img src="/screenshot.png" loading="eager" width="1920" height="1080" alt="MixiDAW インターフェース" /></picture>
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>ライブインターフェース — デュアルデッキ + 統合グルーブボックス</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item">
    <span class="stat-number">44.1</span>
    <span class="stat-label">kHz サンプルレート</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">&lt;1</span>
    <span class="stat-label">ms DSPレイテンシー</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">18</span>
    <span class="stat-label">AIインテント</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">20</span>
    <span class="stat-label">Hz ティックレート</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">0</span>
    <span class="stat-label">外部オーディオ依存</span>
  </div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">オープンコア。自由にプレイ。搾取から保護。</h2>
    <p class="manifesto-text">
      MixiDAWは<strong>PolyForm Noncommercial 1.0.0</strong>ライセンスの下で運営されています。完全なソースコードは検査、修正、非商用利用のために公開されています。アーティスト、愛好家、研究者は無制限にアクセスできます。商用パッケージング、SaaSデプロイ、商用再配布には明示的なライセンスが必要です。
    </p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        GitHubでソースを見る
      </a>
      <a href="/ja/guide/architecture" class="manifesto-link manifesto-link-alt">
        完全なアーキテクチャドキュメントを読む →
      </a>
    </div>
  </div>
</div>
