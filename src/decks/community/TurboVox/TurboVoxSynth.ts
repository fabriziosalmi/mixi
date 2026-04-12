import { TurboVoxStep } from './types';

export class TurboVoxSynth {
  private ctx: AudioContext;
  private node!: AudioWorkletNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }
  
  async init() {
    try {
      await this.ctx.audioWorklet.addModule(new URL('./TurboVoxProcessor.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'turbovox-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
    } catch (err) { console.warn('[TurboVox] AudioWorklet init failed:', err); }
  }

  connect(destination: AudioNode) {
    this.node.connect(destination);
  }

  destroy() {
    this.node.port.postMessage({ id: 'free' });
    this.node.disconnect();
  }

  setRunning(running: boolean) { this.node.port.postMessage({ id: 'setRunning', value: running }); }
  setTempo(tempo: number) { this.node.port.postMessage({ id: 'setTempo', value: tempo }); }
  
  setPattern(steps: TurboVoxStep[]) {
    const rawPattern = steps.map(s => [s.note, s.gate]);
    this.node.port.postMessage({ id: 'setPattern', value: rawPattern });
  }

  setMorph(v: number) { this.node.port.postMessage({ id: 'setMorph', value: v }); }
  setVibrato(v: number) { this.node.port.postMessage({ id: 'setVibrato', value: v }); }
  setGlide(v: number) { this.node.port.postMessage({ id: 'setGlide', value: v }); }
  setLfoRate(v: number) { this.node.port.postMessage({ id: 'setLfoRate', value: v }); }
  setAttack(v: number) { this.node.port.postMessage({ id: 'setAttack', value: v }); }
  setDecay(v: number) { this.node.port.postMessage({ id: 'setDecay', value: v }); }
}
