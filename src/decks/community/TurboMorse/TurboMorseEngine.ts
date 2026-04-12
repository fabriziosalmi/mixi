import { TurboMorseBus } from './TurboMorseBus';

export type DeckId = 'A' | 'B';

const MORSE_DICT: Record<string, string> = {
  'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
  'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
  'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
  'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
  'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
  '9': '----.', '0': '-----', ' ': ' ',
};

export class TurboMorseEngine {
  readonly deckId: DeckId;
  private ctx!: AudioContext;
  private bus!: TurboMorseBus;

  private _isActive = false;
  private _message = "MIXI ENIGMA TRANSMISSION";
  private _wpm = 20; 
  private _distortion = 0.8;
  private _masterVolume = 1.0;
  
  private distortionNode!: WaveShaperNode;

  private currentSequence: {type: 'dot'|'dash'|'gap', duration: number}[] = [];
  private seqIndex = 0;
  private timer: number = 0;

  public onTransmit?: (symbol: string) => void;

  constructor(deckId: DeckId) {
    this.deckId = deckId;
  }

  init(ctx: AudioContext) {
    this.ctx = ctx;
    this.bus = new TurboMorseBus(this.ctx);
    
    this.distortionNode = this.ctx.createWaveShaper();
    this.updateDistortionCurve();
    this.distortionNode.connect(this.bus.input);
  }

  destroy() {
    this.stop();
    this.distortionNode.disconnect();
    this.bus.destroy();
  }

  private updateDistortionCurve() {
    // Basic hard clipping curve
    const k = typeof this._distortion === 'number' ? this._distortion * 400 : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for ( let i = 0 ; i < n_samples; ++i ) {
      const x = i * 2 / n_samples - 1;
      curve[i] = ( 3 + k ) * x * 20 * deg / ( Math.PI + k * Math.abs(x) );
    }
    this.distortionNode.curve = curve;
    this.distortionNode.oversample = '4x';
  }

  private encodeMessage() {
    // standard word is 50 units. dot = 1 unit.
    const unitMs = 1200 / this._wpm; 
    
    this.currentSequence = [];
    const text = this._message.toUpperCase();
    
    for (let char of text) {
       if (char === ' ') {
         this.currentSequence.push({type: 'gap', duration: unitMs * 7});
       } else {
         const code = MORSE_DICT[char];
         if (code) {
           for (let i = 0; i < code.length; i++) {
             const sym = code[i];
             if (sym === '.') this.currentSequence.push({type: 'dot', duration: unitMs});
             if (sym === '-') this.currentSequence.push({type: 'dash', duration: unitMs * 3});
             
             // intra-character gap
             if (i < code.length - 1) {
               this.currentSequence.push({type: 'gap', duration: unitMs});
             }
           }
           // inter-character gap
           this.currentSequence.push({type: 'gap', duration: unitMs * 3});
         }
       }
    }
  }

  private playTone(durationMs: number) {
     if (this.ctx.state !== 'running') return;
     const osc = this.ctx.createOscillator();
     const env = this.ctx.createGain();
     
     osc.type = 'square';
     osc.frequency.value = 600; // Classic 600Hz telegraph tone
     
     env.gain.value = 0;
     osc.connect(env);
     env.connect(this.distortionNode);
     
     const now = this.ctx.currentTime;
     env.gain.setValueAtTime(0, now);
     env.gain.setTargetAtTime(1.0, now, 0.01);
     env.gain.setTargetAtTime(0, now + (durationMs/1000) - 0.01, 0.01);
     
     osc.start(now);
     osc.stop(now + (durationMs/1000));
  }

  private nextSymbol = () => {
     if (!this._isActive || this.currentSequence.length === 0) return;
     
     if (this.seqIndex >= this.currentSequence.length) {
        this.seqIndex = 0; // loop message
     }

     const sym = this.currentSequence[this.seqIndex];
     
     if (sym.type === 'dot') {
       this.playTone(sym.duration);
       if (this.onTransmit) this.onTransmit('.');
     } else if (sym.type === 'dash') {
       this.playTone(sym.duration);
       if (this.onTransmit) this.onTransmit('-');
     } else {
       if (this.onTransmit) this.onTransmit(' ');
     }

     this.seqIndex++;
     this.timer = window.setTimeout(this.nextSymbol, sym.duration);
  };

  engage() {
    if (this._isActive) return;
    this._isActive = true;
    this.seqIndex = 0;
    this.encodeMessage();
    this.nextSymbol();
  }

  stop() {
    this._isActive = false;
    clearTimeout(this.timer);
  }

  get isActive() { return this._isActive; }
  
  get message() { return this._message; }
  set message(v: string) { 
    this._message = v; 
    if (this._isActive) {
      this.encodeMessage();
      this.seqIndex = 0;
    }
  }

  get wpm() { return this._wpm; }
  set wpm(v: number) { 
    this._wpm = v; 
    if (this._isActive) {
      const p = this.seqIndex;
      this.encodeMessage();
      this.seqIndex = Math.min(p, this.currentSequence.length - 1);
    }
  }

  get distortion() { return this._distortion; }
  set distortion(v: number) { 
    this._distortion = v; 
    this.updateDistortionCurve();
  }
  
  get masterVolume() { return this._masterVolume; }
  set masterVolume(v: number) {
    this._masterVolume = v;
    this.bus.setVolume(v);
  }
}
