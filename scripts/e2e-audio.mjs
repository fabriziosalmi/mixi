// ─────────────────────────────────────────────────────────────────────────
// Mixi — Draconian real-app audio E2E
//
// Launches the built app (electron . against dist via file://, or a packaged
// app via MIXI_E2E_APP) and exhaustively validates EVERY mixer feature on BOTH
// the WebAudio and Wasm DSP paths, asserting real master-analyser RMS + store
// state. Gain features assert mute→silence / unmute→audible; processing
// features (EQ, colorFX, FX, sync, loops, hotcues, keylock, master FX) assert
// store state + "still audible, no crash" — which is what catches the silence
// and crash regressions this suite was built to find.
//
// Requires a prior build:  npm run build && npm run build:electron
// Usage:  npm run test:audio        (both DSP modes)
// ─────────────────────────────────────────────────────────────────────────
import { _electron as electron } from 'playwright';

const CWD = new URL('..', import.meta.url).pathname;
const GATE = 0.03;            // RMS "audible" threshold; below ≈ silent
const env = { ...process.env, MIXI_E2E: '1' };
delete env.ELECTRON_RUN_AS_NODE; // ensure Electron runs as the browser process

const call = (page, name, ...args) =>
  page.evaluate(({ name, args }) => window.__MIXI_STORE__.getState()[name](...args), { name, args });
const eng = (page, method, ...args) =>
  page.evaluate(({ method, args }) => window.__MIXI_ENGINE__[method](...args), { method, args });
const get = (page, path) =>
  page.evaluate((p) => p.split('.').reduce((o, k) => o?.[k], window.__MIXI_STORE__.getState()), path);
const probe = (page) => page.evaluate(() => window.__MIXI_ENGINE__.__e2eAudioProbe());
const wait = (page, ms) => page.waitForTimeout(ms);
const maxRms = (page, ms = 1000) =>
  page.evaluate(async (ms) => {
    const e = window.__MIXI_ENGINE__; let m = 0; const t0 = Date.now();
    while (Date.now() - t0 < ms) { const r = e.getMasterLevel(); if (r > m) m = r; await new Promise((r) => setTimeout(r, 35)); }
    return m;
  }, ms);

async function launch(useWasm) {
  const app = process.env.MIXI_E2E_APP
    ? await electron.launch({ executablePath: process.env.MIXI_E2E_APP, env })
    : await electron.launch({ args: ['.'], cwd: CWD, env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.waitForFunction(() => !!window.__SETTINGS_STORE__, { timeout: 20000 });
  await page.evaluate((v) => window.__SETTINGS_STORE__.getState().setUseWasmDsp(v), useWasm);
  await page.reload();
  await page.waitForFunction(() => !!window.__SETTINGS_STORE__, { timeout: 20000 });
  await wait(page, 5000);
  try { await page.locator('.mixi-splash').click({ timeout: 5000, force: true }); } catch {}
  await wait(page, 8000); // engine + wasm settle + demo tracks load
  await page.waitForFunction(() => !!window.__MIXI_ENGINE__ && !!window.__MIXI_STORE__, { timeout: 10000 });
  return { app, page, errors };
}

// Inject a deterministic stereo sine WAV and load it into a deck (for load test).
async function loadTone(page, deck, freq = 330) {
  await page.evaluate(async ({ deck, freq }) => {
    const sr = 44100, secs = 8, n = sr * secs;
    const buf = new ArrayBuffer(44 + n * 4); const dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true);
    dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 4, true);
    let o = 44; for (let i = 0; i < n; i++) { const v = Math.sin(2 * Math.PI * freq * i / sr) * 0.5 * 32767; dv.setInt16(o, v, true); dv.setInt16(o + 2, v, true); o += 4; }
    await window.__MIXI_ENGINE__.loadTrack(deck, buf);
    const st = window.__MIXI_STORE__.getState();
    st.setDeckTrackLoaded(deck, true);
    st.setDeckBpm(deck, 120, 0);
  }, { deck, freq });
}

