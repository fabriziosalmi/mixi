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
});
