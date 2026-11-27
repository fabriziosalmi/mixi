<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import HeroShowcase from '../components/HeroShowcase.vue'
import pkg from '../../../package.json'

const { Layout } = DefaultTheme
const { frontmatter } = useData()
const version = `v${pkg.version}`
</script>

<template>
  <Layout>
    <template #home-hero-info-before>
      <div class="mixi-hero-badge">
        <span class="mixi-led mixi-led-a" aria-hidden="true"></span>
        <span>{{ version }}</span>
        <span class="mixi-badge-sep" aria-hidden="true">/</span>
        <span>Rust/Wasm True Stereo DSP</span>
        <span class="mixi-badge-sep" aria-hidden="true">/</span>
        <span>100% Local Audio</span>
      </div>
    </template>

    <template #home-hero-after>
      <HeroShowcase :caption="frontmatter.showcaseCaption" />
    </template>

    <template #nav-bar-content-after>
      <a
        href="https://fabriziosalmi.github.io/mixi/app/"
        class="mixi-nav-cta"
        target="_blank"
        rel="noopener"
      >
        Launch App
      </a>
    </template>
  </Layout>
</template>
