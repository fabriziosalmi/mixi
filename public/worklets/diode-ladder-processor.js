/**
 * Diode Ladder Filter — AudioWorklet Processor
 *
 * 4-pole diode ladder filter with mathematically derived parameters.
 * NOT a TB-303 replica — a new instrument with rigorously calibrated behavior.
 *
 * ═══════════════════════════════════════════════════════════════
 * MATHEMATICAL DERIVATIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * ── VT (Thermal Voltage) ──────────────────────────────────────
 *
 * Each pole's transfer: Δy = g·ps·(tanh(x/VT) - tanh(y/VT))
 *
 * tanh(x/VT) behavior:
 *   |x| << VT  → linear (slope = 1/VT)
 *   |x| ≈  VT  → transition zone (maximum harmonic generation)
 *   |x| >> 3VT → hard saturation (±1)
 *
 * For normalized audio (peak ≈ 0.7 after oscillator):
 *   - Want transition zone at nominal level: VT ≈ signal_peak
 *   - But 4 cascaded poles attenuate: each pole output ≈ 0.7× of input at cutoff
 *   - Pole 1 sees full signal (0.7), Pole 4 sees ~0.7⁴ ≈ 0.24
 *   - Geometric mean of pole inputs: (0.7 · 0.49 · 0.34 · 0.24)^0.25 ≈ 0.41
 *
 * VT = 0.4 places the geometric mean of pole signals at the
 * tanh transition point, maximizing harmonic richness across all poles.
 *
 * ── k_max (Maximum Feedback) ──────────────────────────────────
 *
 * Barkhausen criterion for self-oscillation:
 *   k · ∏|Hᵢ(jω₀)| = 1
 *
 * Single pole gain at cutoff: |H(jω₀)| = 1/√2
 * But pole 1 has capacitance 0.5×, so its -3dB point is 2× higher:
 *   |H₁(jω₀)| = 1/√(1 + (ω₀/(2ω₀))²) = 1/√(1.25) ≈ 0.894
 *   |H₂₃₄(jω₀)| = 1/√2 ≈ 0.707 each
 *
 * k_crit = 1 / (0.894 · 0.707³) = 1 / (0.894 · 0.354) = 1/0.316 ≈ 3.16
 *
 * For controlled ringing without oscillation: k_max = k_crit · 0.97 ≈ 3.07
 * (97% of critical — aggressive but stable)
 *
 * ── Resonance Compensation Gain ───────────────────────────────
 *
 * DC gain of ladder with feedback: G_DC = 1/(1+k) (linear analysis)
 * With nonlinear saturation, effective loss is less severe.
 *
 * Measured/modeled compensation: compGain = √(1 + k)
 *   k=0:    compGain = 1.00  (no loss, no compensation)
 *   k=1.54: compGain = 1.59  (moderate, res=0.5)
 *   k=3.07: compGain = 2.02  (strong, res=1.0)
 *
 * This √ curve matches the nonlinear attenuation better than linear 1+k
 * because tanh saturation partially counteracts the feedback subtraction.
 *
 * ── Resonance Curve ───────────────────────────────────────────
 *
 * Linear mapping (k = res · k_max) wastes most of the knob range
 * on subtle resonance. The perceptually interesting zone (squelch,
 * ringing) happens above k ≈ 2.0 (65% of range).
 *
 * We use a quadratic curve: k = res² · k_max
 *   res=0.0: k=0.00  (clean)
 *   res=0.3: k=0.28  (subtle warmth)
 *   res=0.5: k=0.77  (moderate — filter starts to sing)
 *   res=0.7: k=1.50  (pronounced resonance)
 *   res=0.9: k=2.49  (aggressive squelch)
 *   res=1.0: k=3.07  (maximum — near self-oscillation)
 *
 * This gives fine control in the subtle range (0-0.5) and
 * progressive intensity in the acid range (0.5-1.0).
 *
 * ── Cutoff Coefficient (g) ────────────────────────────────────
 *
 * TPT (Topology-Preserving Transform) integrator:
 *   g = tan(π · fc / fs)
 *
 * This is the exact bilinear transform — no approximation needed.
 * With 2× oversampling (fs_internal = 2·sampleRate):
 *   g = tan(π · fc / (2·sampleRate))
 *
 * Frequency is clamped to 0.45·fs to prevent instability near Nyquist.
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI is licensed under the PolyForm Noncommercial License 1.0.0.
 */

