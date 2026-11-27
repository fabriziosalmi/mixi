<script setup lang="ts">
withDefaults(
  defineProps<{
    caption?: string
  }>(),
  {
    caption: 'Live Workstation · Dual Deck + Groovebox · 48 kHz Stereo',
  },
)
</script>

<template>
  <section class="mixi-section mixi-showcase" aria-label="MIXI workstation interface preview">
    <div class="mixi-showcase-frame">
      <div class="mixi-showcase-bar">
        <span class="mixi-showcase-leds" aria-hidden="true">
          <span class="mixi-led mixi-led-a"></span>
          <span class="mixi-led mixi-led-b"></span>
        </span>
        <span class="mixi-showcase-label">{{ caption }}</span>
      </div>
      <picture>
        <source srcset="/screenshot.webp" type="image/webp" />
        <img
          class="mixi-showcase-img"
          src="/screenshot.png"
          alt="MIXI DJ workstation interface showing dual decks, waveforms, mixer, and groovebox"
          width="1920"
          height="1080"
          fetchpriority="high"
          decoding="async"
        />
      </picture>
      <div class="mixi-showcase-footer">
        <div class="mixi-trust-pills">
          <span class="mixi-trust-pill">No account required</span>
          <span class="mixi-trust-sep" aria-hidden="true">·</span>
          <span class="mixi-trust-pill">Audio stays 100% on your device</span>
          <span class="mixi-trust-sep" aria-hidden="true">·</span>
          <span class="mixi-trust-pill">WebMIDI &amp; split headphone cue</span>
        </div>
        <a
          href="https://fabriziosalmi.github.io/mixi/app/"
          class="mixi-showcase-launch"
          target="_blank"
          rel="noopener"
        >
          Open Live Workstation &rarr;
        </a>
      </div>
    </div>
  </section>
</template>
