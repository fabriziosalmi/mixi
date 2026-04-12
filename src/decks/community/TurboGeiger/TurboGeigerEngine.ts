import { TurboGeigerBus } from './TurboGeigerBus';

export type DeckId = 'A' | 'B';

export class TurboGeigerEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  private bus!: TurboGeigerBus;

  private _isPlaying = false;
  private _halfLife = 0.5; 
  private _radiationType: 'alpha' | 'beta' | 'gamma' = 'alpha';
  private _masterVolume = 1.0;

  private node!: AudioWorkletNode;
  
  // DSP State
  public onTick?: () => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  async init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboGeigerBus(this.ctx);

    try {
      await this.ctx.audioWorklet.addModule(new URL('./TurboGeigerProcessor.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'turbogeiger-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
    } catch (err) { console.warn('[TurboGeiger] AudioWorklet init failed:', err); return; }
    
    this.node.port.onmessage = (event) => {
        if (event.data.id === 'tick') {
            if (this.onTick) this.onTick();
        }
    };

    this.node.connect(this.bus.input);
  }

  destroy() {
    this.stop();
    if (this.node) {
      this.node.disconnect();
    }
    this.bus.destroy();
  }

  engage() {
    this._isPlaying = true;
    if (this.node) this.node.port.postMessage({ id: 'setRunning', value: true });
  }

  stop() {
    this._isPlaying = false;
    if (this.node) this.node.port.postMessage({ id: 'setRunning', value: false });
  }

  mutate() {
    this.halfLife = Math.random();
    const rr = Math.random();
    if (rr < 0.33) this.radiationType = 'alpha';
    else if (rr < 0.66) this.radiationType = 'beta';
    else this.radiationType = 'gamma';
  }

  get isPlaying() { return this._isPlaying; }
  
  get halfLife() { return this._halfLife; }
  set halfLife(v: number) { 
    this._halfLife = v; 
    if (this.node) this.node.port.postMessage({ id: 'setHalfLife', value: v });
  }

  get radiationType() { return this._radiationType; }
  set radiationType(v: 'alpha' | 'beta' | 'gamma') { 
    this._radiationType = v; 
    if (this.node) this.node.port.postMessage({ id: 'setRadiationType', value: v });
  }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