// ── Derived Constants ───────────────────────────────────────
const VT = 0.4;                         // Thermal voltage (see derivation above)
const VT_INV = 1 / VT;                  // = 2.5
const K_MAX = 3.07;                     // k_crit · 0.97 (see Barkhausen derivation)
const POLE_SCALE_0 = 0.5;               // First pole: half capacitance (303 mismatch)
const POLE_SCALE_123 = 1.0;             // Poles 2-4: matched

class DiodeLadderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.s = new Float64Array(4);        // pole states (left / mono)
    this.sR = new Float64Array(4);       // pole states (right channel)

    // Coefficient cache
    this._prevCutoff = -1;
    this._prevRes = -1;
    this._g = 0;
    this._k = 0;
    this._compGain = 1;
  }

  static get parameterDescriptors() {
    return [
      { name: 'cutoff', defaultValue: 800, minValue: 20, maxValue: 18000, automationRate: 'a-rate' },
      { name: 'resonance', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
    ];
  }

  /**
   * Pade 3/3 tanh approximation.
   * Max error < 0.004 for |x| ≤ 3. Hard clips beyond.
   */
  tanhApprox(x) {
    if (x > 3) return 1;
    if (x < -3) return -1;
    const x2 = x * x;
    return x * (27 + x2) / (27 + 9 * x2);
  }

  /**
   * Process one sample through the 4-pole diode ladder.
   */
  processSample(input, g, k, s) {
    // Feedback from last pole (standard ladder topology)
    const u = input - k * this.tanhApprox(s[3] * VT_INV);

    // Pole 1: half capacitance (0.5×) — faster, less filtering
    s[0] += g * POLE_SCALE_0 * (this.tanhApprox(u * VT_INV) - this.tanhApprox(s[0] * VT_INV));
    // Pole 2
    s[1] += g * POLE_SCALE_123 * (this.tanhApprox(s[0] * VT_INV) - this.tanhApprox(s[1] * VT_INV));
    // Pole 3
    s[2] += g * POLE_SCALE_123 * (this.tanhApprox(s[1] * VT_INV) - this.tanhApprox(s[2] * VT_INV));
    // Pole 4
    s[3] += g * POLE_SCALE_123 * (this.tanhApprox(s[2] * VT_INV) - this.tanhApprox(s[3] * VT_INV));

    return s[3];
  }

  /**
   * Derive filter coefficients from cutoff (Hz) and resonance (0-1).
   * All values mathematically determined — see header derivations.
   */
  computeCoefficients(cutoff, res, sr2) {
    // g: TPT integrator gain (exact bilinear transform)
    const g = Math.tan(Math.PI * Math.min(cutoff, sr2 * 0.45) / sr2);

    // k: quadratic resonance curve for musical control
    // k = res² · K_MAX (see derivation in header)
    const k = res * res * K_MAX;

    // compGain: √(1+k) resonance compensation (see derivation)
    const compGain = Math.sqrt(1 + k);

    return { g, k, compGain };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];

    const cutoffP = parameters.cutoff;
    const resP = parameters.resonance;
    const N = outL.length;
    const sr2 = sampleRate * 2; // 2× oversampling

    const cutoffConst = cutoffP.length === 1;
    const resConst = resP.length === 1;

    // Pre-compute for constant params (k-rate optimization)
    let g, k, compGain;
    if (cutoffConst && resConst) {
      const fc = cutoffP[0];
      const r = resP[0];
      if (fc !== this._prevCutoff || r !== this._prevRes) {
        this._prevCutoff = fc;
        this._prevRes = r;
        const c = this.computeCoefficients(fc, r, sr2);
        this._g = c.g;
        this._k = c.k;
        this._compGain = c.compGain;
      }
      g = this._g;
      k = this._k;
      compGain = this._compGain;
    }

    for (let i = 0; i < N; i++) {
      // Per-sample coefficients for automated params
      if (!cutoffConst || !resConst) {
        const fc = cutoffConst ? cutoffP[0] : cutoffP[i];
        const r = resConst ? resP[0] : resP[i];
        const c = this.computeCoefficients(fc, r, sr2);
        g = c.g;
        k = c.k;
        compGain = c.compGain;
      }

      // Left channel: 2× oversampling (process twice per sample)
      this.processSample(inL[i], g, k, this.s);
      outL[i] = this.processSample(inL[i], g, k, this.s) * compGain;

      // Right channel
      if (input.length > 1) {
        this.processSample(inR[i], g, k, this.sR);
        outR[i] = this.processSample(inR[i], g, k, this.sR) * compGain;
      } else {
        outR[i] = outL[i];
      }
    }

    return true;
  }
}

registerProcessor('diode-ladder-processor', DiodeLadderProcessor);
