<script setup lang="ts">
import pkg from '../../../package.json'

withDefaults(
  defineProps<{
    title?: string
    text?: string
    githubLabel?: string
    commercialLabel?: string
  }>(),
  {
    title: 'Open Core. Free to Play. No Exploitation.',
    text: 'MIXI operates under the PolyForm Noncommercial 1.0.0 license. The complete source code is available for inspection, modification, and non-commercial use. Artists, hobbyists, and researchers have unrestricted access. Corporate packaging, SaaS deployment, and commercial redistribution require explicit licensing.',
    githubLabel: 'View Source on GitHub',
    commercialLabel: 'Commercial Licensing',
  },
)

const version = `v${pkg.version}`
</script>

<template>
  <section class="mixi-section mixi-manifesto" aria-label="License and release information">
    <div class="mixi-manifesto-card">
      <div class="mixi-version-pill">
        <span>Release {{ version }}</span>
        <span aria-hidden="true">·</span>
        <span>PolyForm Noncommercial 1.0.0</span>
      </div>
      <h2 class="mixi-manifesto-title">{{ title }}</h2>
      <p class="mixi-manifesto-text">{{ text }}</p>
      <div class="mixi-manifesto-links">
        <a
          href="https://github.com/fabriziosalmi/mixi"
          class="mixi-manifesto-btn"
          target="_blank"
          rel="noopener"
        >
          {{ githubLabel }}
        </a>
        <a
          href="mailto:fabrizio.salmi@gmail.com?subject=Mixi%20Commercial%20Licensing"
          class="mixi-manifesto-btn mixi-manifesto-btn-alt"
        >
          {{ commercialLabel }}
        </a>
      </div>
    </div>
  </section>
</template>
