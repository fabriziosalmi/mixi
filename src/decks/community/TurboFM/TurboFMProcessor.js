// Pure JS 4-operator FM synth processor
class TurboFMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRunning = false;
    this.tempo = 120;
    this.pattern = [];
    this.currentStep = 0;
    this.samplesPerStep = 0;
    this.stepCounter = 0;
    this.algo = 0;
    this.feedback = 0.5;
    this.carAttack = 0;
    this.carDecay = 0.3;
    this.modAttack = 0;
    this.modDecay = 0.1;
    this.opRatio = [1, 2, 3, 4];
    this.opLevel = [1, 1, 1, 1];
    this.opPhase = [0, 0, 0, 0];
    this.freq = 440;
    this.carEnv = 0;
    this.modEnv = 0;
    this.carStage = 'off';
    this.modStage = 'off';
    this.fbPrev = 0;
    this._updateTiming();

    this.port.onmessage = (event) => {
      const { id, value, op } = event.data;
      switch (id) {
        case 'setRunning': this.isRunning = value; break;
        case 'setTempo': this.tempo = value; this._updateTiming(); break;
        case 'setPattern': this.pattern = value; break;
        case 'setAlgo': this.algo = Math.round(value * 3); break;
        case 'setFeedback': this.feedback = value; break;
        case 'setCarAttack': this.carAttack = value; break;
        case 'setCarDecay': this.carDecay = value; break;
        case 'setModAttack': this.modAttack = value; break;
        case 'setModDecay': this.modDecay = value; break;
        case 'setOpRatio':
          if (op >= 0 && op < 4) this.opRatio[op] = 1 + value * 15;
          break;
        case 'setOpLevel':
          if (op >= 0 && op < 4) this.opLevel[op] = value;
          break;
        case 'free': break;
      }
    };
  }

  _updateTiming() {
    this.samplesPerStep = Math.floor((sampleRate * 60) / (this.tempo * 4));
  }

  _advanceEnv(level, stage, attackTime, decayTime) {
    if (stage === 'attack') {
      const rate = 1 / (Math.max(0.001, attackTime) * sampleRate);
      level += rate;
      if (level >= 1) { level = 1; stage = 'decay'; }
    } else if (stage === 'decay') {
      const rate = 1 / (Math.max(0.01, decayTime) * sampleRate);
      level -= rate;
      if (level <= 0) { level = 0; stage = 'off'; }
    }
    return [level, stage];
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
          this.carStage = 'attack'; this.carEnv = 0;
          this.modStage = 'attack'; this.modEnv = 0;
        }
      }
      this.stepCounter++;

      let r;
      r = this._advanceEnv(this.carEnv, this.carStage, this.carAttack, this.carDecay);
      this.carEnv = r[0]; this.carStage = r[1];
      r = this._advanceEnv(this.modEnv, this.modStage, this.modAttack, this.modDecay);
      this.modEnv = r[0]; this.modStage = r[1];

      const inc = this.freq / sampleRate;
      for (let o = 0; o < 4; o++) {
        this.opPhase[o] += inc * this.opRatio[o];
        if (this.opPhase[o] >= 1) this.opPhase[o] -= Math.floor(this.opPhase[o]);
      }

      const TWO_PI = Math.PI * 2;
      const fb = this.feedback * this.fbPrev * 0.5;
      let out = 0;

      const opFn = (idx, mod) =>
        Math.sin((this.opPhase[idx] + mod) * TWO_PI) * this.opLevel[idx];

      switch (this.algo) {
        case 0: {
          const o4 = opFn(3, fb) * this.modEnv;
          const o3 = opFn(2, o4) * this.modEnv;
          const o2 = opFn(1, o3) * this.modEnv;
          out = opFn(0, o2) * this.carEnv;
          this.fbPrev = o4;
          break;
        }
        case 1: {
          const o4 = opFn(3, fb) * this.modEnv;
          const o3 = opFn(2, o4) * this.carEnv;
          const o2 = opFn(1, 0) * this.modEnv;
          const o1 = opFn(0, o2) * this.carEnv;
          out = (o3 + o1) * 0.5;
          this.fbPrev = o4;
          break;
        }
        case 2: {
          const o4 = opFn(3, fb) * this.modEnv;
          const o3 = opFn(2, 0) * this.modEnv;
          const o2 = opFn(1, (o3 + o4) * 0.5) * this.modEnv;
          out = opFn(0, o2) * this.carEnv;
          this.fbPrev = o4;
          break;
        }
        default: {
          out = (opFn(0, fb) + opFn(1, 0) + opFn(2, 0) + opFn(3, 0)) * 0.25 * this.carEnv;
          this.fbPrev = opFn(0, fb);
          break;
        }
      }

      channelData[i] = out * 0.35;
    }

    for (let c = 1; c < output.length; c++) {
      output[c].set(channelData);
    }
    return true;
  }
}

registerProcessor('turbofm-processor', TurboFMProcessor);
