import { TurboGenomeBus } from './TurboGenomeBus';

export type DeckId = 'A' | 'B';

export class TurboGenomeEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  public bus!: TurboGenomeBus;

  private _isActive = false;
  
  // Real snippet from SARS-CoV-2 genome just for scientific aesthetic
  public readonly baseSequence = 'ATTAAAGGTTTATACCTTCCCAGGTAACAAACCAACCAACTTTCGATCTCTTGTAGAT';
  
  private _sequenceStr = this.baseSequence;
  private _speedMs = 150;
  private _mutationRate = 0.05;
  private _masterVolume = 1.0;

  private tickerId: number = 0;
  private currentIndex = 0;

  public onNucleotideRead?: (base: string, index: number, mutated: boolean) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboGenomeBus(this.ctx);
  }

  destroy() {
    this.stop();
    this.bus.destroy();
  }

  private nucleoToFreq(n: string): number {
    // A mapping of nucleobases to an interesting scale (e.g., C minor 7)
    // A = C3 (130.81), C = D#3 (155.56), G = G3 (196.00), T = A#3 (233.08)
    switch(n) {
      case 'A': return 130.81;
      case 'C': return 155.56;
      case 'G': return 196.00;
      case 'T': return 233.08;
      default: return 100;
    }
  }

  private playBase(n: string) {
    if (this.ctx.state !== 'running') return;
    const freq = this.nucleoToFreq(n);
    
    // Acidic squelchy synth 
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.value = freq * 0.5; // octave down
    
    filter.type = 'lowpass';
    filter.Q.value = 15;
    
    const now = this.ctx.currentTime;
    
    // Envelope for filter cutoff (the Acid squelch)
    filter.frequency.setValueAtTime(200, now);
    filter.frequency.exponentialRampToValueAtTime(3000, now + 0.02);
    filter.frequency.exponentialRampToValueAtTime(100, now + (this._speedMs/1000) * 0.8);
    
    // VCA
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.6, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + (this._speedMs/1000) * 0.9);
    
    osc.connect(filter);
    filter.connect(env);
    env.connect(this.bus.input);

    osc.start(now);
    osc.stop(now + (this._speedMs/1000));
  }

  private loop = () => {
    if (!this._isActive) return;

    let base = this._sequenceStr[this.currentIndex];
    let mutated = false;

    // Mutate probabilistically
    if (Math.random() < this._mutationRate) {
       const bases = ['A', 'C', 'G', 'T'];
       base = bases[Math.floor(Math.random() * bases.length)];
       mutated = true;
    }

    this.playBase(base);
    
    if (this.onNucleotideRead) {
       this.onNucleotideRead(base, this.currentIndex, mutated);
    }

    this.currentIndex = (this.currentIndex + 1) % this._sequenceStr.length;
    this.tickerId = window.setTimeout(this.loop, this._speedMs);
  };

  engage() {
    if (this._isActive) return;
    this._isActive = true;
    this.currentIndex = 0;
    this.loop();
  }

  stop() {
    this._isActive = false;
    clearTimeout(this.tickerId);
  }

  get isActive() { return this._isActive; }
  
  get sequenceStr() { return this._sequenceStr; }
  set sequenceStr(v: string) { this._sequenceStr = v; this.currentIndex = 0; }

  get speedMs() { return this._speedMs; }
  set speedMs(v: number) { this._speedMs = v; }

  get mutationRate() { return this._mutationRate; }
  set mutationRate(v: number) { this._mutationRate = v; }

  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
