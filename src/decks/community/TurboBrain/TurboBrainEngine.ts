import { TurboBrainBus } from './TurboBrainBus';

export type DeckId = 'A' | 'B';

export class TurboBrainEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  public bus!: TurboBrainBus;

  private _isActive = false;
  private _baseFreq = 200;
  private _beatFreq = 7; // Theta by default
  private _waveType: 'sine' | 'triangle' = 'sine';
  private _masterVolume = 1.0;

  private oscL: OscillatorNode | null = null;
  private oscR: OscillatorNode | null = null;
  private panL: StereoPannerNode | null = null;
  private panR: StereoPannerNode | null = null;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboBrainBus(this.ctx);
  }

  destroy() {
    this.stop();
    this.bus.destroy();
  }

  engage() {
    if (this._isActive) return;
    this._isActive = true;

    this.oscL = this.ctx.createOscillator();
    this.oscR = this.ctx.createOscillator();
    this.panL = this.ctx.createStereoPanner();
    this.panR = this.ctx.createStereoPanner();

    this.oscL.type = this._waveType;
    this.oscR.type = this._waveType;
    
    this.panL.pan.value = -1; // 100% Left
    this.panR.pan.value = 1;  // 100% Right

    this.updateFrequencies();

    this.oscL.connect(this.panL);
    this.oscR.connect(this.panR);

    // Merge into the bus input natively (WebAudio handles stereo summing at destination,
    // but the Bus gain node will preserve stereo channels if connected to a stereo destination)
    this.panL.connect(this.bus.input);
    this.panR.connect(this.bus.input);

    this.oscL.start();
    this.oscR.start();
  }

  stop() {
    this._isActive = false;
    if (this.oscL) { this.oscL.stop(); this.oscL.disconnect(); this.oscL = null; }
    if (this.oscR) { this.oscR.stop(); this.oscR.disconnect(); this.oscR = null; }
    if (this.panL) { this.panL.disconnect(); this.panL = null; }
    if (this.panR) { this.panR.disconnect(); this.panR = null; }
  }

  private updateFrequencies() {
    if (this.oscL && this.oscR) {
      // Smooth frequency transition
      const now = this.ctx.currentTime;
      this.oscL.frequency.setTargetAtTime(this._baseFreq, now, 0.05);
      this.oscR.frequency.setTargetAtTime(this._baseFreq + this._beatFreq, now, 0.05);
    }
  }

  get isActive() { return this._isActive; }
  
  get baseFreq() { return this._baseFreq; }
  set baseFreq(v: number) { 
    this._baseFreq = v; 
    this.updateFrequencies();
  }

  get beatFreq() { return this._beatFreq; }
  set beatFreq(v: number) { 
    this._beatFreq = v; 
    this.updateFrequencies();
  }

  get waveType() { return this._waveType; }
  set waveType(v: 'sine' | 'triangle') {
    this._waveType = v;
    if (this.oscL) this.oscL.type = v;
    if (this.oscR) this.oscR.type = v;
  }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
