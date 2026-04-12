// @ts-nocheck
import { TurboBoidBus } from './TurboBoidBus';
import { Boid } from './types';

export type DeckId = 'A' | 'B';

export class TurboBoidEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  private bus!: TurboBoidBus;

  private _isActive = false;
  private _masterVolume = 1.0;
  
  // Simulation params
  public width = 400;
  public height = 200;
  private _boidCount = 30;
  private _maxSpeed = 2.0;

  public boids: Boid[] = [];
  private rAF: number = 0;

  public onBoidsUpdate?: (boids: Boid[], triggers: {x:number, y:number}[]) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboBoidBus(this.ctx);
  }

  destroy() {
    this.stop();
    this.bus.destroy();
  }

  engage() {
    if (this._isActive) return;
    this._isActive = true;
    
    // Init swallows
    this.boids = Array.from({ length: this._boidCount }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: (Math.random() - 0.5) * this._maxSpeed,
      vy: (Math.random() - 0.5) * this._maxSpeed,
    }));

    this.loop();
  }

  stop() {
    this._isActive = false;
    cancelAnimationFrame(this.rAF);
  }

  private triggerNote(y: number) {
    if (this.ctx.state !== 'running') return;

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    
    // Scale pitch based on Y collision
    // High Y (bottom) = low pitch, Low Y (top) = high pitch
    const noteFreq = 440 * Math.pow(2, ((this.height - y) / this.height * 24 - 12) / 12);
    
    osc.type = 'sine';
    osc.frequency.value = noteFreq;
    
    env.gain.value = 0;
    osc.connect(env);
    env.connect(this.bus.input);

    const now = this.ctx.currentTime;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.5, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  private loop = () => {
    if (!this._isActive) return;

    let triggers: {x:number, y:number}[] = [];

    // O(N^2) naive flocking... okay for N < 100
    for (let b of this.boids) {
      let cx = 0, cy = 0, cvx = 0, cvy = 0;
      let sx = 0, sy = 0;
      let count = 0;

      for (let other of this.boids) {
        if (b === other) continue;
        const d = Math.hypot(b.x - other.x, b.y - other.y);
        
        if (d < 50) { // Visibility radius
          cx += other.x; cy += other.y;
          cvx += other.vx; cvy += other.vy;
          count++;
          
          if (d < 20) { // Separation radius
            sx -= (other.x - b.x);
            sy -= (other.y - b.y);
          }
        }
      }

      if (count > 0) {
        cx /= count; cy /= count;
        cvx /= count; cvy /= count;

        b.vx += (cx - b.x) * 0.005 + (cvx - b.vx) * 0.05 + sx * 0.05;
        b.vy += (cy - b.y) * 0.005 + (cvy - b.vy) * 0.05 + sy * 0.05;
      }

      // Constrain speed
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > this._maxSpeed) {
        b.vx = (b.vx / speed) * this._maxSpeed;
        b.vy = (b.vy / speed) * this._maxSpeed;
      }

      b.x += b.vx;
      b.y += b.vy;

      // Bounce off walls and generate music!
      let wallHit = false;
      if (b.x <= 0) { b.vx *= -1; b.x = 0; wallHit = true; }
      else if (b.x >= this.width) { b.vx *= -1; b.x = this.width; wallHit = true; }
      
      if (b.y <= 0) { b.vy *= -1; b.y = 0; wallHit = true; }
      else if (b.y >= this.height) { b.vy *= -1; b.y = this.height; wallHit = true; }

      if (wallHit) {
         triggers.push({x: b.x, y: b.y});
         this.triggerNote(b.y);
      }
    }

    if (this.onBoidsUpdate) {
       this.onBoidsUpdate([...this.boids], triggers);
    }

    this.rAF = requestAnimationFrame(this.loop);
  };

  get isActive() { return this._isActive; }
  
  get boidCount() { return this._boidCount; }
  set boidCount(v: number) { 
    this._boidCount = v; 
    // Just reset the sim if count changes to avoid messy splices
    if (this._isActive) {
      this.stop(); this.engage();
    }
  }

  get maxSpeed() { return this._maxSpeed; }
  set maxSpeed(v: number) { this._maxSpeed = v; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
