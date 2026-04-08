import { test, expect } from '@playwright/test';
import { launchApp, readDeckState, callStoreAction, waitForTrackLoaded, waitForBpm } from './helpers/app';

test.describe('Deck Playback', () => {
  test.beforeEach(async ({ page }) => {
    await launchApp(page);
  });

  test('Deck A starts paused', async ({ page }) => {
    const state = await readDeckState(page, 'A');
    expect(state).not.toBeNull();
    expect(state!.isPlaying).toBe(false);
  });

  test('Deck B starts paused', async ({ page }) => {
    const state = await readDeckState(page, 'B');
    expect(state!.isPlaying).toBe(false);
  });

  test('demo track loads on Deck A', async ({ page }) => {
    await waitForTrackLoaded(page, 'A');
    const state = await readDeckState(page, 'A');
    expect(state!.isTrackLoaded).toBe(true);
    expect(state!.trackName).toBeTruthy();
    expect(state!.duration).toBeGreaterThan(0);
  });

  test('demo track loads on Deck B', async ({ page }) => {
    await waitForTrackLoaded(page, 'B');
    const state = await readDeckState(page, 'B');
    expect(state!.isTrackLoaded).toBe(true);
  });

  test('play Deck A via store action', async ({ page }) => {
    await waitForTrackLoaded(page, 'A');
    await callStoreAction(page, 'setDeckPlaying', 'A', true);
    const state = await readDeckState(page, 'A');
    expect(state!.isPlaying).toBe(true);
  });

  test('pause Deck A via store action', async ({ page }) => {
    await waitForTrackLoaded(page, 'A');
    await callStoreAction(page, 'setDeckPlaying', 'A', true);
    await page.waitForTimeout(200);
    await callStoreAction(page, 'setDeckPlaying', 'A', false);
    const state = await readDeckState(page, 'A');
    expect(state!.isPlaying).toBe(false);
  });

  test('deck volume defaults to 1', async ({ page }) => {
    const state = await readDeckState(page, 'A');
    expect(state!.volume).toBe(1);
  });

  test('deck volume can be set to 0', async ({ page }) => {
    await callStoreAction(page, 'setDeckVolume', 'A', 0);
    const state = await readDeckState(page, 'A');
    expect(state!.volume).toBe(0);
  });

  test('deck gain defaults to 0 dB', async ({ page }) => {
    const state = await readDeckState(page, 'A');
    expect(state!.gain).toBe(0);
  });

  test('deck EQ defaults to 0 dB (flat)', async ({ page }) => {
    const state = await readDeckState(page, 'A');
    expect(state!.eq.low).toBe(0);
    expect(state!.eq.mid).toBe(0);
    expect(state!.eq.high).toBe(0);
  });

  test('deck EQ can cut low', async ({ page }) => {
    await callStoreAction(page, 'setDeckEq', 'A', 'low', -26);
    const state = await readDeckState(page, 'A');
    expect(state!.eq.low).toBe(-26);
  });

  test('deck playback rate defaults to 1.0', async ({ page }) => {
    const state = await readDeckState(page, 'A');
    expect(state!.playbackRate).toBe(1);
  });

  test('BPM is detected on loaded demo track', async ({ page }) => {
    const bpm = await waitForBpm(page, 'A');
    expect(bpm).toBeGreaterThan(60);
    expect(bpm).toBeLessThan(200);
  });

  test('BPM confidence is reported', async ({ page }) => {
    await waitForBpm(page, 'A');
    const state = await readDeckState(page, 'A');
    expect(state!.bpmConfidence).toBeGreaterThan(0);
  });

  test('both decks can play simultaneously', async ({ page }) => {
    await waitForTrackLoaded(page, 'A');
    await waitForTrackLoaded(page, 'B');
    await callStoreAction(page, 'setDeckPlaying', 'A', true);
    await callStoreAction(page, 'setDeckPlaying', 'B', true);
    const stateA = await readDeckState(page, 'A');
    const stateB = await readDeckState(page, 'B');
    expect(stateA!.isPlaying).toBe(true);
    expect(stateB!.isPlaying).toBe(true);
  });
});
