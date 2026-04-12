// @ts-ignore — Wasm module loaded at runtime in AudioWorklet context
import { TurboSynthWasm } from 'turbosynth-wasm';

class TurboSynthProcessor extends AudioWorkletProcessor {
  private wasmEngine: TurboSynthWasm;

  constructor() {
    super();
    this.wasmEngine = new TurboSynthWasm();

    this.port.onmessage = (event) => {
      const { id, value } = event.data;
      switch (id) {
        case 'setRunning': this.wasmEngine.set_running(value); break;
        case 'setTempo': this.wasmEngine.set_tempo(value); break;
        case 'setPattern': this.wasmEngine.set_pattern(value); break;
        case 'setWaveform': this.wasmEngine.set_waveform(value); break;
        case 'setCutoff': this.wasmEngine.set_cutoff(value); break;
        case 'setResonance': this.wasmEngine.set_resonance(value); break;
        case 'setAttack': this.wasmEngine.set_attack(value); break;
        case 'setRelease': this.wasmEngine.set_release(value); break;
        case 'free': this.wasmEngine.free(); break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>) {
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

registerProcessor('turbosynth-processor', TurboSynthProcessor);
