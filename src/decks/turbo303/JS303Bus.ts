// In JS303, the FX (dist, delay) are heavily integrated into the WASM synth step 
// for correct sample accurate feedback loops. 
// Thus, JS303Bus only acts as the final wrapper and gain stage.

export class JS303Bus {
  public readonly output: GainNode;
  public readonly input: GainNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Standard routing: input -> output
    // The JS303 WASM will spit everything here
    this.input.connect(this.output);
  }

  setVolume(value: number) {
    this.smooth(this.output.gain, value * value); // Exponential scale
  }

  destroy() {
    this.input.disconnect();
    this.output.disconnect();
  }

  private smooth(param: AudioParam, value: number, tau = 0.012) {
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setTargetAtTime(value, this.ctx.currentTime, tau);
  }
}
