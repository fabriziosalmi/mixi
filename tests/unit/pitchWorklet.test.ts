import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Loads the real worklet file and the real mixi-core wasm (built by
// `wasm-pack build` in CI before `npm test`), with just enough of the
// AudioWorkletGlobalScope stubbed to construct the processor.

const WORKLET = resolve(__dirname, '../../public/worklets/pitch-shift-wasm-processor.js');
const WASM = resolve(__dirname, '../../mixi-core/pkg/mixi_core_bg.wasm');

type Msg = { type: string; message?: string };
interface Processor {
  port: { postMessage: (m: Msg) => void; onmessage: ((e: { data: unknown }) => void) | null };
  _initWasm(bytes: ArrayBuffer): Promise<void>;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

function loadProcessor(): { proc: Processor; messages: Msg[] } {
  let Ctor: (new () => Processor) | null = null;
  class AudioWorkletProcessorStub {
    port = { postMessage: (_m: Msg) => {}, onmessage: null };
  }
  const register = (_name: string, cls: new () => Processor) => { Ctor = cls; };
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime',
    readFileSync(WORKLET, 'utf8'))(AudioWorkletProcessorStub, register, 48000, 0);
  if (!Ctor) throw new Error('worklet did not call registerProcessor');
  const proc = new (Ctor as new () => Processor)();
  const messages: Msg[] = [];
  proc.port.postMessage = (m) => { messages.push(m); };
  return { proc, messages };
}

describe.skipIf(!existsSync(WASM))('pitch-shift-wasm-processor with the real mixi-core wasm', () => {
  it('instantiates and reports ready (the wasm-bindgen imports are supplied)', async () => {
    const { proc, messages } = loadProcessor();
    const b = readFileSync(WASM);
    await proc._initWasm(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    expect(messages.find((m) => m.type === 'error')?.message).toBeUndefined();
    expect(messages.map((m) => m.type)).toContain('ready');
  });

  it('shifts the pitch when key lock is on (not the passthrough fallback)', async () => {
    const { proc, messages } = loadProcessor();
    const b = readFileSync(WASM);
    await proc._initWasm(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    expect(messages.map((m) => m.type)).toContain('ready');
    proc.port.onmessage?.({ data: { type: 'setEnabled', value: true } });
    proc.port.onmessage?.({ data: { type: 'setPitchRatio', value: 1.5 } });

    const frames = 128;
    let diff = 0;
    let energy = 0;
    for (let block = 0; block < 40; block++) {
      const inL = new Float32Array(frames);
      for (let i = 0; i < frames; i++) inL[i] = Math.sin(2 * Math.PI * 440 * (block * frames + i) / 48000);
      const out = [new Float32Array(frames), new Float32Array(frames)];
      proc.process([[inL, inL.slice()]], [out, [new Float32Array(frames)]]);
      for (let i = 0; i < frames; i++) {
        expect(Number.isFinite(out[0][i])).toBe(true);
        energy += out[0][i] ** 2;
        diff += (out[0][i] - inL[i]) ** 2;
      }
    }
    expect(energy).toBeGreaterThan(0);
    // Passthrough would make the output identical to the input.
    expect(diff).toBeGreaterThan(energy * 0.01);
  });
});
