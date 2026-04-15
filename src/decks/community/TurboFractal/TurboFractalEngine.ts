import { TurboFractalBus } from './TurboFractalBus';

export type DeckId = 'A' | 'B';

export class TurboFractalEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  public bus!: TurboFractalBus;

  private _isActive = false;
  private _posX = -0.7; // Mandelbrot default C center
  private _posY = 0.0;
  private _zoom = 1.0;
  private _baseFreq = 55.0; // Drone frequency
  private _masterVolume = 1.0;

  private osc: OscillatorNode | null = null;
  private rAF = 0;
  private wanderAngle = 0;

  public onFractalUpdate?: (iters: number, escape: boolean) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboFractalBus(this.ctx);
  }

  destroy() {
    this.stop();
    this.bus.destroy();
  }

  // Calc iterations of Mandelbrot Z(n+1) = Z^2 + C
  private calcMandelbrot(cx: number, cy: number, maxIters = 64): number[] {
    let zx = 0;
    let zy = 0;
    let iters = 0;
    
    // We will collect the magnitudes at each step to use as partials amplitude
    const magnitudes: number[] = [];
    
    while (zx*zx + zy*zy < 4 && iters < maxIters) {
      const xtemp = zx*zx - zy*zy + cx;
      zy = 2*zx*zy + cy;
      zx = xtemp;
      
      const mag = Math.sqrt(zx*zx + zy*zy);
      magnitudes.push(mag);
      iters++;
    }
    
    // Pad to 64 if it escaped early, just with zeros
    while(magnitudes.length < maxIters) {
      magnitudes.push(0); 
    }
    
    return magnitudes;
  }

  private updateTimbre(magnitudes: number[]) {
     if (!this.osc || this.ctx.state !== 'running') return;
     
     // 1 for DC offset, the rest are partials
     const real = new Float32Array(magnitudes.length + 1);
     const imag = new Float32Array(magnitudes.length + 1);
     
     real[0] = 0; imag[0] = 0; // No DC offset
     for(let i = 0; i < magnitudes.length; i++) {
        // Map the magnitude of the Z set directly to the harmonic partial amplitude!
        // We divide by 2 to keep it bounded, but magnitudes can reach near 2 before divergence.
        real[i+1] = Math.min(1.0, magnitudes[i] / 2); 
        imag[i+1] = 0; // Pure cosine phases
     }
     
     const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
     try {
       this.osc.setPeriodicWave(wave);
     } catch {
       // if context stopped, ignore
     }
  }

  private loop = () => {
    if (!this._isActive) return;

    // We do an internal LFO wandering to animate the fractal parameter
    this.wanderAngle += 0.01;
    const lcx = this._posX + Math.cos(this.wanderAngle) * (0.05 / this._zoom);
    const lcy = this._posY + Math.sin(this.wanderAngle) * (0.05 / this._zoom);

    const magnitudes = this.calcMandelbrot(lcx, lcy, 32); // 32 harmonics
    this.updateTimbre(magnitudes);
    
    // Count non zeros
    let activeIters = 0;
    for (const m of magnitudes) if (m > 0) activeIters++;
    
    if (this.onFractalUpdate) {
       this.onFractalUpdate(activeIters, activeIters < 32);
    }

    // Call only 10 times a second so we don't blow CPU reconstructing PeriodicWave
    this.rAF = window.setTimeout(this.loop, 100);
  };

  engage() {
    if (this._isActive) return;
    this._isActive = true;

    this.osc = this.ctx.createOscillator();
    this.osc.frequency.value = this._baseFreq;
    
    this.osc.connect(this.bus.input);
    this.osc.start();

    this.loop();
  }

  stop() {
    this._isActive = false;
    clearTimeout(this.rAF);
    if (this.osc) {
      this.osc.stop();
      this.osc.disconnect();
      this.osc = null;
    }
  }

  get isActive() { return this._isActive; }
  
  get posX() { return this._posX; }
  set posX(v: number) { this._posX = v; }

  get posY() { return this._posY; }
  set posY(v: number) { this._posY = v; }
  
  get baseFreq() { return this._baseFreq; }
  set baseFreq(v: number) { 
    this._baseFreq = v; 
    if (this.osc) this.osc.frequency.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
