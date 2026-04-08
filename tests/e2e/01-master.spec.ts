import { test, expect } from '@playwright/test';
import { launchApp, readMasterState, callStoreAction } from './helpers/app';

test.describe('Master Controls', () => {
  test.beforeEach(async ({ page }) => {
    await launchApp(page);
  });

  test('app loads with default master volume', async ({ page }) => {
    const state = await readMasterState(page);
    expect(state).not.toBeNull();
    expect(state!.masterVolume).toBeGreaterThan(0);
  });

  test('master volume can be set to 0 (mute)', async ({ page }) => {
    await callStoreAction(page, 'setMasterVolume', 0);
    const state = await readMasterState(page);
    expect(state!.masterVolume).toBe(0);
  });

  test('master volume can be set to 1 (max)', async ({ page }) => {
    await callStoreAction(page, 'setMasterVolume', 1);
    const state = await readMasterState(page);
    expect(state!.masterVolume).toBe(1);
  });

  test('crossfader defaults to center (0.5)', async ({ page }) => {
    const state = await readMasterState(page);
    expect(state!.crossfader).toBeCloseTo(0.5, 1);
  });

  test('crossfader can be set to full A (0)', async ({ page }) => {
    await callStoreAction(page, 'setCrossfader', 0);
    const state = await readMasterState(page);
    expect(state!.crossfader).toBe(0);
  });

  test('crossfader can be set to full B (1)', async ({ page }) => {
    await callStoreAction(page, 'setCrossfader', 1);
    const state = await readMasterState(page);
    expect(state!.crossfader).toBe(1);
  });

  test('master filter defaults to 0 (off)', async ({ page }) => {
    const state = await readMasterState(page);
    expect(state!.masterFilter).toBe(0);
  });

  test('master filter can sweep LPF (-1)', async ({ page }) => {
    await callStoreAction(page, 'setMasterFilter', -1);
    const state = await readMasterState(page);
    expect(state!.masterFilter).toBe(-1);
  });

  test('master filter can sweep HPF (+1)', async ({ page }) => {
    await callStoreAction(page, 'setMasterFilter', 1);
    const state = await readMasterState(page);
    expect(state!.masterFilter).toBe(1);
  });

  test('master distortion defaults to 0', async ({ page }) => {
    const state = await readMasterState(page);
    expect(state!.masterDistortion).toBe(0);
  });

  test('master distortion can be set', async ({ page }) => {
    await callStoreAction(page, 'setMasterDistortion', 0.7);
    const state = await readMasterState(page);
    expect(state!.masterDistortion).toBeCloseTo(0.7, 1);
  });

  test('master punch defaults to 0', async ({ page }) => {
    const state = await readMasterState(page);
    expect(state!.masterPunch).toBe(0);
  });

  test('master punch can be set', async ({ page }) => {
    await callStoreAction(page, 'setMasterPunch', 0.5);
    const state = await readMasterState(page);
    expect(state!.masterPunch).toBeCloseTo(0.5, 1);
  });

  test('crossfader curve can be switched', async ({ page }) => {
    await callStoreAction(page, 'setCrossfaderCurve', 'sharp');
    let state = await readMasterState(page);
    expect(state!.crossfaderCurve).toBe('sharp');

    await callStoreAction(page, 'setCrossfaderCurve', 'smooth');
    state = await readMasterState(page);
    expect(state!.crossfaderCurve).toBe('smooth');
  });
});
