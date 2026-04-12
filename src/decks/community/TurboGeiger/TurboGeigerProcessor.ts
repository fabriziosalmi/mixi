// @ts-nocheck
class TurboGeigerProcessor extends AudioWorkletProcessor {
  private isPlaying = false;
  private halfLife = 0.5;
  private radiationType: 'alpha' | 'beta' | 'gamma' = 'alpha';
  
  private decayEnvelope = 0.0;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      const { id, value } = event.data;
      switch (id) {
        case 'setRunning': this.isPlaying = value; break;
        case 'setHalfLife': this.halfLife = value; break;
        case 'setRadiationType': this.radiationType = value; break;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    
    const channelData = output[0];
    let localTickOccurred = false;
    
    const lambda = 0.00001 + (this.halfLife * this.halfLife * 0.015);

    for (let i = 0; i < channelData.length; i++) {
        if (!this.isPlaying) {
          channelData[i] = 0;
          this.decayEnvelope = 0;
          continue;
        }

        // Poisson-like distribution simulated with random threshold
        if (Math.random() < lambda) {
          localTickOccurred = true;
          this.decayEnvelope = 1.0; // Trigger impulse
        }

        let sample = 0;
        if (this.decayEnvelope > 0.001) {
           switch (this.radiationType) {
             case 'alpha':
               // Sharp snap, single polarity
               sample = this.decayEnvelope;
               this.decayEnvelope *= 0.8; // Very fast decay
               break;
             case 'beta':
               // Noisy burst
               sample = (Math.random() * 2 - 1) * this.decayEnvelope;
               this.decayEnvelope *= 0.95; // Medium decay
               break;
             case 'gamma':
               // Dense low-frequency thud + noise
               sample = (Math.random() * 2 - 1) * this.decayEnvelope;
               this.decayEnvelope *= 0.995; // Slow decay tail
               break;
           }
        } else {
           this.decayEnvelope = 0;
        }

        channelData[i] = sample;
    }
    
    for (let c = 1; c < output.length; c++) {
      output[c].set(channelData);
    }
    
    if (localTickOccurred) {
        this.port.postMessage({ id: 'tick' });
    }

    return true;
  }
}

registerProcessor('turbogeiger-processor', TurboGeigerProcessor);
