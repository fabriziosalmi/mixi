// @ts-nocheck
import { TurboFMWasm } from 'turbofm-wasm';

class TurboFMProcessor extends AudioWorkletProcessor {
  private wasmEngine: TurboFMWasm;

  constructor() {
    super();
    this.wasmEngine = new TurboFMWasm();

    this.port.onmessage = (event) => {
      const { id, value, op } = event.data;
      switch (id) {
        case 'setRunning': this.wasmEngine.set_running(value); break;
        case 'setTempo': this.wasmEngine.set_tempo(value); break;
        case 'setPattern': this.wasmEngine.set_pattern(value); break;
        case 'setAlgo': this.wasmEngine.set_algo(value); break;
        case 'setFeedback': this.wasmEngine.set_feedback(value); break;
        case 'setCarAttack': this.wasmEngine.set_car_attack(value); break;
        case 'setCarDecay': this.wasmEngine.set_car_decay(value); break;
        case 'setModAttack': this.wasmEngine.set_mod_attack(value); break;
        case 'setModDecay': this.wasmEngine.set_mod_decay(value); break;
        case 'setOpRatio': this.wasmEngine.set_op_ratio(op, value); break;
        case 'setOpLevel': this.wasmEngine.set_op_level(op, value); break;
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

registerProcessor('turbofm-processor', TurboFMProcessor);
