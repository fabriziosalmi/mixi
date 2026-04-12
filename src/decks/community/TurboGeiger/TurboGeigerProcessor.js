// Pure JS Geiger counter audio processor
class TurboGeigerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isPlaying = false;
    this.halfLife = 0.5;
    this.radiationType = 'alpha';
    this.decayEnvelope = 0.0;

    this.port.onmessage = (event) => {
      const { id, value } = event.data;
      switch (id) {
        case 'setRunning': this.isPlaying = value; break;
        case 'setHalfLife': this.halfLife = value; break;
        case 'setRadiationType': this.radiationType = value; break;
      }
    };
  }

  process(_inputs, outputs) {
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

      if (Math.random() < lambda) {
        localTickOccurred = true;
        this.decayEnvelope = 1.0;
      }

      let sample = 0;
      if (this.decayEnvelope > 0.001) {
        switch (this.radiationType) {
          case 'alpha':
            sample = this.decayEnvelope;
            this.decayEnvelope *= 0.8;
            break;
          case 'beta':
            sample = (Math.random() * 2 - 1) * this.decayEnvelope;
            this.decayEnvelope *= 0.95;
            break;
          case 'gamma':
            sample = (Math.random() * 2 - 1) * this.decayEnvelope;
            this.decayEnvelope *= 0.995;
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
