import { SynthParamId } from './types';

export class TurboNatureEngine {
  public deckId: string;
  
  private _masterVolume: number = 1.0;
  private ytPlayer: any = null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  
  public synthParams: Record<SynthParamId, number> = {
    birds: 0.0,
    wind: 0.0,
    rain: 0.0,
    magic: 0.0,
  };

  private noiseSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  
  private oscInterval: any = null;

  constructor(deckId: string) {
    this.deckId = deckId;
  }

  public get masterVolume(): number {
    return this._masterVolume;
  }

  public set masterVolume(v: number) {
    this._masterVolume = v;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(v, this.ctx!.currentTime);
    }
    this.updateYtVolume();
  }

  // Links the YouTube iframe player so we can control its volume/playback
  public linkPlayer(player: any) {
    this.ytPlayer = player;
    this.updateYtVolume();
  }

  private updateYtVolume() {
    if (this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
      try {
        // YT Volume is 0 to 100
        this.ytPlayer.setVolume(this._masterVolume * 100);
      } catch (e) {
        console.warn("YouTube player volume not ready", e);
      }
    }
  }

  public async init(ctx: AudioContext) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this._masterVolume;
    this.masterGain.connect(ctx.destination);

    // Create a 2-second continuous noise buffer for Wind/Rain
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;

    // --- Wind Setup (Lowpass)
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400; 
    
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;

    this.noiseSource.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    // --- Rain Setup (Highpass -> Lowpass)
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1000;
    
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 3000;

    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;

    this.noiseSource.connect(rainHp);
    rainHp.connect(rainLp);
    rainLp.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    
    // --- Synth Bird/Magic loop setup (Periodic chirps)
    this.startSynthLoop();
  }

  private startSynthLoop() {
      // Very basic periodic synthesis mimicking birds and magical chimes
      this.oscInterval = setInterval(() => {
          if (!this.ctx || !this.masterGain) return;
          const t = this.ctx.currentTime;
          
          // Birds synth (high freq FM chirp)
          if (this.synthParams.birds > 0 && Math.random() > 0.6) {
              const osc = this.ctx.createOscillator();
              const gain = this.ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(3000 + Math.random() * 2000, t);
              osc.frequency.exponentialRampToValueAtTime(1000 + Math.random() * 500, t + 0.1);
              
              gain.gain.setValueAtTime(0, t);
              gain.gain.linearRampToValueAtTime(this.synthParams.birds * 0.2, t + 0.05);
              gain.gain.linearRampToValueAtTime(0, t + 0.15);
              
              osc.connect(gain);
              gain.connect(this.masterGain);
              osc.start(t);
              osc.stop(t + 0.2);
          }

          // Magic synth (delayed sine pings)
          if (this.synthParams.magic > 0 && Math.random() > 0.7) {
              const osc = this.ctx.createOscillator();
              const gain = this.ctx.createGain();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(400 + Math.random() * 800, t);
              
              gain.gain.setValueAtTime(0, t);
              gain.gain.linearRampToValueAtTime(this.synthParams.magic * 0.1, t + 0.1);
              gain.gain.linearRampToValueAtTime(0, t + 1.0);
              
              osc.connect(gain);
              gain.connect(this.masterGain);
              osc.start(t);
              osc.stop(t + 1.1);
          }
      }, 300);
  }

  public setSynthParam(param: SynthParamId, value: number) {
    this.synthParams[param] = value;
    
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    
    // Smooth transition for noise gains
    if (param === 'wind' && this.windGain) {
        this.windGain.gain.linearRampToValueAtTime(value * 0.5, t + 0.1); // Scaled down to prevent clipping
    }
    if (param === 'rain' && this.rainGain) {
        this.rainGain.gain.linearRampToValueAtTime(value * 0.4, t + 0.1); // Scaled down
    }
  }

  public engage() {
    if (this.noiseSource) {
      try {
        this.noiseSource.start();
      } catch(e) { /* already started */ }
    }
    
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    if (this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
      this.ytPlayer.playVideo();
    }
  }

  public stop() {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend();
    }
    
    if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
      this.ytPlayer.pauseVideo();
    }
  }

  public destroy() {
    this.stop();
    if (this.oscInterval) clearInterval(this.oscInterval);
    if (this.noiseSource) {
        try { this.noiseSource.stop(); } catch(e){}
    }
  }
}
