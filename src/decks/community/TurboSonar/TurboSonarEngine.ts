// @ts-nocheck
import { TurboSonarBus } from './TurboSonarBus';

export type DeckId = 'A' | 'B';

export class TurboSonarEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  private bus!: TurboSonarBus;

  private _isActive = false;
  private _depth = 0.8;
  private _pingRate = 0.1; // 1 ping every 10 secs by default
  private _masterVolume = 1.0;

  private convolver: ConvolverNode | null = null;
  private dryNode: GainNode | null = null;
  private wetNode: GainNode | null = null;
  
  private pingInterval: number = 0;
  public onPing?: (angle: number) => void;
  private currentAngle = 0;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboSonarBus(this.ctx);
  }

  private createReverbImpulse(time_s: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = rate * time_s;
    const impulse = this.ctx.createBuffer(2, length, rate);
    
    for (let c = 0; c < 2; c++) {
       const cd = impulse.getChannelData(c);
       for (let i = 0; i < length; i++) {
         const noise = Math.random() * 2 - 1;
         // Exponential decay to mimic vast dark cave
         cd[i] = noise * Math.exp(-i / (rate * (time_s * 0.2)));
       }
    }
    return impulse;
  }

  private ping() {
    if (!this._isActive || this.ctx.state !== 'running') return;
    
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const lpf = this.ctx.createBiquadFilter();
    
    // Submarine high-freq transient + deep low resonant tail
    osc.type = 'sine';
    
    // High-pitched initial ping
    const freq = 800 + (Math.random() * 200 - 100);
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 1.5);
    
    // Envelope
    env.gain.setValueAtTime(0, this.ctx.currentTime);
    env.gain.linearRampToValueAtTime(1.0, this.ctx.currentTime + 0.05); // sharp attack
    env.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 2.0); // long resonance
    
    lpf.type = 'lowpass';
    lpf.frequency.value = 1500;
    
    osc.connect(env);
    env.connect(lpf);
    
    if (this.dryNode && this.convolver) {
       lpf.connect(this.dryNode);
       lpf.connect(this.convolver);
    }
    
    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + 2.0);

    this.currentAngle = Math.random() * 360;
    if (this.onPing) this.onPing(this.currentAngle);
  }

  private schedulePings = () => {
     if (!this._isActive) return;
     this.ping();
     
     // Random interval around current pingRate. Hz to ms:
     const baseMs = (1 / this._pingRate) * 1000;
     const jitter = (Math.random() * 0.4 + 0.8) * baseMs;
     
     this.pingInterval = window.setTimeout(this.schedulePings, jitter);
  };

  engage() {
    if (this._isActive) return;
    this._isActive = true;

    this.convolver = this.ctx.createConvolver();
    // 5 second vast abyss reverb
    this.convolver.buffer = this.createReverbImpulse(5.0);
    
    this.dryNode = this.ctx.createGain();
    this.wetNode = this.ctx.createGain();
    
    this.convolver.connect(this.wetNode);
    
    this.dryNode.connect(this.bus.input);
    this.wetNode.connect(this.bus.input);

    this.updateMix();
    this.schedulePings();
  }

  stop() {
    this._isActive = false;
    clearTimeout(this.pingInterval);
    
    if (this.convolver) { this.convolver.disconnect(); this.convolver = null; }
    if (this.dryNode) { this.dryNode.disconnect(); this.dryNode = null; }
    if (this.wetNode) { this.wetNode.disconnect(); this.wetNode = null; }
  }

  private updateMix() {
    if (this.dryNode && this.wetNode) {
       // Depth controls wet/dry mix
       this.dryNode.gain.value = 1.0 - (this._depth * 0.8);
       this.wetNode.gain.value = this._depth;
    }
  }

  get isActive() { return this._isActive; }
  
  get depth() { return this._depth; }
  set depth(v: number) { 
    this._depth = v; 
    this.updateMix();
  }

  get pingRate() { return this._pingRate; }
  set pingRate(v: number) { this._pingRate = v; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
