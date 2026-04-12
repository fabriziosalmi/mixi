import { defineConfig } from 'vitepress';
import fs from 'fs';

// Discover all 2-letter language codes in the docs directory
const RTL_LANGS = new Set(['ar']);
const LANG_LABELS: Record<string, string> = {
  ar: 'العربية', bg: 'Български', bn: 'বাংলা', cs: 'Čeština',
  de: 'Deutsch', el: 'Ελληνικά', es: 'Español', fr: 'Français',
  ha: 'Hausa', hi: 'हिन्दी', id: 'Bahasa', it: 'Italiano',
  ja: '日本語', ko: '한국어', nl: 'Nederlands', pl: 'Polski',
  pt: 'Português', ro: 'Română', ru: 'Русский', sk: 'Slovenčina',
  sv: 'Svenska', sw: 'Kiswahili', tr: 'Türkçe', zh: '中文',
};
const locales: Record<string, any> = {
  root: { label: 'English', lang: 'en' }
};

try {
  const dirs = fs.readdirSync(__dirname + '/..');
  for (const dir of dirs) {
    if (/^[a-z]{2}$/.test(dir)) {
      locales[dir] = {
        label: LANG_LABELS[dir] || dir.toUpperCase(),
        lang: dir,
        dir: RTL_LANGS.has(dir) ? 'rtl' : 'ltr',
        link: `/${dir}/`
      };
    }
  }
} catch(e) {}

export default defineConfig({
  title: 'MIXI',
  description: 'Deterministic Audio Workstation — browser-native DJ engine with Rust/Wasm DSP, AI automixer, custom skins, and zero install.',
  locales,
  head: [
    ['meta', { name: 'theme-color', content: '#050508' }],
    ['meta', { name: 'author', content: 'Fabrizio Salmi' }],
    ['link', { rel: 'canonical', href: 'https://www.mixidaw.com/' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/icon-192.png' }],
    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'MIXI — Deterministic Audio Workstation' }],
    ['meta', { property: 'og:description', content: 'Browser-native DJ engine. Dual decks, Rust/Wasm DSP, AI automixer, beatmatching, custom skins, MIDI, headphone cue. Zero install.' }],
    ['meta', { property: 'og:image', content: 'https://www.mixidaw.com/screenshot-og.jpg' }],
    ['meta', { property: 'og:image:width', content: '1920' }],
    ['meta', { property: 'og:image:height', content: '1080' }],
    ['meta', { property: 'og:url', content: 'https://www.mixidaw.com/' }],
    ['meta', { property: 'og:site_name', content: 'MIXI' }],
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'MIXI — Deterministic Audio Workstation' }],
    ['meta', { name: 'twitter:description', content: 'Browser-native DJ engine. Dual decks, Rust/Wasm DSP, AI automixer, beatmatching, custom skins. Zero install.' }],
    ['meta', { name: 'twitter:image', content: 'https://www.mixidaw.com/screenshot-og.jpg' }],
  ],
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
          { text: 'AI AutoMixer & MIDI', link: '/guide/ai-automixer' },
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
          { text: 'WebAudio & Wasm DSP', link: '/guide/webaudio' },
          { text: 'BPM Detection', link: '/BPM' },
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/fabriziosalmi/mixi' }
    ]
  }
});
