/**
 * E2E Audio Helpers — synthetic audio generation, WAV encoding,
 * level measurement, and phase error calculation.
 *
 * All audio generation runs INSIDE the browser via page.evaluate()
 * using OfflineAudioContext for deterministic output.
 */
import { type Page } from '@playwright/test';

// ── Generate & Load Synthetic Track ──────────────────────────

/**
 * Generate a synthetic kick track at a known BPM and load it
 * onto a deck. Runs entirely in the browser.
 */
export async function loadSynthTrack(
  page: Page,
  deck: 'A' | 'B',
  bpm: number,
  durationSec = 5,
): Promise<void> {
  await page.evaluate(async ({ deck, bpm, durationSec }) => {
    const engine = (window as any).__MIXI_ENGINE__;
    const store = (window as any).__MIXI_STORE__;
    if (!engine || !store) throw new Error('Engine/Store not ready');

    const sr = 44100;
    const samples = sr * durationSec;
    const beatInterval = (60 / bpm) * sr;

    // Generate kick drum audio (sine sweep 150→50 Hz, 80ms decay)
    const pcm = new Float32Array(samples);
    let pos = 0;
    while (pos < samples) {
      const kickLen = Math.floor(sr * 0.08);
      for (let i = 0; i < kickLen && Math.floor(pos) + i < samples; i++) {
        const t = i / sr;
        const freq = 150 * Math.exp(-t * 30) + 50;
        const env = Math.exp(-t * 25);
        pcm[Math.floor(pos) + i] += 0.8 * env * Math.sin(2 * Math.PI * freq * t);
      }
      pos += beatInterval;
    }

    // Encode to WAV ArrayBuffer
    const wavLen = 44 + samples * 2;
    const wav = new ArrayBuffer(wavLen);
    const v = new DataView(wav);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + samples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);    // PCM
    v.setUint16(22, 1, true);    // mono
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, 'data');
    v.setUint32(40, samples * 2, true);
    let off = 44;
    for (let i = 0; i < samples; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }

    // Load into engine
    await engine.loadTrack(deck, wav);
    store.getState().setDeckTrackName(deck, `Synth ${bpm}BPM`);
    store.getState().setDeckTrackLoaded(deck, true);
  }, { deck, bpm, durationSec });
}

// ── Level Measurement ────────────────────────────────────────

/**
 * Read a stable RMS level of a deck (0–1).
 * Takes the MAX of 5 samples over 250ms to avoid measuring
 * silence between kick hits (which gives false 0.000 readings).
 */
export async function getLevel(page: Page, deck: 'A' | 'B'): Promise<number> {
  return page.evaluate(async (d) => {
    const engine = (window as any).__MIXI_ENGINE__;
    if (!engine?.getLevel) return 0;
    let peak = 0;
    for (let i = 0; i < 5; i++) {
      peak = Math.max(peak, engine.getLevel(d));
      await new Promise(r => setTimeout(r, 50));
    }
    return peak;
  }, deck);
}

/**
 * Read a stable master RMS level (0–1).
 * Same windowed-peak strategy as getLevel.
 */
export async function getMasterLevel(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const engine = (window as any).__MIXI_ENGINE__;
    if (!engine?.getMasterLevel) return 0;
    let peak = 0;
    for (let i = 0; i < 5; i++) {
      peak = Math.max(peak, engine.getMasterLevel());
      await new Promise(r => setTimeout(r, 50));
    }
    return peak;
  });
}

/**
 * Sample levels N times with intervalMs delay. Returns array of readings.
 */
export async function sampleLevels(
  page: Page,
  deck: 'A' | 'B' | 'master',
  count: number,
  intervalMs = 50,
): Promise<number[]> {
  const levels: number[] = [];
  for (let i = 0; i < count; i++) {
    if (deck === 'master') {
      levels.push(await getMasterLevel(page));
    } else {
      levels.push(await getLevel(page, deck));
    }
    if (i < count - 1) await page.waitForTimeout(intervalMs);
  }
  return levels;
}

/**
 * Wait until level exceeds a threshold. Returns true if reached, false on timeout.
 */
export async function waitForLevel(
  page: Page,
  deck: 'A' | 'B' | 'master',
  threshold: number,
  timeoutMs = 3000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const level = deck === 'master' ? await getMasterLevel(page) : await getLevel(page, deck);
    if (level >= threshold) return true;
    await page.waitForTimeout(50);
  }
  return false;
}

// ── Phase Error ──────────────────────────────────────────────

/**
 * Compute phase error between two synced decks (0 = perfect, 0.5 = worst).
 */
export async function getPhaseError(page: Page): Promise<number> {
  return page.evaluate(() => {
    const engine = (window as any).__MIXI_ENGINE__;
    const store = (window as any).__MIXI_STORE__;
    if (!engine || !store) return 1;

    const sA = store.getState().decks.A;
    const sB = store.getState().decks.B;
    if (sA.bpm <= 0 || sB.bpm <= 0) return 1;

    const timeA = engine.getCurrentTime('A');
    const timeB = engine.getCurrentTime('B');
    const periodA = 60 / sA.bpm;
    const periodB = 60 / sB.bpm;

    const fracA = (((timeA - sA.firstBeatOffset) / periodA) % 1 + 1) % 1;
    const fracB = (((timeB - sB.firstBeatOffset) / periodB) % 1 + 1) % 1;

    let delta = Math.abs(fracA - fracB);
    if (delta > 0.5) delta = 1 - delta;
    return delta;
  });
}

// ── Performance Benchmarks ───────────────────────────────────

export interface EngineBenchmark {
  baseLatency: number;
  sampleRate: number;
  contextState: string;
  currentTime: number;
}

/**
 * Capture engine performance metrics.
 */
export async function benchmarkEngine(page: Page): Promise<EngineBenchmark> {
  return page.evaluate(() => {
    const e = (window as any).__MIXI_ENGINE__;
    const ctx = e?.getAudioContext?.();
    return {
      baseLatency: ctx?.baseLatency ?? -1,
      sampleRate: ctx?.sampleRate ?? -1,
      contextState: ctx?.state ?? 'unknown',
      currentTime: ctx?.currentTime ?? -1,
    };
  });
}

/**
 * Measure BPM detection latency — time from load to BPM > 0.
 */
export async function measureBpmLatency(
  page: Page,
  deck: 'A' | 'B',
  timeoutMs = 10000,
): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const bpm = await page.evaluate((d) => {
      const store = (window as any).__MIXI_STORE__;
      return store?.getState()?.decks?.[d]?.bpm ?? 0;
    }, deck);
    if (bpm > 0) return Date.now() - start;
    await page.waitForTimeout(100);
  }
  return -1; // timeout
}

// ── Wait for Engine Ready ────────────────────────────────────

/**
 * Wait until __MIXI_ENGINE__ is available on window.
 */
export async function waitForEngine(page: Page, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => {
      const e = (window as any).__MIXI_ENGINE__;
      return e && e.isInitialized;
    });
    if (ready) return true;
    await page.waitForTimeout(200);
  }
  return false;
}
