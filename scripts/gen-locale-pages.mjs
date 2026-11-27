#!/usr/bin/env node
/**
 * Generate clean locale homepage files from existing translations.
 *
 * Preserves each locale's translated frontmatter and manifesto text,
 * while HeroShowcase is rendered automatically above features via Layout.vue
 * (#home-hero-after) using optional `showcaseCaption` in frontmatter.
 *
 * Usage: node scripts/gen-locale-pages.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '..', 'docs');

function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const localeDirs = fs
  .readdirSync(DOCS)
  .filter((d) => /^[a-z]{2}$/.test(d) && fs.statSync(path.join(DOCS, d)).isDirectory())
  .sort();

console.log(`Found ${localeDirs.length} locales: ${localeDirs.join(', ')}`);

let updated = 0;

for (const locale of localeDirs) {
  const localeFile = path.join(DOCS, locale, 'index.md');
  if (!fs.existsSync(localeFile)) {
    console.log(`  [SKIP] ${locale} - no index.md`);
    continue;
  }

  const content = fs.readFileSync(localeFile, 'utf8');

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    console.log(`  [SKIP] ${locale} - no frontmatter`);
    continue;
  }
  let frontmatter = fmMatch[0];

  // Move any legacy HeroShowcase caption into frontmatter.showcaseCaption
  const captionAttrMatch = content.match(/<HeroShowcase[^>]*caption="([^"]+)"/);
  if (captionAttrMatch && !frontmatter.includes('showcaseCaption:')) {
    const cleanCaption = captionAttrMatch[1].replace(/—/g, '·').replace(/"/g, '\\"');
    frontmatter = frontmatter.replace(/^---\n/, `---\nshowcaseCaption: "${cleanCaption}"\n`);
  }

  // Preserve translated manifesto title/text if previously present
  const titleAttrMatch = content.match(/<ReleaseManifesto[^>]*title="([^"]+)"/);
  const titleHtmlMatch = content.match(/<h2 class="manifesto-title">([\s\S]*?)<\/h2>/);
  const rawTitle = titleAttrMatch
    ? titleAttrMatch[1]
    : titleHtmlMatch
      ? stripTags(titleHtmlMatch[1])
      : '';

  const textAttrMatch = content.match(/<ReleaseManifesto[^>]*text="([^"]+)"/);
  const textHtmlMatch = content.match(/<p class="manifesto-text">([\s\S]*?)<\/p>/);
  const rawText = textAttrMatch
    ? textAttrMatch[1]
    : textHtmlMatch
      ? stripTags(textHtmlMatch[1])
      : '';

  const manifestoProps = [];
  if (rawTitle) manifestoProps.push(`title="${escapeAttr(rawTitle)}"`);
  if (rawText) manifestoProps.push(`text="${escapeAttr(rawText)}"`);
  const manifestoTag =
    manifestoProps.length > 0
      ? `<ReleaseManifesto ${manifestoProps.join(' ')} />`
      : '<ReleaseManifesto />';

  const output = `${frontmatter}

<VerifiedSpecs />

<DownloadStrip />

${manifestoTag}
`;

  fs.writeFileSync(localeFile, output, 'utf8');
  updated++;
}

console.log(`Done: ${updated} locale homepages regenerated cleanly.`);
