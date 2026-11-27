<script setup lang="ts">
import { ref } from 'vue'

interface ChainStage {
  step: string
  title: string
  sub: string
  detail: string
  docHref: string
  docLabel: string
}

const stages: ChainStage[] = [
  {
    step: '01 · SOURCE',
    title: 'Dual Decks + Groovebox',
    sub: '48 kHz native · Beatgrid PLL',
    detail: 'Hardware-native AudioContext sample rate with ring-buffered beatgrid PLL, segmented streaming for long tracks, and de-clicked seeks.',
    docHref: '/guide/architecture',
    docLabel: 'Architecture docs',
  },
  {
    step: '02 · PITCH',
    title: 'Phase-Coherent Key Lock',
    sub: 'Zero-GC AudioWorklet ring',
    detail: 'Pre-allocated AudioWorklet buffers with zero per-frame allocations on the audio thread and clean teardown on deck unload.',
    docHref: '/guide/webaudio',
    docLabel: 'AudioWorklet internals',
  },
  {
    step: '03 · DSP BUS',
    title: 'Rust/Wasm Stereo Engine',
    sub: 'LR4 Isolator · Filter · FX',
    detail: 'True stereo 4-in/2-out f32 graph compiled to 83 KB Wasm (0 host imports, SIMD128): 24 dB/oct LR4 isolator EQ, resonant filters, delay, and spectral sidechain.',
    docHref: '/guide/webaudio',
    docLabel: 'Wasm DSP reference',
  },
  {
    step: '04 · MASTER',
    title: 'Predictive ISP Limiter',
    sub: 'Stereo-linked · 9-sample lookahead',
    detail: '4-point Hermite inter-sample peak detection with 9-sample (0.19 ms @ 48 kHz) stereo-linked lookahead and hard-clip ceiling safety net.',
    docHref: '/guide/mixer',
    docLabel: 'Mixer & Limiter guide',
  },
]

const activeIndex = ref(2)
</script>

<template>
  <section class="mixi-section mixi-specs" aria-label="Verified engineering specifications">
    <div class="mixi-specs-grid">
      <div class="mixi-spec-card">
        <span class="mixi-spec-value">83 KB</span>
        <span class="mixi-spec-label">Lean Wasm DSP</span>
        <span class="mixi-spec-detail">Zero host imports · SIMD128</span>
      </div>
      <div class="mixi-spec-card">
        <span class="mixi-spec-value">20.5 &micro;s</span>
        <span class="mixi-spec-label">Stereo Pipeline</span>
        <span class="mixi-spec-detail">99.3% CPU headroom @ 48 kHz</span>
      </div>
      <div class="mixi-spec-card">
        <span class="mixi-spec-value">723</span>
        <span class="mixi-spec-label">Automated Tests</span>
        <span class="mixi-spec-detail">622 Vitest + 101 Rust Cargo</span>
      </div>
      <div class="mixi-spec-card">
        <span class="mixi-spec-value">17</span>
        <span class="mixi-spec-label">Built-in Skins</span>
        <span class="mixi-spec-detail">CSS variable theming · MIDI</span>
      </div>
    </div>

    <div class="mixi-chain">
      <div class="mixi-chain-header">
        <span>Signal Chain Architecture (True Stereo 4-in / 2-out)</span>
        <span class="mixi-chain-hint">Select a stage to inspect</span>
      </div>
      <div class="mixi-chain-nodes" role="group" aria-label="DSP signal chain stages">
        <button
          v-for="(stage, idx) in stages"
          :key="stage.step"
          type="button"
          class="mixi-chain-node"
          :class="{ 'is-active': activeIndex === idx }"
          :aria-pressed="activeIndex === idx"
          @click="activeIndex = idx"
        >
          <span class="mixi-chain-step">{{ stage.step }}</span>
          <span class="mixi-chain-title">{{ stage.title }}</span>
          <span class="mixi-chain-sub">{{ stage.sub }}</span>
        </button>
      </div>
      <div class="mixi-chain-inspector" aria-live="polite">
        <span class="mixi-inspector-tag">{{ stages[activeIndex].step }}</span>
        <span class="mixi-inspector-text">{{ stages[activeIndex].detail }}</span>
        <a :href="stages[activeIndex].docHref" class="mixi-inspector-link">
          {{ stages[activeIndex].docLabel }} &rarr;
        </a>
      </div>
    </div>
  </section>
</template>
