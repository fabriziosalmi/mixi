#!/usr/bin/env node
/**
 * Generate complete locale homepage files from existing translations.
 *
 * Takes each locale's frontmatter (already translated) and injects the
 * shared interactive blocks (script, HomeIntro, GET bar, install, stats,
 * manifesto, styles) that are identical across all languages.
 *
 * Usage: node scripts/gen-locale-pages.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '..', 'docs');

// Read the English master to extract shared blocks
const enContent = fs.readFileSync(path.join(DOCS, 'index.md'), 'utf8');

// Extract the <script setup> block (everything between first <script setup> and </script>)
const scriptMatch = enContent.match(/<script setup>[\s\S]*?<\/script>/);
const scriptBlock = scriptMatch ? scriptMatch[0] : '';

// Extract <style> block
const styleMatch = enContent.match(/<style>[\s\S]*?<\/style>/);
const styleBlock = styleMatch ? styleMatch[0] : '';

// The shared HTML blocks (GET bar, install, screenshot framework)
// These are language-independent (SVG icons, links, code)
const sharedHtml = `
<HomeIntro />

<!-- GET BAR -->
<div class="get-bar-spacer"></div>
<div class="get-bar">
  <div class="get-bar-inner">
    <span class="get-label">GET</span>
    <div class="get-divider"></div>
    <a href="https://fabriziosalmi.github.io/mixi/app/" class="get-item" title="Open in Browser" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span class="get-plat">Web</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item" title="macOS ARM64" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      <span class="get-plat">ARM64</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item" title="macOS Intel" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      <span class="get-plat">Intel</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item get-item-win" title="Windows" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>
      <span class="get-plat">Win</span>
    </a>
    <a href="https://github.com/fabriziosalmi/mixi/releases/latest" class="get-item get-item-linux" title="Linux" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.564.517.135 1.08.133 1.526-.054.453-.231.792-.702.869-1.299.19-.001.378-.013.564-.04.594-.104 1.124-.397 1.458-.932.053-.085.104-.168.14-.268.005-.011.009-.023.013-.035.15-.332.097-.667-.12-.956-.205-.283-.493-.463-.745-.553-.573-.206-1.236-.132-1.852.06-.088.028-.178.058-.27.089.007-.112.007-.225 0-.336-.022-.327-.138-.637-.32-.846a1.46 1.46 0 00-.27-.2c-3.048-2.124-3.088-5.283-3.054-5.79.073-.837.224-1.603.55-2.348.466-1.063 1.15-2.025 1.55-3.094.452-1.255.67-2.723-.035-3.964C14.816.568 13.687.03 12.504 0z"/></svg>
      <span class="get-plat">Linux</span>
    </a>
    <a href="https://hub.docker.com/r/fabriziosalmi/mixi" class="get-item get-item-docker" title="Docker" target="_blank" rel="noopener">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186H5.136a.186.186 0 00-.186.185v1.888c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/></svg>
      <span class="get-plat">Docker</span>
    </a>
  </div>
  <div class="get-scanline"></div>
</div>

<div class="install-cmd">
  <div class="install-inner">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
    <code>curl -sL https://raw.githubusercontent.com/fabriziosalmi/mixi/main/install.sh | bash</code>
  </div>
</div>
<div class="get-bar-spacer"></div>
`;

// Find all locale dirs
const localeDirs = fs.readdirSync(DOCS)
  .filter(d => /^[a-z]{2}$/.test(d) && fs.statSync(path.join(DOCS, d)).isDirectory());

console.log(`Found ${localeDirs.length} locales: ${localeDirs.join(', ')}`);

let updated = 0;

for (const locale of localeDirs) {
  const localeFile = path.join(DOCS, locale, 'index.md');
  if (!fs.existsSync(localeFile)) {
    console.log(`  [SKIP] ${locale} — no index.md`);
    continue;
  }

  const content = fs.readFileSync(localeFile, 'utf8');

  // Extract frontmatter (between --- and ---)
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    console.log(`  [SKIP] ${locale} — no frontmatter`);
    continue;
  }
  const frontmatter = fmMatch[0];

  // Extract existing translated sections (showcase, stats, manifesto)
  // We keep these as-is since they're already translated
  const showcaseMatch = content.match(/<div class="hero-showcase">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  const statsMatch = content.match(/<div class="stats-row">[\s\S]*?<\/div>\s*<\/div>/);
  const manifestoMatch = content.match(/<div class="manifesto-section">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);

  // Use existing translations or fallback to English
  const showcase = showcaseMatch ? showcaseMatch[0] : `<div class="hero-showcase">
  <div class="showcase-glow"></div>
  <div class="showcase-frame">
    <picture><source srcset="/screenshot.webp" type="image/webp" /><img src="/screenshot.png" loading="eager" width="1920" height="1080" alt="MIXI interface" /></picture>
    <div class="showcase-reflection"></div>
  </div>
  <div class="showcase-caption"><span class="caption-dot"></span><span>Live Interface</span></div>
</div>`;

  // Stats: update to current numbers (language-independent metrics)
  const stats = `<div class="stats-row">
  <div class="stat-item"><span class="stat-number">99.7%</span><span class="stat-label">CPU Headroom</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">1.61</span><span class="stat-label">&micro;s Pipeline</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">555</span><span class="stat-label">Tests</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">17</span><span class="stat-label">Skins</span></div>
  <div class="stat-divider"></div>
  <div class="stat-item"><span class="stat-number">143</span><span class="stat-label">KB Wasm</span></div>
</div>`;

  const manifesto = manifestoMatch ? manifestoMatch[0] : `<div class="manifesto-section">
  <div class="manifesto-inner">
    <h2 class="manifesto-title">Open Core. Free to Play.</h2>
    <p class="manifesto-text">PolyForm Noncommercial 1.0.0</p>
    <div class="manifesto-links">
      <a href="https://github.com/fabriziosalmi/mixi" class="manifesto-link">GitHub</a>
    </div>
  </div>
</div>`;

  // Fix relative paths: locale pages are one level deeper than root
  const fixedScript = scriptBlock
    .replace(/from '\.\/\.vitepress/g, "from '../.vitepress");
  const fixedHtml = sharedHtml
    .replace(/<HomeIntro \/>/g, ''); // HomeIntro only works from root — skip in locales

  // Assemble the complete page
  const output = `${frontmatter}

${fixedScript}

${fixedHtml}

${showcase}

${stats}

${manifesto}

${styleBlock}
`;

  fs.writeFileSync(localeFile, output, 'utf8');
  const lines = output.split('\n').length;
  console.log(`  [OK] ${locale} — ${lines} lines`);
  updated++;
}

console.log(`\nDone: ${updated} locales updated to full parity with English.`);
