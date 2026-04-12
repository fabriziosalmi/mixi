// @ts-nocheck
import { TurboFMStep } from './types';

export class TurboFMSynth {
  private ctx: AudioContext;
  private node!: AudioWorkletNode;
  private destination!: AudioNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }
  
  async init() {
    await this.ctx.audioWorklet.addModule(new URL('./TurboFMProcessor.ts', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'turbofm-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
  }

  connect(destination: AudioNode) {
    this.destination = destination;
    this.node.connect(destination);
  }

  destroy() {
    this.node.port.postMessage({ id: 'free' });
    this.node.disconnect();
  }

  setRunning(running: boolean) { this.node.port.postMessage({ id: 'setRunning', value: running }); }
  setTempo(tempo: number) { this.node.port.postMessage({ id: 'setTempo', value: tempo }); }
  setPattern(steps: TurboFMStep[]) {
    const rawPattern = steps.map(s => [s.note, s.gate]);
    this.node.port.postMessage({ id: 'setPattern', value: rawPattern });
  }

  setAlgo(algo: number) { this.node.port.postMessage({ id: 'setAlgo', value: algo }); }
  setFeedback(fb: number) { this.node.port.postMessage({ id: 'setFeedback', value: fb }); }
  setCarAttack(a: number) { this.node.port.postMessage({ id: 'setCarAttack', value: a }); }
  setCarDecay(d: number) { this.node.port.postMessage({ id: 'setCarDecay', value: d }); }
  setModAttack(a: number) { this.node.port.postMessage({ id: 'setModAttack', value: a }); }
  setModDecay(d: number) { this.node.port.postMessage({ id: 'setModDecay', value: d }); }
  setOpRatio(op: number, r: number) { this.node.port.postMessage({ id: 'setOpRatio', op, value: r }); }
  setOpLevel(op: number, l: number) { this.node.port.postMessage({ id: 'setOpLevel', op, value: l }); }
}
