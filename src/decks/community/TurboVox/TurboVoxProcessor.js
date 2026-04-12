// Pure JS formant/vocal synth processor
const FORMANTS = [
  [800, 1150, 2900],  // A
  [400, 1600, 2700],  // E
  [350, 2300, 3200],  // I
  [450, 800, 2830],   // O
  [325, 700, 2530],   // U
];

class TurboVoxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRunning = false;
    this.tempo = 120;
    this.pattern = [];
    this.currentStep = 0;
    this.samplesPerStep = 0;
    this.stepCounter = 0;
    this.morph = 0;
    this.vibrato = 0.2;
    this.glide = 0.1;
    this.lfoRate = 0.5;
    this.attack = 0;
    this.decay = 0.3;
    this.phase = 0;
    this.freq = 220;
    this.targetFreq = 220;
    this.lfoPhase = 0;
    this.envLevel = 0;
    this.envStage = 'off';
    this.bp = [[0, 0], [0, 0], [0, 0]];
    this._updateTiming();

    this.port.onmessage = (event) => {
      const { id, value } = event.data;
      switch (id) {
        case 'setRunning': this.isRunning = value; break;
        case 'setTempo': this.tempo = value; this._updateTiming(); break;
        case 'setPattern': this.pattern = value; break;
        case 'setMorph': this.morph = value; break;
        case 'setVibrato': this.vibrato = value; break;
        case 'setGlide': this.glide = value; break;
        case 'setLfoRate': this.lfoRate = value; break;
        case 'setAttack': this.attack = value; break;
        case 'setDecay': this.decay = value; break;
        case 'free': break;
      }
    };
  }

  _updateTiming() {
    this.samplesPerStep = Math.floor((sampleRate * 60) / (this.tempo * 4));
  }

  _getFormants() {
    const idx = this.morph * 4;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, 4);
    const t = idx - lo;
    return [
      FORMANTS[lo][0] + (FORMANTS[hi][0] - FORMANTS[lo][0]) * t,
      FORMANTS[lo][1] + (FORMANTS[hi][1] - FORMANTS[lo][1]) * t,
      FORMANTS[lo][2] + (FORMANTS[hi][2] - FORMANTS[lo][2]) * t,
    ];
  }

  _bandpass(input, centerFreq, bw, state) {
    const omega = 2 * Math.PI * centerFreq / sampleRate;
    const alpha = Math.sin(omega) * bw / centerFreq;
    const cosw = Math.cos(omega);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const a1 = -2 * cosw / a0;
    const a2 = (1 - alpha) / a0;
    const out = b0 * input + state[0];
    state[0] = -b0 * input - a1 * out + state[1];
    state[1] = b0 * input - a2 * out;
    return out;
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
          this.targetFreq = 440 * Math.pow(2, (step[0] - 69) / 12);
          this.envStage = 'attack';
          this.envLevel = 0;
        }
      }
      this.stepCounter++;

      const glideRate = 1 - Math.pow(0.001, 1 / (Math.max(0.001, this.glide) * sampleRate));
      this.freq += (this.targetFreq - this.freq) * glideRate;

      this.lfoPhase += (this.lfoRate * 20) / sampleRate;
      if (this.lfoPhase >= 1) this.lfoPhase -= 1;
      const lfo = Math.sin(this.lfoPhase * Math.PI * 2) * this.vibrato * 0.02;

      if (this.envStage === 'attack') {
        const rate = 1 / (Math.max(0.001, this.attack) * sampleRate);
        this.envLevel += rate;
        if (this.envLevel >= 1) { this.envLevel = 1; this.envStage = 'decay'; }
      } else if (this.envStage === 'decay') {
        const rate = 1 / (Math.max(0.01, this.decay) * sampleRate);
        this.envLevel -= rate;
        if (this.envLevel <= 0) { this.envLevel = 0; this.envStage = 'off'; }
      }

      const oscFreq = this.freq * (1 + lfo);
      this.phase += oscFreq / sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      const source = this.phase * 2 - 1;

      const formants = this._getFormants();
      const bw = 80;
      let vocal = 0;
      vocal += this._bandpass(source, formants[0], bw, this.bp[0]) * 1.0;
      vocal += this._bandpass(source, formants[1], bw, this.bp[1]) * 0.7;
      vocal += this._bandpass(source, formants[2], bw, this.bp[2]) * 0.4;

      channelData[i] = vocal * this.envLevel * 0.35;
    }

    for (let c = 1; c < output.length; c++) {
      output[c].set(channelData);
    }
    return true;
  }
}

registerProcessor('turbovox-processor', TurboVoxProcessor);
