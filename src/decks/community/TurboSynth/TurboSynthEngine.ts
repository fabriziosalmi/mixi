// @ts-nocheck
import { TurboSynthBus } from './TurboSynthBus';
import { TurboSynthSynth } from './TurboSynthSynth';
import { defaultSynth, defaultFx, defaultSteps, FxKnobId, SynthParamId, TurboSynthStep, STEP_COUNT } from './types';

export type DeckId = 'A' | 'B';

export class TurboSynthEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  
  private bus!: TurboSynthBus;
  private synth!: TurboSynthSynth;

  private _playing = false;
  private _currentStep = -1;
  private _bpm = 120;
  private _syncToMaster = false;
  private _swing = 0.0;
  private _masterVolume = 1.0;

  private _steps: TurboSynthStep[] = defaultSteps();
  private _synthParams = defaultSynth();
  private _fxParams = defaultFx();

  onStepChange?: (step: number) => void;

  private timerId: number | null = null;
  private uiTimers: Set<number> = new Set();
  private nextStepTime = 0;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  async init(ctx: AudioContext) {
    this.ctx = ctx;
    
    this.bus = new TurboSynthBus(this.ctx);
    this.synth = new TurboSynthSynth(this.ctx);
    
    await this.synth.init();
    
    this.synth.connect(this.bus.input);

    this.applyAllSynthParams();
    this.synth.setPattern(this._steps);
    this.synth.setTempo(this._bpm);
  }

  destroy() {
    this.stop();
    this.synth.destroy();
    this.bus.destroy();
  }

  engage() {
    if (this._playing) return;
    
    this._playing = true;
    this.nextStepTime = this.ctx.currentTime;
    
    this.synth.setRunning(true);
    
    const TICK_MS = 25;
    this.timerId = window.setInterval(this.tick, TICK_MS);
  }

  stop() {
    this._playing = false;
    this._currentStep = -1;
    this.synth.setRunning(false);
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.uiTimers.forEach(t => window.clearTimeout(t));
    this.uiTimers.clear();
    if (this.onStepChange) this.onStepChange(-1);
  }

  private tick = () => {
    const bpm = this._bpm; // In reality reads from useMixiStore
    this.synth.setTempo(bpm);
    
    const stepDuration = (60 / bpm) / 4; 
    const LOOK_AHEAD_S = 0.05;
    
    while (this.nextStepTime < this.ctx.currentTime + LOOK_AHEAD_S) {
      this._currentStep = (this._currentStep + 1) % STEP_COUNT;
      
      if (this.onStepChange) {
        const delay = Math.max(0, this.nextStepTime - this.ctx.currentTime) * 1000;
        const stepToNotify = this._currentStep;
        const t = window.setTimeout(() => {
          this.uiTimers.delete(t);
          if (this.isPlaying && this.onStepChange) this.onStepChange(stepToNotify);
        }, delay);
        this.uiTimers.add(t);
      }
      
      this.nextStepTime += stepDuration; // Simple timing, no swing applied to WA node explicitly via scheduling since Rust takes care of sequence. 
      // If we wanted swing on Rust we would need to pass swing amount to Rust! 
    }
  };

  get isPlaying() { return this._playing; }
  get currentStep() { return this._currentStep; }
  get bpm() { return this._bpm; }
  get syncToMaster() { return this._syncToMaster; }
  set syncToMaster(v: boolean) { this._syncToMaster = v; }
  get swing() { return this._swing; }
  set swing(v: number) { this._swing = v; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }

  get steps() { return this._steps; }
  
  updateStep(idx: number, stepData: Partial<TurboSynthStep>) {
    this._steps[idx] = { ...this._steps[idx], ...stepData };
    this.synth.setPattern(this._steps);
  }

  clearPattern() {
    this._steps = this._steps.map(s => ({ ...s, gate: false }));
    this.synth.setPattern(this._steps);
  }

  resetPattern() {
    this._steps = defaultSteps();
    this.synth.setPattern(this._steps);
  }

  mutateSequence() {
    // Intelligent Techno/Arp Generator using Euclidean distributions
    const hits = 5 + Math.floor(Math.random() * 12); // 5 to 16 hits
    const offset = Math.floor(Math.random() * 8);
    
    // Euclidean algorithm
    let pattern: boolean[] = Array(STEP_COUNT).fill(false);
    let bucket = 0;
    for (let i = 0; i < STEP_COUNT; i++) {
        bucket += hits;
        if (bucket >= STEP_COUNT) {
            bucket -= STEP_COUNT;
            pattern[i] = true;
        }
    }
    
    // Shift pattern
    pattern = [...pattern.slice(offset), ...pattern.slice(0, offset)];

    const scales = [
      [0, 2, 4, 7, 9], // Major pentatonic
      [0, 3, 5, 7, 10], // Minor pentatonic
      [0, 2, 3, 5, 7, 8, 11] // Harmonic minor
    ];
    const scale = scales[Math.floor(Math.random() * scales.length)];
    const root = 48 + Math.floor(Math.random() * 12);

    this._steps = this._steps.map((s, i) => {
      const degree = scale[Math.floor(Math.random() * scale.length)];
      return {
        note: root + degree + (Math.random() > 0.8 ? 12 : 0) - (Math.random() > 0.9 ? 12 : 0),
        gate: pattern[i]
      };
    });
    
    this.synth.setPattern(this._steps);
  }

  mutateParams() {
    const type = Math.random();
    // 0: Sine, 1: Tri, 2: Saw, 3: Sq (or 0-1 mapped)
    if (type < 0.33) {
      // Plucky Bass/Arp
      this.setSynthParam('waveform', 0.66 + Math.random() * 0.34); // Saw/Square
      this.setSynthParam('cutoff', 0.1 + Math.random() * 0.2);
      this.setSynthParam('resonance', 0.4 + Math.random() * 0.4);
      this.setSynthParam('attack', 0.0);
      this.setSynthParam('release', 0.1 + Math.random() * 0.3);
    } else if (type < 0.66) {
      // Atmospheric Pad
      this.setSynthParam('waveform', Math.random() * 0.5); // Sine/Tri
      this.setSynthParam('cutoff', 0.3 + Math.random() * 0.4);
      this.setSynthParam('resonance', Math.random() * 0.3);
      this.setSynthParam('attack', 0.6 + Math.random() * 0.4);
      this.setSynthParam('release', 0.6 + Math.random() * 0.4);
    } else {
      // Aggressive Synth (Brass/Lead)
      this.setSynthParam('waveform', 0.66 + Math.random() * 0.34);
      this.setSynthParam('cutoff', 0.5 + Math.random() * 0.5);
      this.setSynthParam('resonance', 0.2 + Math.random() * 0.6);
      this.setSynthParam('attack', 0.1 + Math.random() * 0.2);
      this.setSynthParam('release', 0.3 + Math.random() * 0.3);
    }
  }

  get synthParams() { return this._synthParams; }
  setSynthParam(id: SynthParamId, value: number) {
    this._synthParams[id] = value;
    this.applySynthParam(id, value);
  }

  get fxParams() { return this._fxParams; }
  setFx(id: FxKnobId, value: number) {
    this._fxParams[id] = value;
    // this.bus.setFx(id, value);
  }

  private applySynthParam(id: SynthParamId, norm: number) {
    switch (id) {
      case 'waveform': this.synth.setWaveform(norm * 3.0); break; // 0..3
      case 'cutoff': this.synth.setCutoff(20.0 + norm * 19980.0); break;
      case 'resonance': this.synth.setResonance(0.1 + norm * 9.9); break;
      case 'attack': this.synth.setAttack(0.001 + norm * 2.0); break;
      case 'release': this.synth.setRelease(0.001 + norm * 5.0); break;
    }
  }

  private applyAllSynthParams() {
    for (const k of Object.keys(this._synthParams)) {
      this.applySynthParam(k as SynthParamId, this._synthParams[k as SynthParamId]);
    }
  }
}
