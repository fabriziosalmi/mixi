<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const INSTALL_CMD = 'curl -sL https://raw.githubusercontent.com/fabriziosalmi/mixi/main/install.sh | bash'
const copied = ref(false)
const detectedOs = ref<'mac' | 'win' | 'linux' | null>(null)
let resetTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  if (typeof navigator === 'undefined') return
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) detectedOs.value = 'mac'
  else if (ua.includes('win')) detectedOs.value = 'win'
  else if (ua.includes('linux')) detectedOs.value = 'linux'
})

async function copyInstallCommand() {
  try {
    await navigator.clipboard.writeText(INSTALL_CMD)
    copied.value = true
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    copied.value = false
  }
}

onUnmounted(() => {
  if (resetTimer) clearTimeout(resetTimer)
})
</script>

<template>
  <section class="mixi-section mixi-download" aria-label="Downloads and installation">
    <div class="mixi-download-card">
      <div class="mixi-platform-row">
        <span class="mixi-platform-label">Run Anywhere</span>
        <div class="mixi-platform-links">
          <a
            href="https://fabriziosalmi.github.io/mixi/app/"
            class="mixi-plat-btn mixi-plat-btn-primary"
            target="_blank"
            rel="noopener"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>Web App</span>
          </a>
          <a
            href="https://github.com/fabriziosalmi/mixi/releases/latest"
            class="mixi-plat-btn"
            :class="{ 'is-detected': detectedOs === 'mac' }"
            target="_blank"
            rel="noopener"
          >
            <span>macOS ARM64</span>
            <span class="mixi-plat-ext">.dmg</span>
          </a>
          <a
            href="https://github.com/fabriziosalmi/mixi/releases/latest"
            class="mixi-plat-btn"
            target="_blank"
            rel="noopener"
          >
            <span>macOS Intel</span>
            <span class="mixi-plat-ext">.dmg</span>
          </a>
          <a
            href="https://github.com/fabriziosalmi/mixi/releases/latest"
            class="mixi-plat-btn"
            :class="{ 'is-detected': detectedOs === 'win' }"
            target="_blank"
            rel="noopener"
          >
            <span>Windows x64</span>
            <span class="mixi-plat-ext">.exe</span>
          </a>
          <a
            href="https://github.com/fabriziosalmi/mixi/releases/latest"
            class="mixi-plat-btn"
            :class="{ 'is-detected': detectedOs === 'linux' }"
            target="_blank"
            rel="noopener"
          >
            <span>Linux</span>
            <span class="mixi-plat-ext">.AppImage</span>
          </a>
          <a
            href="https://hub.docker.com/r/fabriziosalmi/mixi"
            class="mixi-plat-btn"
            target="_blank"
            rel="noopener"
          >
            <span>Docker</span>
          </a>
        </div>
      </div>

      <div class="mixi-install-bar">
        <div class="mixi-install-code">
          <span class="mixi-install-prompt" aria-hidden="true">$</span>
          <code>{{ INSTALL_CMD }}</code>
        </div>
        <button
          type="button"
          class="mixi-copy-btn"
          :class="{ 'is-copied': copied }"
          aria-live="polite"
          @click="copyInstallCommand"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>
  </section>
</template>
