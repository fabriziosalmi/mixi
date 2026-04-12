export class TurboSynthBus {
  public readonly output: GainNode;
  public readonly input: GainNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.input.connect(this.output);
  }

  setFx(_id: string, _value: number) {
    // Optional placeholder
  }

  setVolume(value: number) {
    this.smooth(this.output.gain, value * value); // Exponential curve
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
