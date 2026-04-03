import { describe, it, expect, beforeEach } from 'vitest';
import { useMixiStore } from '../../src/store/mixiStore';

describe('mixiStore', () => {
  beforeEach(() => {
    // Reset critical fields before each test
    useMixiStore.setState({
      crossfader: 0.5,
    });
  });

  // ── Crossfader ──────────────────────────────────────────────

  it('initializes with default crossfader', () => {
    expect(useMixiStore.getState().crossfader).toBe(0.5);
  });

  it('updates crossfader value', () => {
    const store = useMixiStore.getState();
    store.setCrossfader(0.8);
    expect(useMixiStore.getState().crossfader).toBe(0.8);

    store.setCrossfader(0.0);
    expect(useMixiStore.getState().crossfader).toBe(0.0);

    store.setCrossfader(1.0);
    expect(useMixiStore.getState().crossfader).toBe(1.0);
  });

  // ── Deck State ──────────────────────────────────────────────

  it('has both decks A and B', () => {
    const state = useMixiStore.getState();
    expect(state.decks.A).toBeDefined();
    expect(state.decks.B).toBeDefined();
  });

  it('sets deck playing state', () => {
    const store = useMixiStore.getState();
    // Must mark track as loaded first (store guards play on isTrackLoaded)
    store.setDeckTrackLoaded('A', true);
    store.setDeckPlaying('A', true);
    expect(useMixiStore.getState().decks.A.isPlaying).toBe(true);

    store.setDeckPlaying('A', false);
    expect(useMixiStore.getState().decks.A.isPlaying).toBe(false);
  });

  it('sets deck volume', () => {
    const store = useMixiStore.getState();
    store.setDeckVolume('A', 0.5);
    expect(useMixiStore.getState().decks.A.volume).toBe(0.5);

    store.setDeckVolume('B', 0.0);
    expect(useMixiStore.getState().decks.B.volume).toBe(0.0);
  });

  it('sets deck gain', () => {
    const store = useMixiStore.getState();
    store.setDeckGain('A', 6);
    expect(useMixiStore.getState().decks.A.gain).toBe(6);

    store.setDeckGain('B', -12);
    expect(useMixiStore.getState().decks.B.gain).toBe(-12);
  });

  // ── EQ ──────────────────────────────────────────────────────

  it('sets EQ bands independently', () => {
    const store = useMixiStore.getState();
    store.setDeckEq('A', 'low', -26);
    store.setDeckEq('A', 'mid', 3);
    store.setDeckEq('A', 'high', -6);

    const eq = useMixiStore.getState().decks.A.eq;
    expect(eq.low).toBe(-26);
    expect(eq.mid).toBe(3);
    expect(eq.high).toBe(-6);
  });

  it('EQ changes on one deck do not affect the other', () => {
    const store = useMixiStore.getState();
    store.setDeckEq('A', 'low', -32);
    expect(useMixiStore.getState().decks.B.eq.low).toBe(0);
  });

  // ── Track Loaded ────────────────────────────────────────────

  it('tracks loaded state per deck', () => {
    const store = useMixiStore.getState();
    store.setDeckTrackLoaded('A', true);
    expect(useMixiStore.getState().decks.A.isTrackLoaded).toBe(true);
    expect(useMixiStore.getState().decks.B.isTrackLoaded).toBe(false);
  });

  it('sets track name', () => {
    const store = useMixiStore.getState();
    store.setDeckTrackName('A', 'My Track - Artist');
    expect(useMixiStore.getState().decks.A.trackName).toBe('My Track - Artist');
  });

  // ── Playback Rate ───────────────────────────────────────────

  it('sets playback rate', () => {
    const store = useMixiStore.getState();
    store.setDeckPlaybackRate('A', 1.08);
    expect(useMixiStore.getState().decks.A.playbackRate).toBeCloseTo(1.08);
  });

  // ── Master Volume ───────────────────────────────────────────

  it('sets master volume', () => {
    const store = useMixiStore.getState();
    store.setMasterVolume(0.6);
    expect(useMixiStore.getState().master.volume).toBe(0.6);
  });

  // ── Headphones ──────────────────────────────────────────────

  it('sets headphone level', () => {
    const store = useMixiStore.getState();
    store.setHeadphoneLevel(0.7);
    expect(useMixiStore.getState().headphones.level).toBe(0.7);
  });

  it('sets headphone mix', () => {
    const store = useMixiStore.getState();
    store.setHeadphoneMix(0.3);
    expect(useMixiStore.getState().headphones.mix).toBe(0.3);
  });

  // ── Color FX ────────────────────────────────────────────────

  it('sets color FX', () => {
    const store = useMixiStore.getState();
    store.setDeckColorFx('A', 0.5);
    expect(useMixiStore.getState().decks.A.colorFx).toBe(0.5);

    store.setDeckColorFx('B', -0.8);
    expect(useMixiStore.getState().decks.B.colorFx).toBe(-0.8);
  });

  // ── CUE ─────────────────────────────────────────────────────

  it('toggles CUE active', () => {
    const store = useMixiStore.getState();
    expect(useMixiStore.getState().decks.A.cueActive).toBe(false);

    store.toggleCue('A');
    expect(useMixiStore.getState().decks.A.cueActive).toBe(true);

    store.toggleCue('A');
    expect(useMixiStore.getState().decks.A.cueActive).toBe(false);
  });

  // ── Master Filter ──────────────────────────────────────────

  it('sets master filter (bipolar -1..+1)', () => {
    const store = useMixiStore.getState();
    store.setMasterFilter(-0.5);
    expect(useMixiStore.getState().master.filter).toBe(-0.5);

    store.setMasterFilter(0.8);
    expect(useMixiStore.getState().master.filter).toBe(0.8);

    store.setMasterFilter(0);
    expect(useMixiStore.getState().master.filter).toBe(0);
  });

  it('clamps master filter to -1..+1', () => {
    const store = useMixiStore.getState();
    store.setMasterFilter(-5);
    expect(useMixiStore.getState().master.filter).toBe(-1);

    store.setMasterFilter(3);
    expect(useMixiStore.getState().master.filter).toBe(1);
  });

  // ── Master Distortion ──────────────────────────────────────

  it('sets master distortion (0..1)', () => {
    const store = useMixiStore.getState();
    store.setMasterDistortion(0.4);
    expect(useMixiStore.getState().master.distortion).toBe(0.4);
  });

  it('clamps master distortion to 0..1', () => {
    const store = useMixiStore.getState();
    store.setMasterDistortion(-0.5);
    expect(useMixiStore.getState().master.distortion).toBe(0);

    store.setMasterDistortion(2);
    expect(useMixiStore.getState().master.distortion).toBe(1);
  });

  // ── Master Punch ───────────────────────────────────────────

  it('sets master punch (0..1)', () => {
    const store = useMixiStore.getState();
    store.setMasterPunch(0.7);
    expect(useMixiStore.getState().master.punch).toBe(0.7);
  });

  it('clamps master punch to 0..1', () => {
    const store = useMixiStore.getState();
    store.setMasterPunch(-1);
    expect(useMixiStore.getState().master.punch).toBe(0);

    store.setMasterPunch(5);
    expect(useMixiStore.getState().master.punch).toBe(1);
  });

  // ── Master state isolation ─────────────────────────────────

  it('master FX changes preserve other master fields', () => {
    const store = useMixiStore.getState();
    store.setMasterVolume(0.8);
    store.setMasterFilter(-0.3);
    store.setMasterDistortion(0.5);
    store.setMasterPunch(0.2);

    const m = useMixiStore.getState().master;
    expect(m.volume).toBe(0.8);
    expect(m.filter).toBe(-0.3);
    expect(m.distortion).toBe(0.5);
    expect(m.punch).toBe(0.2);

    // Changing one shouldn't reset others
    store.setMasterVolume(0.6);
    const m2 = useMixiStore.getState().master;
    expect(m2.volume).toBe(0.6);
    expect(m2.filter).toBe(-0.3);
    expect(m2.distortion).toBe(0.5);
    expect(m2.punch).toBe(0.2);
  });

  // ── Crossfader clamping ────────────────────────────────────

  it('clamps crossfader to 0..1', () => {
    const store = useMixiStore.getState();
    store.setCrossfader(-0.5);
    expect(useMixiStore.getState().crossfader).toBe(0);

    store.setCrossfader(1.5);
    expect(useMixiStore.getState().crossfader).toBe(1);
  });

  // ── Crossfader curve ───────────────────────────────────────

  it('sets crossfader curve', () => {
    const store = useMixiStore.getState();
    store.setCrossfaderCurve('sharp');
    expect(useMixiStore.getState().crossfaderCurve).toBe('sharp');

    store.setCrossfaderCurve('smooth');
    expect(useMixiStore.getState().crossfaderCurve).toBe('smooth');
  });

  // ── Deck modes ─────────────────────────────────────────────

  it('sets deck mode', () => {
    const store = useMixiStore.getState();
    store.setDeckMode('A', 'groovebox');
    expect(useMixiStore.getState().deckModes.A).toBe('groovebox');

    store.setDeckMode('A', 'track');
    expect(useMixiStore.getState().deckModes.A).toBe('track');
  });

  // ── AI mode ────────────────────────────────────────────────

  it('sets AI mode', () => {
    const store = useMixiStore.getState();
    store.setAiMode('CRUISE');
    expect(useMixiStore.getState().ai.mode).toBe('CRUISE');

    store.setAiMode('OFF');
    expect(useMixiStore.getState().ai.mode).toBe('OFF');
  });
});
