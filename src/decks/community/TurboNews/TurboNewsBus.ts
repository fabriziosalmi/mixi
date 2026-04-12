// @ts-nocheck
export class TurboNewsBus {
  public readonly output: GainNode;
  public readonly input: GainNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // TurboNews is visually silent right now due to WebAudio/TTS limitations, 
    // but we pass audio through if something connects to it.
    this.input.connect(this.output);
  }

  setVolume(value: number) {
    this.output.gain.cancelScheduledValues(this.ctx.currentTime);
    this.output.gain.setTargetAtTime(value * value, this.ctx.currentTime, 0.012);
  }

  destroy() {
    this.input.disconnect();
    this.output.disconnect();
  }
}
