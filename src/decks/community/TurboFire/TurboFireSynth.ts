export class TurboFireSynth {
  private ctx: AudioContext;
  private node!: AudioWorkletNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }
  
  async init() {
    try {
      await this.ctx.audioWorklet.addModule(new URL('./TurboFireProcessor.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'turbofire-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
    } catch (err) { console.warn('[TurboFire] AudioWorklet init failed:', err); }
  }

  connect(destination: AudioNode) {
    this.node.connect(destination);
  }

  destroy() {
    this.node.disconnect();
  }

  setRunning(r: boolean) { this.node.port.postMessage({ id: 'setRunning', value: r }); }
  setWarmth(v: number) { this.node.port.postMessage({ id: 'setWarmth', value: v }); }
  setCrackle(v: number) { this.node.port.postMessage({ id: 'setCrackle', value: v }); }
  setWind(v: number) { this.node.port.postMessage({ id: 'setWind', value: v }); }
}
