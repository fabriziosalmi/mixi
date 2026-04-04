import { describe, it, expect } from 'vitest';
import { detectGpuBackend } from '../../src/gpu/detectGpu';

describe('GPU Backend Detection', () => {
  it('returns canvas2d when navigator.gpu is absent (jsdom)', async () => {
    // jsdom does not have navigator.gpu, so this should fall back
    const result = await detectGpuBackend();
    expect(result).toBe('canvas2d');
  });

  it('return type is either webgpu or canvas2d', async () => {
    const result = await detectGpuBackend();
    expect(['webgpu', 'canvas2d']).toContain(result);
  });
});
