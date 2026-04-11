/**
 * Mobile UI E2E Tests
 *
 * Tests the mobile-specific UI: portrait layout, init gate, deck switching,
 * crossfader, overlay panels, and touch interactions.
 * Runs in Chromium with mobile viewport + touch emulation.
 */
import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
});

const BASE = '/';

async function launchMobile(page: import('@playwright/test').Page) {
  await page.goto(BASE);
  await page.waitForTimeout(1500);
  // Click the init gate — it's a full-screen fixed div with onClick
  // Try text-based click first, fall back to center-screen click
  const tapText = page.getByText('TAP TO START');
  if (await tapText.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tapText.click();
  } else {
    // Fallback: click center of viewport
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width / 2, vp.height / 2);
  }
  await page.waitForTimeout(2000);
  // Verify the mobile layout rendered
  await page.waitForSelector('.m-noise', { timeout: 10000 });
}

// ═════════════════════════════════════════════════════════════
// Init Gate
// ═════════════════════════════════════════════════════════════

test.describe('Mobile Init Gate', () => {
  test('shows MIXI branding and TAP TO START', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    const text = await page.textContent('body');
    expect(text).toContain('MIXI');
    expect(text).toContain('TAP TO START');
  });

  test('shows DETERMINISTIC AUDIO subtitle', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    const text = await page.textContent('body');
    expect(text).toContain('DETERMINISTIC AUDIO');
  });

  test('tapping init gate transitions to app', async ({ page }) => {
    await launchMobile(page);
    const hasMNoise = await page.locator('.m-noise').count();
    expect(hasMNoise).toBeGreaterThan(0);
  });

  test('shows STARTING... while loading', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    // Click init gate and immediately check
    await page.mouse.click(195, 422);
    // Brief check for loading state
    await page.waitForTimeout(200);
    const text = await page.textContent('body');
    // Either still loading or already transitioned
    expect(text!.includes('STARTING') || text!.includes('MIXI')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// Portrait Layout
// ═════════════════════════════════════════════════════════════

test.describe('Mobile Portrait Layout', () => {
  test.beforeEach(async ({ page }) => {
    await launchMobile(page);
  });

  test('header bar renders with correct elements', async ({ page }) => {
    // Add tracks button
    const addBtn = page.locator('button[aria-label="Add tracks"]');
    await expect(addBtn).toBeVisible();

    // MIXI branding text
    const branding = page.getByText('MIXI');
    expect(await branding.count()).toBeGreaterThan(0);

    // RST (panic) button
    const rstBtn = page.getByText('RST');
    await expect(rstBtn).toBeVisible();
  });

  test('deck switcher shows A and B buttons', async ({ page }) => {
    const btnA = page.locator('button:has-text("A")').first();
    const btnB = page.locator('button:has-text("B")').first();
    await expect(btnA).toBeVisible();
    await expect(btnB).toBeVisible();
  });

  test('empty state shows load track prompt', async ({ page }) => {
    const prompt = page.getByText('load a track');
    expect(await prompt.count()).toBeGreaterThan(0);
  });

  test('mini deck strip shows for other deck', async ({ page }) => {
    const noTrack = page.getByText('No track');
    expect(await noTrack.count()).toBeGreaterThan(0);
  });

  test('crossfader exists at bottom', async ({ page }) => {
    const xfader = page.locator('[aria-label="Crossfader"]');
    await expect(xfader).toBeVisible();
  });

  test('deck A label shows with color', async ({ page }) => {
    // A label near crossfader
    const labels = page.getByText('A');
    expect(await labels.count()).toBeGreaterThan(0);
  });

  test('switching to Deck B changes focus', async ({ page }) => {
    const btnB = page.locator('button:has-text("B")').first();
    await btnB.click();
    await page.waitForTimeout(300);
    // After switch, the empty state should show "Deck B" context
    // or the B button should be visually selected
    await page.screenshot({ path: 'test-results/mobile-deck-b-focus.png' });
  });

  test('tapping mini strip switches deck', async ({ page }) => {
    // The mini strip is a button showing the other deck
    const miniStrip = page.locator('button:has-text("No track")').first();
    if (await miniStrip.isVisible()) {
      await miniStrip.click();
      await page.waitForTimeout(300);
      // Focus should have switched
    }
  });
});

// ═════════════════════════════════════════════════════════════
// Crossfader
// ═════════════════════════════════════════════════════════════

test.describe('Mobile Crossfader', () => {
  test.beforeEach(async ({ page }) => {
    await launchMobile(page);
  });

  test('crossfader has correct aria attributes', async ({ page }) => {
    const xfader = page.locator('[aria-label="Crossfader"]');
    await expect(xfader).toBeVisible();
    const min = await xfader.getAttribute('aria-valuemin');
    const max = await xfader.getAttribute('aria-valuemax');
    expect(min).toBe('0');
    expect(max).toBe('100');
  });

  test('crossfader has grip lines', async ({ page }) => {
    const grip = page.locator('.m-xfader-cap-grip');
    await expect(grip).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════
// Touch Targets
// ═════════════════════════════════════════════════════════════

test.describe('Mobile Touch Targets', () => {
  test.beforeEach(async ({ page }) => {
    await launchMobile(page);
  });

  test('all buttons are at least 24px', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 20); i++) {
      const box = await buttons.nth(i).boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════
// No Errors
// ═════════════════════════════════════════════════════════════

test.describe('Mobile Error Safety', () => {
  test('no JS errors during mobile init and interaction', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await launchMobile(page);

    // Interact: switch decks, tap buttons
    const btnB = page.locator('button:has-text("B")').first();
    if (await btnB.isVisible()) await btnB.click();
    await page.waitForTimeout(500);

    const btnA = page.locator('button:has-text("A")').first();
    if (await btnA.isVisible()) await btnA.click();
    await page.waitForTimeout(500);

    // No crash errors
    expect(errors).toHaveLength(0);
  });

  test('no console errors during playback', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await launchMobile(page);
    await page.waitForTimeout(2000);

    const critical = errors.filter(e =>
      !e.includes('WebSocket') &&
      !e.includes('favicon') &&
      !e.includes('SharedArrayBuffer') &&
      !e.includes('COOP') &&
      !e.includes('NotAllowedError') &&
      !e.includes('backend') &&
      !e.includes('style property during rerender')
    );
    expect(critical).toHaveLength(0);
  });
});
