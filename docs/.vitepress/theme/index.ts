import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import HeroShowcase from '../components/HeroShowcase.vue'
import VerifiedSpecs from '../components/VerifiedSpecs.vue'
import DownloadStrip from '../components/DownloadStrip.vue'
import ReleaseManifesto from '../components/ReleaseManifesto.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('HeroShowcase', HeroShowcase)
    app.component('VerifiedSpecs', VerifiedSpecs)
    app.component('DownloadStrip', DownloadStrip)
    app.component('ReleaseManifesto', ReleaseManifesto)
  },
} satisfies Theme
