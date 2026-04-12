export class TurboFireBus {
  public readonly output: GainNode;
  public readonly input: GainNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.input.connect(this.output);
  }

  setVolume(value: number) {
    paramTargetAtTime(this.output.gain, value * value, this.ctx.currentTime, 0.012);
  }

  destroy() {
    this.input.disconnect();
    this.output.disconnect();
  }
}

function paramTargetAtTime(param: AudioParam, value: number, time: number, tau: number) {
  param.cancelScheduledValues(time);
  param.setTargetAtTime(value, time, tau);
}
