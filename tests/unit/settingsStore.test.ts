import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../../src/store/settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      eqRange: 'standard',
      skin: 'midnight',
      loadDemoTrack: true,
      fpsLimit: 60,
      bpmRange: 'wide',
      quantizeResolution: 1,
      showDebugPanel: false,
      showSettings: false,
    });
  });

  it('initializes with default values', () => {
    const state = useSettingsStore.getState();
    expect(state.eqRange).toBe('standard');
    expect(state.skin).toBe('midnight');
    expect(state.loadDemoTrack).toBe(true);
    expect(state.fpsLimit).toBe(60);
    expect(state.bpmRange).toBe('wide');
    expect(state.quantizeResolution).toBe(1);
  });

  it('updates EQ range correctly', () => {
    useSettingsStore.getState().setEqRange('techno');
    expect(useSettingsStore.getState().eqRange).toBe('techno');

    useSettingsStore.getState().setEqRange('gentle');
    expect(useSettingsStore.getState().eqRange).toBe('gentle');
  });

  it('updates BPM range preset', () => {
    useSettingsStore.getState().setBpmRange('house');
    expect(useSettingsStore.getState().bpmRange).toBe('house');

    useSettingsStore.getState().setBpmRange('dnb');
    expect(useSettingsStore.getState().bpmRange).toBe('dnb');
  });

  it('toggles debug panel', () => {
    expect(useSettingsStore.getState().showDebugPanel).toBe(false);
    useSettingsStore.getState().toggleDebugPanel();
    expect(useSettingsStore.getState().showDebugPanel).toBe(true);
    useSettingsStore.getState().toggleDebugPanel();
    expect(useSettingsStore.getState().showDebugPanel).toBe(false);
  });

  it('changes FPS limit', () => {
    useSettingsStore.getState().setFpsLimit(30);
    expect(useSettingsStore.getState().fpsLimit).toBe(30);
  });

  it('changes skin', () => {
    useSettingsStore.getState().setSkin('freetekno');
    expect(useSettingsStore.getState().skin).toBe('freetekno');
  });

  it('sets demo track flag', () => {
    useSettingsStore.getState().setLoadDemoTrack(false);
    expect(useSettingsStore.getState().loadDemoTrack).toBe(false);
  });

  it('changes quantize resolution', () => {
    useSettingsStore.getState().setQuantizeResolution(0.25);
    expect(useSettingsStore.getState().quantizeResolution).toBe(0.25);
  });
});
