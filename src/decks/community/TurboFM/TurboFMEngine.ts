import { TurboFMBus } from './TurboFMBus';
import { TurboFMSynth } from './TurboFMSynth';
import { defaultSynth, defaultFx, defaultSteps, FxKnobId, SynthParamId, TurboFMStep, STEP_COUNT } from './types';

export type DeckId = 'A' | 'B';

export class TurboFMEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  
  public bus!: TurboFMBus;
  private synth!: TurboFMSynth;

  private _playing = false;
  private _currentStep = -1;
  private _bpm = 120;
  private _syncToMaster = false;
  private _swing = 0.0;
  private _masterVolume = 1.0;

  private _steps: TurboFMStep[] = defaultSteps();
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
    this.bus = new TurboFMBus(this.ctx);
    this.synth = new TurboFMSynth(this.ctx);
    
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
    const bpm = this._bpm;
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
      this.nextStepTime += stepDuration;
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
  
  updateStep(idx: number, stepData: Partial<TurboFMStep>) {
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
    // FM Sequences tend to be either plucky basslines or glassy arps
    const hits = 3 + Math.floor(Math.random() * 10);
    const offset = Math.floor(Math.random() * 8);

    // Euclidean rhythm
    let pattern: boolean[] = Array(STEP_COUNT).fill(false);
    let bucket = 0;
    for (let i = 0; i < STEP_COUNT; i++) {
        bucket += hits;
        if (bucket >= STEP_COUNT) {
            bucket -= STEP_COUNT;
            pattern[i] = true;
        }
    }
    pattern = [...pattern.slice(offset), ...pattern.slice(0, offset)];

    const scales = [
      [0, 2, 3, 7, 8], // Japanese-inspired / Insen scale for FM Bells
      [0, 2, 4, 5, 7, 9, 11], // Major
      [0, 3, 5, 7, 10] // Minor Pentatonic
    ];
    const scale = scales[Math.floor(Math.random() * scales.length)];
    const root = 36 + Math.floor(Math.random() * 24); // C2-C4

    this._steps = this._steps.map((_s, i) => {
      const degree = scale[Math.floor(Math.random() * scale.length)];
      return {
        note: root + degree + (Math.random() > 0.8 ? 12 : 0),
        gate: pattern[i]
      };
    });
    this.synth.setPattern(this._steps);
  }

  mutateParams() {
    // Smart FM Mutation: integer multiples sound musical (harmonic), fractional sound metallic/atonal
    const isHarmonic = Math.random() > 0.3; // Mostly musical

    this.setSynthParam('algo', Math.floor(Math.random() * 4)); // 0-3
    this.setSynthParam('feedback', Math.random() < 0.5 ? 0 : Math.random()); 

    const ratios: SynthParamId[] = ['op1Ratio', 'op2Ratio', 'op3Ratio', 'op4Ratio'];
    
    ratios.forEach(param => {
       if (isHarmonic) {
          // Snap ratio to common integer multiples or simple fractions: 0.5, 1, 2, 3, 4, 5, 7
          const choices = [0.5, 1, 2, 3, 4, 5, 7];
          // Maps to 0-1 range. Currently formula is: realRatio = 0.5 + norm * 9.5
          // So norm = (realRatio - 0.5) / 9.5
          const choice = choices[Math.floor(Math.random() * choices.length)];
          this.setSynthParam(param, (choice - 0.5) / 9.5);
       } else {
          // Metallic chaos
          this.setSynthParam(param, Math.random());
       }
    });
  }

  get synthParams() { return this._synthParams; }
  setSynthParam(id: SynthParamId, value: number) {
    this._synthParams[id] = value;
    this.applySynthParam(id, value);
  }

  get fxParams() { return this._fxParams; }
  setFx(id: FxKnobId, value: number) {
    this._fxParams[id] = value;
  }

  private applySynthParam(id: SynthParamId, norm: number) {
    switch (id) {
      case 'algo': this.synth.setAlgo(Math.round(norm * 3.0)); break;
      case 'feedback': this.synth.setFeedback(norm); break;
      case 'carAttack': this.synth.setCarAttack(0.001 + norm * 2.0); break;
      case 'carDecay': this.synth.setCarDecay(0.001 + norm * 5.0); break;
      case 'modAttack': this.synth.setModAttack(0.001 + norm * 2.0); break;
      case 'modDecay': this.synth.setModDecay(0.001 + norm * 5.0); break;
      
      // Ratios map to interesting FM ratios (0.5, 1, 2, 3, 4, 5, 7, 11 etc but simpler: smooth 0.5 to 10.0)
      case 'op1Ratio': this.synth.setOpRatio(0, 0.5 + norm * 9.5); break;
      case 'op1Level': this.synth.setOpLevel(0, norm); break;
      case 'op2Ratio': this.synth.setOpRatio(1, 0.5 + norm * 9.5); break;
      case 'op2Level': this.synth.setOpLevel(1, norm); break;
      case 'op3Ratio': this.synth.setOpRatio(2, 0.5 + norm * 9.5); break;
      case 'op3Level': this.synth.setOpLevel(2, norm); break;
      case 'op4Ratio': this.synth.setOpRatio(3, 0.5 + norm * 9.5); break;
      case 'op4Level': this.synth.setOpLevel(3, norm); break;
    }
  }

  private applyAllSynthParams() {
    for (const k of Object.keys(this._synthParams)) {
      this.applySynthParam(k as SynthParamId, this._synthParams[k as SynthParamId]);
    }
  }
}
