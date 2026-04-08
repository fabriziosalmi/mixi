/**
 * E2E test helpers — app lifecycle and common interactions.
 */
import { type Page, expect } from '@playwright/test';

/**
 * Launch the app: navigate, click the splash button, wait for chassis.
 * Every E2E test should call this in beforeEach or at the start.
 */
export async function launchApp(page: Page): Promise<void> {
  await page.goto('/');

  // The app shows a splash/onboarding gate. Click past it.
  // Try multiple possible selectors (splash varies by version).
  const launchBtn = page.locator(
    'button:has-text("Launch"), button:has-text("Start"), button:has-text("Enter"), [aria-label="Launch Mixi"]'
  );

  try {
    await launchBtn.first().waitFor({ state: 'visible', timeout: 8000 });
    await launchBtn.first().click();
  } catch {
    // Some builds auto-init without splash — proceed
  }

  // Wait for the main app shell to render
  await page.waitForSelector('.mixi-chassis, #root > div', { timeout: 15000 });
  // Give audio engine a moment to initialize
  await page.waitForTimeout(500);
}

/**
 * Wait for demo tracks to load and BPM to be detected on a deck.
 */
export async function waitForBpm(page: Page, deck: 'A' | 'B', timeout = 10000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const bpm = await page.evaluate((d) => {
      const store = (window as any).__MIXI_STORE__;
      if (!store) return 0;
      return store.getState().decks[d].bpm;
    }, deck);
    if (bpm > 0) return bpm;
    await page.waitForTimeout(200);
  }
  throw new Error(`BPM not detected on Deck ${deck} within ${timeout}ms`);
}

/**
 * Wait for a track to be loaded on a deck.
 */
export async function waitForTrackLoaded(page: Page, deck: 'A' | 'B', timeout = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const loaded = await page.evaluate((d) => {
      const store = (window as any).__MIXI_STORE__;
      if (!store) return false;
      return store.getState().decks[d].isTrackLoaded;
    }, deck);
    if (loaded) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`Track not loaded on Deck ${deck} within ${timeout}ms`);
}

/**
 * Read the full state of a deck from the store.
 */
export async function readDeckState(page: Page, deck: 'A' | 'B') {
  return page.evaluate((d) => {
    const store = (window as any).__MIXI_STORE__;
    if (!store) return null;
    const s = store.getState().decks[d];
    // Return a plain object (no Proxy)
    return {
      isPlaying: s.isPlaying,
      isTrackLoaded: s.isTrackLoaded,
      bpm: s.bpm,
      originalBpm: s.originalBpm,
      volume: s.volume,
      gain: s.gain,
      playbackRate: s.playbackRate,
      isSynced: s.isSynced,
      trackName: s.trackName,
      duration: s.duration,
      hotCues: [...s.hotCues],
      activeLoop: s.activeLoop,
      quantize: s.quantize,
      keyLock: s.keyLock,
      slipModeActive: s.slipModeActive,
      musicalKey: s.musicalKey,
      eq: { ...s.eq },
      colorFx: s.colorFx,
      firstBeatOffset: s.firstBeatOffset,
      bpmConfidence: s.bpmConfidence,
    };
  }, deck);
}

/**
 * Read master state from the store.
 */
export async function readMasterState(page: Page) {
  return page.evaluate(() => {
    const store = (window as any).__MIXI_STORE__;
    if (!store) return null;
    const s = store.getState();
    return {
      masterVolume: s.master.volume,
      masterFilter: s.master.filter,
      masterDistortion: s.master.distortion,
      masterPunch: s.master.punch,
      crossfader: s.crossfader,
      crossfaderCurve: s.crossfaderCurve,
      masterEq: { ...s.master.eq },
      aiMode: s.aiMode,
    };
  });
}

/**
 * Read settings from the store.
 */
export async function readSettings(page: Page) {
  return page.evaluate(() => {
    const store = (window as any).__SETTINGS_STORE__;
    if (!store) return null;
    return store.getState();
  });
}

/**
 * Call a store action directly (bypasses UI for setup).
 */
export async function callStoreAction(page: Page, action: string, ...args: any[]) {
  return page.evaluate(({ action, args }) => {
    const store = (window as any).__MIXI_STORE__;
    if (!store) throw new Error('Store not available');
    const fn = store.getState()[action];
    if (typeof fn !== 'function') throw new Error(`Action ${action} not found`);
    return fn(...args);
  }, { action, args });
}

/**
 * Check if store is available (app fully initialized).
 */
export async function isStoreReady(page: Page): Promise<boolean> {
  return page.evaluate(() => !!(window as any).__MIXI_STORE__);
}
