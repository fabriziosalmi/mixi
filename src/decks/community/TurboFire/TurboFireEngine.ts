import { TurboFireBus } from './TurboFireBus';
import { TurboFireSynth } from './TurboFireSynth';
import { defaultSynth, defaultFx, FxKnobId, SynthParamId } from './types';

export type DeckId = 'A' | 'B';

export class TurboFireEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  
  private bus!: TurboFireBus;
  private synth!: TurboFireSynth;

  private _playing = false;
  private _masterVolume = 1.0;

  private _synthParams = defaultSynth();
  private _fxParams = defaultFx();

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  async init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboFireBus(this.ctx);
    this.synth = new TurboFireSynth(this.ctx);
    await this.synth.init();
    this.synth.connect(this.bus.input);
    this.applyAllSynthParams();
  }

  destroy() {
    this.stop();
    this.synth.destroy();
    this.bus.destroy();
  }

  engage() {
    if (this._playing) return;
    this._playing = true;
    this.synth.setRunning(true);
  }

  stop() {
    this._playing = false;
    this.synth.setRunning(false);
  }

  get isPlaying() { return this._playing; }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }

  get synthParams() { return this._synthParams; }
  setSynthParam(id: SynthParamId, value: number) {
    this._synthParams[id] = value;
    this.applySynthParam(id, value);
  }

  mutateParams() {
    const type = Math.random();
    if (type < 0.33) {
      // Roaring fire
      this.setSynthParam('warmth', 0.8 + Math.random() * 0.2);
      this.setSynthParam('crackle', 0.6 + Math.random() * 0.4);
      this.setSynthParam('wind', 0.1 + Math.random() * 0.2);
    } else if (type < 0.66) {
      // Windstorm
      this.setSynthParam('warmth', 0.1 + Math.random() * 0.2);
      this.setSynthParam('crackle', 0.0 + Math.random() * 0.2);
      this.setSynthParam('wind', 0.7 + Math.random() * 0.3);
    } else {
      // Balanced Campfire
      this.setSynthParam('warmth', 0.4 + Math.random() * 0.4);
      this.setSynthParam('crackle', 0.3 + Math.random() * 0.4);
      this.setSynthParam('wind', 0.3 + Math.random() * 0.3);
    }
  }

  get fxParams() { return this._fxParams; }
  setFx(id: FxKnobId, value: number) {
    this._fxParams[id] = value;
  }

  private applySynthParam(id: SynthParamId, norm: number) {
    switch (id) {
      case 'warmth': this.synth.setWarmth(norm); break;
      case 'crackle': this.synth.setCrackle(norm); break;
      case 'wind': this.synth.setWind(norm); break;
    }
  }

  private applyAllSynthParams() {
    for (const k of Object.keys(this._synthParams)) {
      this.applySynthParam(k as SynthParamId, this._synthParams[k as SynthParamId]);
    }
  }
}
