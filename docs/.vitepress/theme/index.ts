// ─────────────────────────────────────────────────────────────
// Mixi Docs – Custom VitePress theme
//
// Extends the default theme with the cinematic homepage intro.
// ─────────────────────────────────────────────────────────────
import DefaultTheme from 'vitepress/theme'
import HomeIntro from '../components/HomeIntro.vue'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeIntro', HomeIntro)
  },
} satisfies Theme
