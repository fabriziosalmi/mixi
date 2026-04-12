// @ts-nocheck
import { TurboVoxWasm } from 'turbovox-wasm';

class TurboVoxProcessor extends AudioWorkletProcessor {
  private wasmEngine: TurboVoxWasm;

  constructor() {
    super();
    this.wasmEngine = new TurboVoxWasm();

    this.port.onmessage = (event) => {
      const { id, value } = event.data;
      switch (id) {
        case 'setRunning': this.wasmEngine.set_running(value); break;
        case 'setTempo': this.wasmEngine.set_tempo(value); break;
        case 'setPattern': this.wasmEngine.set_pattern(value); break;
        case 'setMorph': this.wasmEngine.set_morph(value); break;
        case 'setVibrato': this.wasmEngine.set_vibrato(value); break;
        case 'setGlide': this.wasmEngine.set_glide(value); break;
        case 'setLfoRate': this.wasmEngine.set_lfo_rate(value); break;
        case 'setAttack': this.wasmEngine.set_attack(value); break;
        case 'setDecay': this.wasmEngine.set_decay(value); break;
        case 'free': this.wasmEngine.free(); break;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    
    const channelData = output[0];
    this.wasmEngine.process(channelData);
    
    for (let c = 1; c < output.length; c++) {
      output[c].set(channelData);
    }
    
    return true;
  }
}

registerProcessor('turbovox-processor', TurboVoxProcessor);
