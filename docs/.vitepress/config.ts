import { defineConfig } from 'vitepress';
import fs from 'fs';

// Discover all 2-letter language codes in the docs directory
const locales: Record<string, any> = {
  root: { label: 'English', lang: 'en' }
};

try {
  const dirs = fs.readdirSync(__dirname + '/..');
  for (const dir of dirs) {
    if (/^[a-z]{2}$/.test(dir)) {
      locales[dir] = {
        label: dir.toUpperCase(),
        lang: dir,
        link: `/${dir}/`
      };
    }
  }
} catch(e) {}

export default defineConfig({
  title: 'MIXI',
  description: 'Next-Generation Browser-Based DJ Engine & AI AutoMixer',
  locales,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' }
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Quick Start', link: '/guide/getting-started' },
          { text: 'Architecture', link: '/guide/architecture' },
        ]
      },
      {
        text: 'Mixing',
        items: [
          { text: 'Mixer, EQ & Effects', link: '/guide/mixer' },
          { text: 'AI AutoMixer', link: '/guide/ai-automixer' },
        ]
      },
      {
        text: 'Instruments',
        items: [
          { text: 'TurboBass Acid Synth', link: '/guide/turbobass' },
          { text: 'Groovebox', link: '/guide/groovebox' },
        ]
      },
      {
        text: 'Internals',
        items: [
          { text: 'WebAudio Engine', link: '/guide/webaudio' },
          { text: 'BPM Detection', link: '/BPM' },
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/fabriziosalmi/mixi' }
    ]
  }
});
