import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Polyfill AudioContext for tests
class AudioContextMock {
  createGain() { return { connect: vi.fn(), gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }; }
  createBiquadFilter() { return { connect: vi.fn(), type: 'lowpass', frequency: { value: 1000 }, Q: { value: 1 } }; }
  createBufferSource() { return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null, playbackRate: { value: 1 } }; }
  createAnalyser() { return { connect: vi.fn(), getByteTimeDomainData: vi.fn() }; }
  suspend = vi.fn().mockResolvedValue(undefined);
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  state = 'running';
  currentTime = 0;
  baseLatency = 0;
}

window.AudioContext = window.AudioContext || AudioContextMock;
window.webkitAudioContext = (window as any).webkitAudioContext || AudioContextMock;

// Mock localStorage for Zustand persist middleware
const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) { return store[key] || null; },
    setItem(key: string, value: string) { store[key] = value.toString(); },
    removeItem(key: string) { delete store[key]; },
    clear() { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
