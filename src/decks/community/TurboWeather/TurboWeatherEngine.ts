// @ts-nocheck
import { TurboWeatherBus } from './TurboWeatherBus';
import { TurboWeatherSnapshot } from './types';

export type DeckId = 'A' | 'B';

export class TurboWeatherEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  private bus!: TurboWeatherBus;

  private _isActive = false;
  private _masterVolume = 1.0;

  private _lat = 51.5; // Default London
  private _lon = -0.12;
  
  private noiseNode: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private amplitudeNode: GainNode | null = null;

  public onWeatherUpdate?: (data: Partial<TurboWeatherSnapshot>) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboWeatherBus(this.ctx);
  }

  destroy() {
    this.stop();
    this.bus.destroy();
  }

  private createPinkNoise() {
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11; // gain compensation
        b6 = white * 0.115926;
    }
    return buffer;
  }

  engage() {
    if (this._isActive) return;
    this._isActive = true;

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = this.createPinkNoise();
    this.noiseNode.loop = true;

    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.Q.value = 5.0; // Resonant wind
    this.filterNode.frequency.value = 400; // Idle

    this.amplitudeNode = this.ctx.createGain();
    this.amplitudeNode.gain.value = 0.0;

    this.noiseNode.connect(this.filterNode);
    this.filterNode.connect(this.amplitudeNode);
    this.amplitudeNode.connect(this.bus.input);

    this.noiseNode.start();
    
    // Auto fetch
    this.fetchWeather();
  }

  async fetchWeather() {
    if (this.onWeatherUpdate) this.onWeatherUpdate({ isFetching: true });
    
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${this._lat}&longitude=${this._lon}&current_weather=true`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.current_weather) {
        const cw = data.current_weather;
        const windSpeed = cw.windspeed || 0;
        const temperature = cw.temperature || 0;
        const code = cw.weathercode || 0;

        // Map Windspeed to Filter Cutoff and Gain
        // Speed 0-100 km/h -> 200Hz - 4000Hz
        const targetFreq = 200 + (windSpeed / 100) * 3800;
        const targetGain = Math.min(1.0, 0.1 + (windSpeed / 100));
        
        if (this.filterNode && this.amplitudeNode) {
           this.filterNode.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.5);
           this.amplitudeNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.5);
        }

        if (this.onWeatherUpdate) {
           this.onWeatherUpdate({ 
             windSpeed, 
             temperature, 
             weatherCode: code,
             isFetching: false 
           });
        }
      }
    } catch (err) {
      console.error("TurboWeather Fetch Error:", err);
      if (this.onWeatherUpdate) this.onWeatherUpdate({ isFetching: false });
    }
  }

  stop() {
    this._isActive = false;
    if (this.noiseNode) { this.noiseNode.stop(); this.noiseNode.disconnect(); this.noiseNode = null; }
    if (this.filterNode) { this.filterNode.disconnect(); this.filterNode = null; }
    if (this.amplitudeNode) { this.amplitudeNode.disconnect(); this.amplitudeNode = null; }
  }

  get isActive() { return this._isActive; }
  
  get lat() { return this._lat; }
  set lat(v: number) { this._lat = v; }
  
  get lon() { return this._lon; }
  set lon(v: number) { this._lon = v; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
