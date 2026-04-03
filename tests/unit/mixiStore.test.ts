import { describe, it, expect, beforeEach } from 'vitest';
import { useMixiStore } from '../../src/store/mixiStore';

describe('mixiStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useMixiStore.setState({
      crossfader: 0.5,
    });
  });

  it('initializes with default values', () => {
    const state = useMixiStore.getState();
    expect(state.crossfader).toBe(0.5);
  });

  it('updates crossfader value correctly', () => {
    const store = useMixiStore.getState();
    store.setCrossfader(0.8);
    expect(useMixiStore.getState().crossfader).toBe(0.8);
    
    store.setCrossfader(0.2);
    expect(useMixiStore.getState().crossfader).toBe(0.2);
  });
});
