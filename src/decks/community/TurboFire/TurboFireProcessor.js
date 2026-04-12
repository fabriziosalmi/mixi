// Pure JS fire/ambient noise processor
class TurboFireProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRunning = false;
    this.warmth = 0.5;
    this.crackle = 0.6;
    this.wind = 0.2;
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0;
    this.windPhase = 0;
    this.lpfState = 0;

    this.port.onmessage = (event) => {
      const { id, value } = event.data;
      switch (id) {
        case 'setRunning': this.isRunning = value; break;
        case 'setWarmth': this.warmth = value; break;
        case 'setCrackle': this.crackle = value; break;
        case 'setWind': this.wind = value; break;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channelData = output[0];

    for (let i = 0; i < channelData.length; i++) {
      if (!this.isRunning) { channelData[i] = 0; continue; }

      const white = Math.random() * 2 - 1;
      this.b0 = 0.99886 * this.b0 + white * 0.0555179;
      this.b1 = 0.99332 * this.b1 + white * 0.0750759;
      this.b2 = 0.96900 * this.b2 + white * 0.1538520;
      this.b3 = 0.86650 * this.b3 + white * 0.3104856;
      this.b4 = 0.55000 * this.b4 + white * 0.5329522;
      this.b5 = -0.7616 * this.b5 - white * 0.0168980;
      const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
      this.b6 = white * 0.115926;

      const cutoff = 100 + this.warmth * 600;
      const alpha = cutoff / sampleRate;
      this.lpfState += alpha * (pink - this.lpfState);
      const fireRoar = this.lpfState * 0.3;

      const crackleThreshold = 1.0 - (this.crackle * 0.005);
      let crack = 0;
      if (Math.random() > crackleThreshold) {
        crack = (Math.random() * 2 - 1) * this.crackle;
      }

      this.windPhase += (0.2 + Math.random() * 0.1) / sampleRate;
      const windScale = (Math.sin(this.windPhase * Math.PI * 2) * 0.5 + 0.5) * this.wind;
      const windNoise = white * windScale * 0.15;

      channelData[i] = fireRoar + crack + windNoise;
    }

    for (let c = 1; c < output.length; c++) {
      output[c].set(channelData);
    }
    return true;
  }
}

registerProcessor('turbofire-processor', TurboFireProcessor);
