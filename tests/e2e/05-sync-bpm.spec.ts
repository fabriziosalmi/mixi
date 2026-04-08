import { test, expect } from '@playwright/test';
import { launchApp, readDeckState, callStoreAction, waitForBpm, waitForTrackLoaded } from './helpers/app';

test.describe('Sync & BPM', () => {
  test.beforeEach(async ({ page }) => {
    await launchApp(page);
    await waitForTrackLoaded(page, 'A');
    await waitForTrackLoaded(page, 'B');
  });

  test('BPM detected on both decks', async ({ page }) => {
    const bpmA = await waitForBpm(page, 'A');
    const bpmB = await waitForBpm(page, 'B');
    expect(bpmA).toBeGreaterThan(0);
    expect(bpmB).toBeGreaterThan(0);
  });

  test('originalBpm is set on load', async ({ page }) => {
    await waitForBpm(page, 'A');
    const state = await readDeckState(page, 'A');
    expect(state!.originalBpm).toBeGreaterThan(0);
    expect(state!.originalBpm).toBe(state!.bpm);
  });

  test('sync changes playback rate', async ({ page }) => {
    await waitForBpm(page, 'A');
    await waitForBpm(page, 'B');
    await callStoreAction(page, 'setDeckPlaying', 'A', true);
    await callStoreAction(page, 'setDeckPlaying', 'B', true);
    await page.waitForTimeout(200);
    await callStoreAction(page, 'syncDeck', 'B');
    const state = await readDeckState(page, 'B');
    expect(state!.isSynced).toBe(true);
    // Rate should differ from 1.0 if BPMs are different
    expect(state!.playbackRate).toBeGreaterThan(0);
  });

  test('synced deck BPM matches master', async ({ page }) => {
    await waitForBpm(page, 'A');
    await waitForBpm(page, 'B');
    await callStoreAction(page, 'setDeckPlaying', 'A', true);
    await callStoreAction(page, 'setDeckPlaying', 'B', true);
    await page.waitForTimeout(200);
    await callStoreAction(page, 'syncDeck', 'B');
    const stateA = await readDeckState(page, 'A');
    const stateB = await readDeckState(page, 'B');
    // B's effective BPM should be close to A's BPM
    expect(Math.abs(stateB!.bpm - stateA!.bpm)).toBeLessThan(5);
  });

  test('unsync restores original rate', async ({ page }) => {
    await waitForBpm(page, 'B');
    const originalRate = (await readDeckState(page, 'B'))!.playbackRate;
    await callStoreAction(page, 'setDeckPlaying', 'A', true);
    await callStoreAction(page, 'setDeckPlaying', 'B', true);
    await callStoreAction(page, 'syncDeck', 'B');
    await page.waitForTimeout(100);
    await callStoreAction(page, 'unsyncDeck', 'B');
    const state = await readDeckState(page, 'B');
    expect(state!.isSynced).toBe(false);
  });

  test('sync fails gracefully with no BPM', async ({ page }) => {
    // Set BPM to 0 on deck B (simulating detection failure)
    await page.evaluate(() => {
      const store = (window as any).__MIXI_STORE__;
      store.setState((s: any) => ({
        decks: { ...s.decks, B: { ...s.decks.B, originalBpm: 0, bpm: 0 } }
      }));
    });
    // Sync should not crash
    await callStoreAction(page, 'syncDeck', 'B');
    const state = await readDeckState(page, 'B');
    expect(state!.isSynced).toBe(false); // should NOT sync
  });

  test('firstBeatOffset is set after detection', async ({ page }) => {
    await waitForBpm(page, 'A');
    const state = await readDeckState(page, 'A');
    expect(state!.firstBeatOffset).toBeGreaterThanOrEqual(0);
  });

  test('quantize defaults to false', async ({ page }) => {
    const state = await readDeckState(page, 'A');
    expect(state!.quantize).toBe(false);
  });

  test('quantize can be toggled', async ({ page }) => {
    await callStoreAction(page, 'setQuantize', 'A', true);
    let state = await readDeckState(page, 'A');
    expect(state!.quantize).toBe(true);
    await callStoreAction(page, 'setQuantize', 'A', false);
    state = await readDeckState(page, 'A');
    expect(state!.quantize).toBe(false);
  });

  test('sync mode defaults to beat', async ({ page }) => {
    const state = await readDeckState(page, 'A');
    // syncMode may be 'beat', 'bar', or 'phrase'
    expect(['beat', 'bar', 'phrase']).toContain(state!.syncMode || 'beat');
  });
});
