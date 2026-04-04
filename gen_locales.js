const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, 'docs');
const dirs = fs.readdirSync(docsDir).filter(f => {
  return fs.statSync(path.join(docsDir, f)).isDirectory() && /^[a-z]{2}$/.test(f);
});

const locales = {
  root: {
    label: 'English',
    lang: 'en'
  }
};

for (const lang of dirs) {
  locales[lang] = {
    label: lang.toUpperCase(),
    lang: lang
  };
}

console.log(JSON.stringify(locales, null, 2));
