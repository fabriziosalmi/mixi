// Pure JS subtractive synth processor
class TurboSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRunning = false;
    this.tempo = 120;
    this.pattern = [];
    this.currentStep = 0;
    this.samplesPerStep = 0;
    this.stepCounter = 0;
    this.waveform = 2;
    this.cutoff = 0.5;
    this.resonance = 0.2;
    this.attack = 0.1;
    this.release = 0.2;
    this.phase = 0;
    this.freq = 440;
    this.envLevel = 0;
    this.envStage = 'off';
    this.f0 = 0; this.f1 = 0; this.f2 = 0; this.f3 = 0;
    this._updateTiming();

    this.port.onmessage = (event) => {
      const { id, value } = event.data;
      switch (id) {
        case 'setRunning': this.isRunning = value; break;
        case 'setTempo': this.tempo = value; this._updateTiming(); break;
        case 'setPattern': this.pattern = value; break;
        case 'setWaveform': this.waveform = Math.round(value); break;
        case 'setCutoff': this.cutoff = value; break;
        case 'setResonance': this.resonance = value; break;
        case 'setAttack': this.attack = value; break;
        case 'setRelease': this.release = value; break;
        case 'free': break;
      }
    };
  }

  _updateTiming() {
    this.samplesPerStep = Math.floor((sampleRate * 60) / (this.tempo * 4));
  }

  _oscillator(phase) {
    switch (this.waveform) {
      case 0: return Math.sin(phase * Math.PI * 2);
      case 1: return Math.abs(phase * 4 - 2) - 1;
      case 2: return phase * 2 - 1;
      case 3: return phase < 0.5 ? 1 : -1;
      default: return phase * 2 - 1;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channelData = output[0];

    for (let i = 0; i < channelData.length; i++) {
      if (!this.isRunning || this.pattern.length === 0) {
        channelData[i] = 0; continue;
      }

      if (this.stepCounter >= this.samplesPerStep) {
        this.stepCounter = 0;
        this.currentStep = (this.currentStep + 1) % this.pattern.length;
        const step = this.pattern[this.currentStep];
        if (step && step[1]) {
          this.freq = 440 * Math.pow(2, (step[0] - 69) / 12);
          this.envStage = 'attack';
        } else {
          this.envStage = 'release';
        }
      }
      this.stepCounter++;

      const attackRate = 1 / (Math.max(0.001, this.attack) * sampleRate);
      const releaseRate = 1 / (Math.max(0.01, this.release) * sampleRate);
      if (this.envStage === 'attack') {
        this.envLevel += attackRate;
        if (this.envLevel >= 1) { this.envLevel = 1; this.envStage = 'release'; }
      } else if (this.envStage === 'release') {
        this.envLevel -= releaseRate;
        if (this.envLevel <= 0) { this.envLevel = 0; this.envStage = 'off'; }
      }

      this.phase += this.freq / sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      let sample = this._oscillator(this.phase) * this.envLevel;

      const fc = 20 + this.cutoff * this.cutoff * 18000;
      const g = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);
      const res = this.resonance * 3.99;
      const input = sample - res * this.f3;
      this.f0 += g * (Math.tanh(input) - Math.tanh(this.f0));
      this.f1 += g * (Math.tanh(this.f0) - Math.tanh(this.f1));
      this.f2 += g * (Math.tanh(this.f1) - Math.tanh(this.f2));
      this.f3 += g * (Math.tanh(this.f2) - Math.tanh(this.f3));
      sample = this.f3;

      channelData[i] = sample * 0.4;
    }

    for (let c = 1; c < output.length; c++) {
      output[c].set(channelData);
    }
    return true;
  }
}

registerProcessor('turbosynth-processor', TurboSynthProcessor);
