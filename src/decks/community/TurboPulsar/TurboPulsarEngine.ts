import { TurboPulsarBus } from './TurboPulsarBus';

export type DeckId = 'A' | 'B';

export class TurboPulsarEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  public bus!: TurboPulsarBus;

  private _isActive = false;
  private _periodMs = 89.33; // Vela pulsar period
  private _dispersion = 0.5; // Controls cutoff / resonance
  private _masterVolume = 1.0;

  private noiseBuffer: AudioBuffer | null = null;
  private scheduledTime = 0;
  private requestTimer: number = 0;

  public onPulse?: () => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboPulsarBus(this.ctx);
    
    // Create cosmic radiation noise buffer (white noise)
    const bufSize = this.ctx.sampleRate * 0.1; // 100ms
    this.noiseBuffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
       data[i] = Math.random() * 2 - 1;
    }
  }

  destroy() {
    this.stop();
    this.bus.destroy();
  }

  private schedulePulses = () => {
    if (!this._isActive || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    // Schedule ahead buffer
    const lookahead = 0.1; 
    
    while (this.scheduledTime < now + lookahead) {
      this.firePulse(this.scheduledTime);
      this.scheduledTime += (this._periodMs / 1000);
    }
    
    this.requestTimer = window.setTimeout(this.schedulePulses, 25);
  };

  private firePulse(time: number) {
     if (!this.noiseBuffer) return;
     
     const source = this.ctx.createBufferSource();
     source.buffer = this.noiseBuffer;
     
     // The "Dispersion measure" affects how high frequency and sharp the pulse is
     const filter = this.ctx.createBiquadFilter();
     filter.type = 'bandpass';
     filter.frequency.value = 1000 + (1.0 - this._dispersion) * 6000;
     filter.Q.value = 1.0 + this._dispersion * 10.0;
     
     const env = this.ctx.createGain();
     env.gain.setValueAtTime(0, time);
     env.gain.linearRampToValueAtTime(1.0, time + 0.001); // Instant attack
     // Decay related to period so it doesn't overlap completely unless it's a millisecond pulsar
     const decay = Math.min(0.05, (this._periodMs / 1000) * 0.5);
     env.gain.exponentialRampToValueAtTime(0.001, time + decay);
     
     source.connect(filter);
     filter.connect(env);
     env.connect(this.bus.input);

     source.start(time);
     source.stop(time + decay);
     
     // Visual hook (might desync slightly at extreme speeds but acceptable)
     if (this.onPulse) {
       setTimeout(() => { if(this.onPulse) this.onPulse() }, (time - this.ctx.currentTime) * 1000);
     }
  }

  engage() {
    if (this._isActive) return;
    this._isActive = true;
    this.scheduledTime = this.ctx.currentTime + 0.05;
    this.schedulePulses();
  }

  stop() {
    this._isActive = false;
    clearTimeout(this.requestTimer);
  }

  get isActive() { return this._isActive; }
  
  get periodMs() { return this._periodMs; }
  set periodMs(v: number) { this._periodMs = Math.max(1.5, v); }

  get dispersion() { return this._dispersion; }
  set dispersion(v: number) { this._dispersion = v; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
