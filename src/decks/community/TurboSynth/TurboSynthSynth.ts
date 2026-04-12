import { TurboSynthStep } from './types';

export class TurboSynthSynth {
  private ctx: AudioContext;
  private node!: AudioWorkletNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }
  
  async init() {
    await this.ctx.audioWorklet.addModule(new URL('./TurboSynthProcessor.ts', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'turbosynth-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
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
  setPattern(steps: TurboSynthStep[]) {
    const rawPattern = steps.map(s => [s.note, s.gate]);
    this.node.port.postMessage({ id: 'setPattern', value: rawPattern });
  }

  setWaveform(value: number) { this.node.port.postMessage({ id: 'setWaveform', value: Math.round(value) }); }
  setCutoff(value: number) { this.node.port.postMessage({ id: 'setCutoff', value }); }
  setResonance(value: number) { this.node.port.postMessage({ id: 'setResonance', value }); }
  setAttack(value: number) { this.node.port.postMessage({ id: 'setAttack', value }); }
  setRelease(value: number) { this.node.port.postMessage({ id: 'setRelease', value }); }
}
