import { describe, it, expect, beforeEach } from 'vitest';
import { useMidiStore } from '../../src/store/midiStore';
import type { MidiMapping } from '../../src/midi/MidiManager';
import { AKAI_MIDI_MIX_PRESET } from '../../src/midi/presets/akaiMidiMix';

describe('midiStore', () => {
  beforeEach(() => {
    useMidiStore.setState({
      isLearning: false,
      learningAction: null,
      mappings: [],
      activePreset: 'Manual',
    });
  });

  it('initializes with empty mappings', () => {
    const state = useMidiStore.getState();
    expect(state.mappings).toHaveLength(0);
    expect(state.isLearning).toBe(false);
    expect(state.activePreset).toBe('Manual');
  });

  it('adds a CC mapping', () => {
    const mapping: MidiMapping = {
      portId: 'test',
      type: 'cc',
      channel: 0,
      control: 16,
      action: { type: 'DECK_EQ_HIGH', deck: 'A' },
    };
    useMidiStore.getState().addMapping(mapping);
    expect(useMidiStore.getState().mappings).toHaveLength(1);
    expect(useMidiStore.getState().mappings[0].control).toBe(16);
  });

  it('replaces duplicate action mapping', () => {
    const mapping1: MidiMapping = {
      portId: 'test',
      type: 'cc',
      channel: 0,
      control: 16,
      action: { type: 'DECK_EQ_HIGH', deck: 'A' },
    };
    const mapping2: MidiMapping = {
      portId: 'test',
      type: 'cc',
      channel: 0,
      control: 20,
      action: { type: 'DECK_EQ_HIGH', deck: 'A' },
    };
    useMidiStore.getState().addMapping(mapping1);
    useMidiStore.getState().addMapping(mapping2);
    // Should replace, not accumulate
    expect(useMidiStore.getState().mappings).toHaveLength(1);
    expect(useMidiStore.getState().mappings[0].control).toBe(20);
  });

  it('removes a mapping by action type and deck', () => {
    useMidiStore.getState().addMapping({
      portId: 'test',
      type: 'cc',
      channel: 0,
      control: 16,
      action: { type: 'DECK_VOL', deck: 'A' },
    });
    useMidiStore.getState().addMapping({
      portId: 'test',
      type: 'cc',
      channel: 0,
      control: 20,
      action: { type: 'DECK_VOL', deck: 'B' },
    });
    expect(useMidiStore.getState().mappings).toHaveLength(2);

    useMidiStore.getState().removeMapping('DECK_VOL', 'A');
    expect(useMidiStore.getState().mappings).toHaveLength(1);
    expect((useMidiStore.getState().mappings[0].action as any).deck).toBe('B');
  });

  it('clears all mappings', () => {
    useMidiStore.getState().addMapping({
      portId: 'test',
      type: 'cc',
      channel: 0,
      control: 16,
      action: { type: 'CROSSFADER' },
    });
    useMidiStore.getState().clearMappings();
    expect(useMidiStore.getState().mappings).toHaveLength(0);
    expect(useMidiStore.getState().activePreset).toBe('Manual');
  });

  it('loads Akai MIDI Mix preset', () => {
    useMidiStore.getState().loadPreset('Akai MIDI Mix', AKAI_MIDI_MIX_PRESET);
    expect(useMidiStore.getState().activePreset).toBe('Akai MIDI Mix');
    expect(useMidiStore.getState().mappings.length).toBeGreaterThan(10);

    // Verify crossfader mapping exists
    const crossfader = useMidiStore.getState().mappings.find(
      (m) => m.action.type === 'CROSSFADER'
    );
    expect(crossfader).toBeDefined();
    expect(crossfader?.control).toBe(62);
  });

  it('exports mappings as JSON', () => {
    useMidiStore.getState().addMapping({
      portId: 'test',
      type: 'cc',
      channel: 0,
      control: 48,
      action: { type: 'DECK_VOL', deck: 'A' },
    });
    const json = useMidiStore.getState().exportMappings();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].action.type).toBe('DECK_VOL');
  });

  it('sets learning state', () => {
    useMidiStore.getState().setLearning(true);
    expect(useMidiStore.getState().isLearning).toBe(true);

    useMidiStore.getState().setLearningAction({ type: 'DECK_PLAY', deck: 'A' });
    expect(useMidiStore.getState().learningAction?.type).toBe('DECK_PLAY');
  });

  it('sets activePreset to Custom on manual addMapping', () => {
    useMidiStore.getState().loadPreset('Akai MIDI Mix', AKAI_MIDI_MIX_PRESET);
    expect(useMidiStore.getState().activePreset).toBe('Akai MIDI Mix');

    useMidiStore.getState().addMapping({
      portId: 'test',
      type: 'cc',
      channel: 5,
      control: 99,
      action: { type: 'MASTER_VOL' },
    });
    expect(useMidiStore.getState().activePreset).toBe('Custom');
  });
});
