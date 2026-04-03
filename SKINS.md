# 🎨 Mixi Skins Development Guide

Welcome to the **Mixi Skin Ecosystem**! This guide is for UI/UX designers and frontend developers who want to contribute new visual themes (Skins) to the core Mixi repository. 

Our architecture ensures that creating a skin requires **zero knowledge** of React, Audio DSP, or Python. If you know CSS, you can design a Mixi Skin.

## 1. How Skins Work in Mixi
Mixi's user interface is heavily driven by **CSS Variables**. The core components (Mixer, Decks, Waveforms, Buttons) do not have hardcoded colors. Instead, they reference variables like `var(--srf-mid)` or `var(--clr-a)`. 

A "Skin" is simply a folder containing a JSON metadata file and a CSS file overriding these variables.

## 2. Creating Your Skin

### Step 1: Fork and Clone
Fork the official GitHub mirror repository and clone it to your local machine:
```bash
git clone https://github.com/fabriziosalmi/mixi.git
```

### Step 2: Create the Folder
Navigate to the `skins/` directory. Create a new folder with your skin's identifier (kebab-case).
```bash
cd skins/
mkdir skin-cyberpunk
```

### Step 3: `skin.json` (The Metadata)
Inside your folder, create a `skin.json` file. This is mandatory for Mixi to register your skin.
```json
{
  "id": "skin-cyberpunk",
  "name": "Neon Cyberpunk",
  "author": "Your Name / Handle",
  "version": "1.0.0",
  "description": "High contrast neon pink and cyan over pitch black."
}
```

### Step 4: `skin.css` (The Styles)
Create a `skin.css` file in the same folder. Define your color palette within the `:root` selector.
```css
/* skins/skin-cyberpunk/skin.css */

:root {
  /* Surfaces & Backgrounds */
  --bg-app: #050510;
  --srf-low: #0a0a1a;
  --srf-mid: #10102a;
  --srf-raised: #1a1a3a;
  
  /* Deck Colors (Standard Mixi Convention) */
  --clr-a: #ff007f; /* Deck A - Neon Pink */
  --clr-b: #00ffff; /* Deck B - Neon Cyan */
  --clr-c: #ffaa00; /* Deck C - Warning Orange */
  --clr-d: #8a2be2; /* Deck D - Purple */

  /* Text & Borders */
  --txt-white: #ffffff;
  --txt-muted: #8888aa;
  --brd-default: #222244;
  
  /* Waveform Colors (3-Band EQ) */
  --wave-low: #ff007f;
  --wave-mid: #00ffff;
  --wave-high: #ffffff;
  --wave-bg: #000000;
  --wave-playhead: #ffffff;
}
```
*Note: You customize fonts by overriding `font-family` on body/root or importing Google Fonts at the top of your CSS file.*

## 3. Testing Locally
1. Run the local development server:
   ```bash
   npm run dev
   ```
2. Open the Mixi UI in your browser (`localhost:5173`).
3. Your new skin will automatically appear in the **Settings > Themes** dropdown. Select it to see your styling applied live via Hot Module Replacement (HMR).

## 4. Submitting Your Skin
We maintain strict control over the core repository to guarantee stability. Features and skins are accepted via **Pull Requests (PR)**.
1. Commit your new `skins/skin-cyberpunk/` folder to a new branch.
2. Push to your fork.
3. Open a Pull Request targeting the `main` branch of the official GitHub mirror (`https://github.com/fabriziosalmi/mixi`).
4. Attach a screenshot or a short GIF of your skin in action within the PR description!
