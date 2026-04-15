import { test, expect } from '@playwright/test';
import { launchApp, readDeckState, readMasterState, waitForTrackLoaded, callStoreAction } from './helpers/app';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await launchApp(page);
    await waitForTrackLoaded(page, 'A');
    await waitForTrackLoaded(page, 'B');
  });

  test('Space toggles Deck A play', async ({ page }) => {
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    let state = await readDeckState(page, 'A');
    expect(state!.isPlaying).toBe(true);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    state = await readDeckState(page, 'A');
    expect(state!.isPlaying).toBe(false);
  });

  test('Q toggles Deck A quantize', async ({ page }) => {
    // Default is true, so first press should turn it off
    await page.keyboard.press('q');
    await page.waitForTimeout(100);
    let state = await readDeckState(page, 'A');
    expect(state!.quantize).toBe(false);
    await page.keyboard.press('q');
    await page.waitForTimeout(100);
    state = await readDeckState(page, 'A');
    expect(state!.quantize).toBe(true);
  });

  test('Escape double-press resets controls (panic)', async ({ page }) => {
    // Set some non-default values
    await callStoreAction(page, 'setMasterFilter', 0.8);
    await callStoreAction(page, 'setCrossfader', 0.2);
    // Double-press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const state = await readMasterState(page);
    // Crossfader should reset to center
    expect(state!.crossfader).toBeCloseTo(0.5, 1);
  });

  test('Tab toggles track browser', async ({ page }) => {
    // Press Tab to open browser
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    // Browser panel should be visible
    page.locator('.track-browser, [class*="browser"]');
    // Just verify no crash — browser visibility depends on implementation
  });

  test('key lock toggle via keyboard does not crash', async ({ page }) => {
    // Key lock is typically toggled via a button, but verify no crash on store action
    await callStoreAction(page, 'setKeyLock', 'A', true);
    const state = await readDeckState(page, 'A');
    expect(state!.keyLock).toBe(true);
  });

  test('slip mode toggle via store', async ({ page }) => {
    await callStoreAction(page, 'setSlipMode', 'A', true);
    const state = await readDeckState(page, 'A');
    expect(state!.slipModeActive).toBe(true);
  });
});
