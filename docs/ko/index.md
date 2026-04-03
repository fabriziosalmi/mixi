---
layout: home
hero:
  name: "MixiDAW"
  text: "결정론적 오디오 워크스테이션"
  tagline: "제로 레이턴시 DSP, 하드웨어 모델링 신호 체인, 지능형 자동화 레이어를 갖춘 프로페셔널급 WebAudio 처리. 아티스트에게 무료. 설계부터 오픈."
  actions:
    - theme: brand
      text: 웹 버전 열기
      link: /play
    - theme: alt
      text: 기술 문서
      link: /guide/architecture
features:
  - title: "결정론적 DSP 엔진"
    details: "τ=12ms 스무딩의 AudioContext 타임라인 스케줄링. 3밴드 아날로그 모델 Kill-EQ, 밴드 스플릿 디스토션, 패럴렐 컴프레션, 방송급 브릭월 리미팅. 제로 지터."
  - title: "지능형 자동화"
    details: "스테이트리스 50ms 틱 아비터가 위상 정렬, 스펙트럼 충돌, 헤드룸을 지속적으로 모니터링. 교정 액션은 투명한 Ghost Mutation으로 실행됩니다."
  - title: "모듈러 아키텍처"
    details: "완전히 분리된 스텝 시퀀서 버스, CSS 변수 기반 스키닝, 커뮤니티 제작 악기를 위한 오픈 플러그인 인터페이스. Fork하고, 스킨하고, 확장하세요."
---

<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <img src="/screenshot.png" alt="MixiDAW 인터페이스" />
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption">
    <span class="caption-dot"></span>
    <span>라이브 인터페이스 — 듀얼 데크 + 통합 그루브박스</span>
  </div>
</div>

<div class="stats-row">
  <div class="stat-item"><span class="stat-number">44.1</span><span class="stat-label">kHz 샘플 레이트</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">&lt;1</span><span class="stat-label">ms DSP 레이턴시</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">18</span><span class="stat-label">AI 인텐트</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">20</span><span class="stat-label">Hz 틱 레이트</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">0</span><span class="stat-label">외부 오디오 의존성</span></div>
</div>

<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">오픈 코어. 자유롭게 플레이. 착취로부터 보호.</h2>
    <p class="manifesto-text">MixiDAW는 <strong>PolyForm Noncommercial 1.0.0</strong> 라이선스 하에 운영됩니다. 전체 소스 코드는 검사, 수정 및 비상업적 사용을 위해 공개되어 있습니다. 아티스트, 취미인, 연구자는 제한 없이 접근할 수 있습니다. 기업 패키징, SaaS 배포 및 상업적 재배포에는 명시적 라이선스가 필요합니다.</p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">GitHub에서 소스 보기</a>
      <a href="/ko/guide/architecture" class="manifesto-link manifesto-link-alt">전체 아키텍처 문서 읽기 →</a>
    </div>
  </div>
</div>
