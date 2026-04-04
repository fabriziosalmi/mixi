import { defineConfig } from 'vitepress';
import fs from 'fs';
import path from 'path';

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
});