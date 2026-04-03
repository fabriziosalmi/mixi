import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'MIXI',
  description: 'Next-Generation Browser-Based DJ Engine & AI AutoMixer',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/architecture' }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Architecture Overview', link: '/guide/architecture' },
          { text: 'Mixer & Deck Control', link: '/guide/mixer' },
        ]
      },
      {
        text: 'Core Systems',
        items: [
          { text: 'AI AutoMixEngine', link: '/guide/ai-automixer' },
          { text: 'Groovebox & MIDI', link: '/guide/groovebox' },
          { text: 'WebAudio & Memory', link: '/guide/webaudio' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/fabriziosalmi/mixi' }
    ]
  }
})