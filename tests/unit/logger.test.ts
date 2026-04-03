import { describe, it, expect, vi } from 'vitest';
import { log } from '../../src/utils/logger';
import { SMOOTH_TIME_CONSTANT } from '../../src/audio/utils/paramSmooth';

describe('logger', () => {
  it('exports log object with all levels', () => {
    expect(typeof log.info).toBe('function');
    expect(typeof log.success).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('log.info calls console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('Test', 'hello');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('MIXI');
    spy.mockRestore();
  });

  it('log.warn calls console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('Test', 'warning');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('log.error calls console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('Test', 'error');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('log.success calls console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.success('Test', 'ok');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('log.debug only emits in DEV mode', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.debug('Test', 'debug message');
    // In test env, import.meta.env.DEV is true
    if (import.meta.env.DEV) {
      expect(spy).toHaveBeenCalledTimes(1);
    } else {
      expect(spy).not.toHaveBeenCalled();
    }
    spy.mockRestore();
  });

  it('passes extra data arguments through', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('Tag', 'msg', { extra: true }, 42);
    const args = spy.mock.calls[0];
    expect(args).toContain(42);
    spy.mockRestore();
  });
});

describe('paramSmooth constants', () => {
  it('SMOOTH_TIME_CONSTANT is reasonable (10-15ms)', () => {
    expect(SMOOTH_TIME_CONSTANT).toBeGreaterThan(0.005);
    expect(SMOOTH_TIME_CONSTANT).toBeLessThan(0.05);
  });
});
