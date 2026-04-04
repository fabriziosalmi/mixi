---
layout: home

hero:
  name: "MixiDAW"
  text: "确定性音频工作站"
  tagline: "专业级WebAudio处理，零延迟DSP，硬件建模信号链，以及智能自动化层。对艺术家免费。开放设计。"
  actions:
    - theme: brand
      text: 打开网页版
      link: /app/
    - theme: alt
      text: 技术文档
      link: /guide/architecture

features:
  - title: "确定性DSP引擎"
    details: "基于AudioContext时间线调度，τ=12ms平滑处理。3频段模拟建模Kill-EQ、分频失真、并行压缩和广播级砖墙限制器。零抖动。"
  - title: "智能自动化"
    details: "无状态50ms tick仲裁器持续监测相位对齐、频谱冲突和动态余量。校正动作以透明的Ghost Mutation方式执行——可见但不干扰。"
  - title: "模块化架构"
    details: "完全解耦的步进序列器总线、CSS变量驱动的皮肤系统，以及面向社区乐器的开放插件接口。Fork它，定制它，扩展它。"
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="MixiDAW 界面" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>实时界面 — 双唱盘 + 集成鼓机</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item">
    <span class="stat-number">44.1</span>
    <span class="stat-label">kHz 采样率</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">&lt;1</span>
    <span class="stat-label">ms DSP延迟</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">18</span>
    <span class="stat-label">AI意图</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">20</span>
    <span class="stat-label">Hz Tick频率</span>
  </div>
  <div class="stat-divider"></div>
  <div class="stat-item">
    <span class="stat-number">0</span>
    <span class="stat-label">外部音频依赖</span>
  </div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">开放核心。自由演奏。防止剥削。</h2>
    <p class="manifesto-text">
      MixiDAW在<strong>PolyForm Noncommercial 1.0.0</strong>许可证下运营。完整源代码可供检查、修改和非商业使用。艺术家、爱好者和研究人员可无限制访问。企业打包、SaaS部署和商业再分发需要明确的许可。
    </p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        在GitHub上查看源代码
      </a>
      <a href="/zh/guide/architecture" class="manifesto-link manifesto-link-alt">
        阅读完整架构文档 →
      </a>
    </div>
  </div>
</div>