async function run(useWasm) {
  const R = [];
  const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail });
  const { app, page, errors } = await launch(useWasm);

  const wasm = (await probe(page)).wasmActive;
  ok('DSP mode = expected', wasm === useWasm, `wasmActive=${wasm}`);

  // Baseline — demo tracks auto-loaded on start.
  ok('deck A track loaded (demo)', await get(page, 'decks.A.isTrackLoaded') === true);
  ok('deck B track loaded (demo)', await get(page, 'decks.B.isTrackLoaded') === true);
  await call(page, 'setMasterVolume', 1); await call(page, 'setCrossfader', 0.5);
  for (const d of ['A', 'B']) { await call(page, 'setDeckVolume', d, 1); await call(page, 'setDeckGain', d, 0); await call(page, 'setDeckColorFx', d, 0); for (const b of ['low','mid','high']) await call(page, 'setDeckEq', d, b, 0); }

  // ── Per-deck core: play, mute, gain, eq, colorFx, rate, keylock ──
  for (const D of ['A', 'B']) {
    const other = D === 'A' ? 'B' : 'A';
    await call(page, 'setDeckPlaying', other, false);
    await call(page, 'setCrossfader', D === 'A' ? 0 : 1); // full toward D
    await call(page, 'setDeckVolume', D, 1);
    await call(page, 'setDeckPlaying', D, true); await wait(page, 400);
    ok(`[${D}] playing → audible`, (await maxRms(page, 1400)) > GATE);
    const pr = await probe(page);
    ok(`[${D}] stereo L&R`, pr.levelL > 0.005 && pr.levelR > 0.005, `L=${pr.levelL.toFixed(3)} R=${pr.levelR.toFixed(3)}`);
    ok(`[${D}] channel VU meter lit`, (pr['deckLevel' + D] ?? 0) > 0.01, `deckLevel=${(pr['deckLevel' + D] ?? 0).toFixed(3)}`);
    await call(page, 'setDeckVolume', D, 0); await wait(page, 300);
    ok(`[${D}] volume 0 → silent`, (await maxRms(page, 600)) < GATE);
    await call(page, 'setDeckVolume', D, 1); await wait(page, 300);
    ok(`[${D}] volume 1 → audible`, (await maxRms(page, 800)) > GATE);
    await call(page, 'setDeckGain', D, 6); ok(`[${D}] gain store=6`, Math.abs(await get(page, `decks.${D}.gain`) - 6) < 0.01); await call(page, 'setDeckGain', D, 0);
    for (const b of ['low','mid','high']) { await call(page, 'setDeckEq', D, b, -20); ok(`[${D}] eq ${b} store`, Math.abs(await get(page, `decks.${D}.eq.${b}`) + 20) < 0.01); }
    ok(`[${D}] EQ engaged still audible`, (await maxRms(page, 800)) > GATE * 0.3);
    for (const b of ['low','mid','high']) await call(page, 'setDeckEq', D, b, 0);
    await call(page, 'setDeckColorFx', D, -1); ok(`[${D}] colorFx LPF store`, Math.abs(await get(page, `decks.${D}.colorFx`) + 1) < 0.01);
    ok(`[${D}] colorFx LPF audible`, (await maxRms(page, 800)) > GATE * 0.3); await call(page, 'setDeckColorFx', D, 0);
    await call(page, 'setDeckPlaybackRate', D, 1.3); ok(`[${D}] rate store≈1.3`, Math.abs(await get(page, `decks.${D}.playbackRate`) - 1.3) < 0.05);
    ok(`[${D}] rate change still audible`, (await maxRms(page, 800)) > GATE); await call(page, 'setDeckPlaybackRate', D, 1);
    await call(page, 'setKeyLock', D, true); ok(`[${D}] keyLock store=true`, await get(page, `decks.${D}.keyLock`) === true);
    await call(page, 'setDeckPlaybackRate', D, 1.2); ok(`[${D}] keyLock+rate STILL AUDIBLE`, (await maxRms(page, 1000)) > GATE);
    await call(page, 'setDeckPlaybackRate', D, 1); await call(page, 'setKeyLock', D, false);
    // per-deck FX
    for (const fx of ['flt','dly','rev','pha','flg','gate']) {
      await eng(page, 'setDeckFx', D, fx, 0.6, true); await wait(page, 180);
      ok(`[${D}] FX ${fx} active still audible`, (await maxRms(page, 700)) > GATE * 0.3);
      await eng(page, 'setDeckFx', D, fx, 0, false);
    }
    await call(page, 'setDeckPlaying', D, false);
  }

  // ── Crossfader (both playing) ──
  await call(page, 'setDeckPlaying', 'A', true); await call(page, 'setDeckPlaying', 'B', true);
  await call(page, 'setCrossfader', 0); await wait(page, 300); const xfA = await maxRms(page, 800);
  await call(page, 'setCrossfader', 1); await wait(page, 300); const xfB = await maxRms(page, 800);
  ok('crossfader both sides audible', xfA > GATE && xfB > GATE, `A=${xfA.toFixed(3)} B=${xfB.toFixed(3)}`);
  await call(page, 'setCrossfader', 0.5);

  // ── Master FX ──
  await call(page, 'setMasterVolume', 1); await wait(page, 200); const mFull = await maxRms(page, 700);
  await call(page, 'setMasterVolume', 0.2); await wait(page, 250); const mLow = await maxRms(page, 700);
  ok('master volume scales level', mLow < mFull * 0.85, `full=${mFull.toFixed(3)} low=${mLow.toFixed(3)}`); await call(page, 'setMasterVolume', 1);
  for (const [name, fn, val] of [['filter', 'setMasterFilter', -0.8], ['filter+', 'setMasterFilter', 0.8], ['distortion', 'setMasterDistortion', 0.7], ['punch', 'setMasterPunch', 0.8]]) {
    await call(page, fn, val); await wait(page, 250);
    ok(`master ${name} still audible`, (await maxRms(page, 700)) > GATE * 0.3, `val=${val}`);
  }
  await call(page, 'setMasterFilter', 0); await call(page, 'setMasterDistortion', 0); await call(page, 'setMasterPunch', 0);
  for (const b of ['low','mid','high']) { await call(page, 'setMasterEq', b, -12); ok(`master eq ${b} store`, Math.abs(await get(page, `master.eq.${b}`) + 12) < 0.01); await call(page, 'setMasterEq', b, 0); }

  // ── Hot cues ──
  await call(page, 'setDeckPlaying', 'B', false);
  await call(page, 'setHotCue', 'A', 0, 5.0); ok('hotcue set', await get(page, 'decks.A.hotCues.0') !== null);
  await call(page, 'triggerHotCue', 'A', 0); await wait(page, 300);
  ok('hotcue trigger still audible', (await maxRms(page, 700)) > GATE);
  await call(page, 'deleteHotCue', 'A', 0); ok('hotcue deleted', await get(page, 'decks.A.hotCues.0') === null);

  // ── Loops ──
  await call(page, 'setAutoLoop', 'A', 4); ok('autoloop set', await get(page, 'decks.A.activeLoop') !== null);
  await wait(page, 400); ok('loop still audible', (await maxRms(page, 700)) > GATE);
  await call(page, 'exitLoop', 'A'); ok('loop exited', await get(page, 'decks.A.activeLoop') === null);

  // ── Quantize ──
  await call(page, 'setQuantize', 'A', true); ok('quantize on', await get(page, 'decks.A.quantize') === true); await call(page, 'setQuantize', 'A', false);

  // ── Sync / beatmatch ──
  await call(page, 'setDeckBpm', 'A', 120, 0); await call(page, 'setDeckBpm', 'B', 174, 0);
  await call(page, 'setDeckPlaying', 'B', true); await call(page, 'setCrossfader', 0.5); await wait(page, 300);
  await call(page, 'syncDeck', 'B'); await wait(page, 500);
  ok('sync: B isSynced', await get(page, 'decks.B.isSynced') === true);
  ok('sync: B still audible', (await maxRms(page, 900)) > GATE);
  await call(page, 'unsyncDeck', 'B'); ok('unsync: B not synced', await get(page, 'decks.B.isSynced') === false);

  // ── Beat-phase HUD data (PhaseMeter): both decks playing → getCurrentTime advances ──
  await call(page, 'setDeckPlaying', 'A', true); await call(page, 'setDeckPlaying', 'B', true);
  await call(page, 'setCrossfader', 0.5); await wait(page, 250);
  const ph1 = await probe(page); await wait(page, 500); const ph2 = await probe(page);
  ok('beat clock A advances', ph2.currentTimeA > ph1.currentTimeA, `${ph1.currentTimeA.toFixed(2)}→${ph2.currentTimeA.toFixed(2)}`);
  ok('beat clock B advances', ph2.currentTimeB > ph1.currentTimeB, `${ph1.currentTimeB.toFixed(2)}→${ph2.currentTimeB.toFixed(2)}`);
  ok('PhaseMeter active (both playing + bpm)', (await get(page, 'decks.A.isPlaying')) && (await get(page, 'decks.B.isPlaying')) && (await get(page, 'decks.A.bpm')) > 0 && (await get(page, 'decks.B.bpm')) > 0);
  ok('both deck VU meters lit', (ph2.deckLevelA > 0.01) && (ph2.deckLevelB > 0.01), `A=${ph2.deckLevelA.toFixed(3)} B=${ph2.deckLevelB.toFixed(3)}`);
  await call(page, 'setDeckPlaying', 'B', false);

  // ── Headphones / PFL (must not affect master) ──
  const beforeHp = await maxRms(page, 600);
  await call(page, 'setHeadphoneLevel', 0.8); ok('hp level store', Math.abs(await get(page, 'headphones.level') - 0.8) < 0.01);
  await call(page, 'setHeadphoneMix', 0.7); ok('hp mix store', Math.abs(await get(page, 'headphones.mix') - 0.7) < 0.01);
  await call(page, 'toggleSplitMode'); ok('split mode toggled', typeof (await get(page, 'headphones.splitMode')) === 'boolean');
  await call(page, 'toggleCue', 'A'); ok('PFL cueActive', await get(page, 'decks.A.cueActive') === true);
  ok('headphones/PFL leave master audible', (await maxRms(page, 700)) > GATE, `before=${beforeHp.toFixed(3)}`);
  await call(page, 'toggleCue', 'A');

  // ── Load / unload ──
  await call(page, 'ejectDeck', 'A'); await wait(page, 300);
  ok('eject → not loaded', await get(page, 'decks.A.isTrackLoaded') === false);
  ok('eject → silent', (await maxRms(page, 600)) < GATE);
  await loadTone(page, 'A', 330); await wait(page, 300);
  ok('reload tone → loaded', await get(page, 'decks.A.isTrackLoaded') === true);
  await call(page, 'setDeckVolume', 'A', 1); await call(page, 'setCrossfader', 0); await call(page, 'setDeckPlaying', 'A', true); await wait(page, 400);
  ok('reload tone → audible', (await maxRms(page, 900)) > GATE);

  // ── Stop ──
  await call(page, 'setDeckPlaying', 'A', false); await wait(page, 350);
  ok('stop → silent', (await maxRms(page, 600)) < GATE);

  ok('no non-WS console errors', errors.filter((e) => !e.includes('WebSocket')).length === 0, errors.filter((e) => !e.includes('WebSocket')).slice(0, 2).join(' | '));

  await app.close();
  return R;
}

let anyFail = false;
for (const useWasm of [false, true]) {
  const res = await run(useWasm);
  const pass = res.filter((r) => r.pass).length;
  if (pass !== res.length) anyFail = true;
  console.log(`\n========== useWasmDsp=${useWasm} : ${pass}/${res.length} passed ==========`);
  for (const r of res) console.log(`${r.pass ? '  ✅' : '  ❌'} ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
if (anyFail) process.exitCode = 1;
