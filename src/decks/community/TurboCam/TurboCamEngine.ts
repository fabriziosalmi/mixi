// @ts-nocheck
import { TurboCamBus } from './TurboCamBus';

export type DeckId = 'A' | 'B';

export class TurboCamEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  
  private bus!: TurboCamBus;

  private _isActive = false;
  private _masterVolume = 1.0;
  
  // Optical Flow State
  private _threshold: number = 30;  // RGB diff max 255*3
  private _smoothing: number = 0.8;
  private _currentX = 0.5;
  private _currentY = 0.5;
  
  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  
  private canvas: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D | null;
  private prevData: Uint8ClampedArray | null = null;
  
  private rAFId: number = 0;

  public onMotionUpdate?: (x: number, y: number) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
    this.canvas = document.createElement('canvas');
    // Processing canvas can be very small for performance!
    this.canvas.width = 64; 
    this.canvas.height = 48;
    this.canvasCtx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboCamBus(this.ctx);
  }

  destroy() {
    this.stop();
    this.bus.destroy();
    this.canvas.remove();
  }

  async engage(videoRef: HTMLVideoElement) {
    if (this._isActive) return;
    this.videoEl = videoRef;
    
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 320, height: 240 }, 
        audio: false 
      });
      this.videoEl.srcObject = this.stream;
      this.videoEl.play();
      this._isActive = true;
      
      this.loop();
    } catch (err) {
      console.error("TurboCam Error accessing webcam:", err);
    }
  }

  stop() {
    this._isActive = false;
    cancelAnimationFrame(this.rAFId);
    
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    this.prevData = null;
  }

  private loop = () => {
    if (!this._isActive || !this.videoEl || !this.canvasCtx) return;
    
    // Draw current frame to logic canvas
    this.canvasCtx.drawImage(this.videoEl, 0, 0, this.canvas.width, this.canvas.height);
    const frame = this.canvasCtx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const currData = frame.data;
    
    if (this.prevData) {
      let sumX = 0, sumY = 0, count = 0;
      
      for (let y = 0; y < this.canvas.height; y++) {
        for (let x = 0; x < this.canvas.width; x++) {
          const i = (y * this.canvas.width + x) * 4;
          
          const dr = Math.abs(currData[i] - this.prevData[i]);
          const dg = Math.abs(currData[i+1] - this.prevData[i+1]);
          const db = Math.abs(currData[i+2] - this.prevData[i+2]);
          
          // Grayscale average diff
          const diff = (dr + dg + db) / 3;
          
          if (diff > this._threshold) {
             sumX += x;
             sumY += y;
             count++;
          }
        }
      }
      
      if (count > 10) { // minimum pixels moving to register
        // Mirror X organically
        const rawX = 1.0 - (sumX / count) / this.canvas.width;
        const rawY = (sumY / count) / this.canvas.height;
        
        // Low pass filter on movement
        this._currentX = this._smoothing * this._currentX + (1.0 - this._smoothing) * rawX;
        this._currentY = this._smoothing * this._currentY + (1.0 - this._smoothing) * rawY;
        
        if (this.onMotionUpdate) {
          this.onMotionUpdate(this._currentX, this._currentY);
        }
      }
    }
    
    this.prevData = new Uint8ClampedArray(currData);
    this.rAFId = requestAnimationFrame(this.loop);
  };

  get isActive() { return this._isActive; }
  
  get threshold() { return this._threshold; }
  set threshold(v: number) { this._threshold = v; }
  
  get smoothing() { return this._smoothing; }
  set smoothing(v: number) { this._smoothing = v; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
