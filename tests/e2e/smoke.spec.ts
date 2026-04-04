import { test, expect } from '@playwright/test';

test.describe('App Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // App shows a splash screen with "Launch Mixi" button.
    // Click it to initialize AudioContext and enter the app.
    const launchBtn = page.locator('button[aria-label="Launch Mixi"]');
    await launchBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await launchBtn.click();
    // Wait for main app shell — may take a few seconds (loads demo tracks)
    await page.waitForSelector('.mixi-chassis', { timeout: 20_000 });
  });

  test('app loads and renders main layout', async ({ page }) => {
    await expect(page.locator('.mixi-chassis')).toBeVisible();
  });

  test('deck labels visible', async ({ page }) => {
    await expect(page.getByText('HOT CUE').first()).toBeVisible();
    await expect(page.getByText('AUTO LOOP').first()).toBeVisible();
  });

  test('VFX toggle exists', async ({ page }) => {
    const vfxBtn = page.locator('button[title*="VFX"]');
    await expect(vfxBtn).toBeVisible();
  });

  test('REC button exists', async ({ page }) => {
    await expect(page.locator('text=REC').first()).toBeVisible();
  });

  test('no critical console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    const launchBtn = page.locator('button[aria-label="Launch Mixi"]');
    await launchBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await launchBtn.click();
    await page.waitForSelector('.mixi-chassis', { timeout: 20_000 });
    // Filter expected errors
    const critical = errors.filter((e) =>
      !e.includes('WebSocket') &&
      !e.includes('favicon') &&
      !e.includes('COOP') &&
      !e.includes('SharedArrayBuffer') &&
      !e.includes('NotAllowedError') &&
      !e.includes('backend'),
    );
    expect(critical).toHaveLength(0);
  });
});
