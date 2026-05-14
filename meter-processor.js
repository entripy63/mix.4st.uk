// meter-processor.js — AudioWorklet for EBU R128 / ITU-R BS.1770-5 loudness metering
// Implements K-frequency weighting + momentary (400ms) / short-term (3s) LUFS
// Runs in the audio thread; posts readings to the main thread via MessagePort.

class MeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // K-weighting biquad coefficients for 48 kHz (ITU-R BS.1770-5)
    // Will be recalculated in first process() call if sampleRate differs.
    this._coeffsRate = 0;
    this._shelf = null;  // high-shelf pre-filter
    this._hp = null;     // high-pass (RLB weighting)

    // Biquad filter states per channel (up to 2)
    // Each: { x1, x2, y1, y2 } for shelf and hp
    this._states = [];

    // Momentary loudness: 400ms sliding window, 75% overlap (100ms hop)
    // Short-term loudness: 3s sliding window, 75% overlap (100ms hop per block)
    this._blockSamples = 0;   // samples per 400ms block
    this._hopSamples = 0;     // samples per 100ms hop

    // Ring buffer of 100ms-hop mean-squares (K-weighted)
    // Momentary = last 4 hops, Short-term = last 30 hops
    this._hopSquares = [];    // per-hop accumulated x² per channel
    this._hopCount = 0;       // samples accumulated in current hop
    this._ringSize = 30;      // 30 × 100ms = 3s for short-term
    this._ring = [];           // ring of per-channel mean-square arrays
    this._ringIdx = 0;
    this._ringFilled = 0;

    // Post interval: send readings every ~100ms
    this._postAccum = 0;
    this._postInterval = 0;

    // True-peak: track max absolute sample value per reporting interval
    this._truePeak = 0;
  }

  // Compute K-weighting biquad coefficients for the actual sample rate
  // Reference: ITU-R BS.1770-5 §2.1
  _initCoeffs(rate) {
    if (this._coeffsRate === rate) return;
    this._coeffsRate = rate;

    // Pre-computed coefficients for 48000 Hz from ITU-R BS.1770
    if (rate === 48000) {
      this._shelf = {
        b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
        a: [1.0, -1.69065929318241, 0.73248077421585]
      };
      this._hp = {
        b: [1.0, -2.0, 1.0],
        a: [1.0, -1.99004745483398, 0.99007225036621]
      };
    } else {
      // Compute coefficients for arbitrary sample rate
      // Stage 1: High-shelf (+4dB above ~1.5kHz)
      this._shelf = this._calcShelf(rate);
      // Stage 2: High-pass ~38Hz (RLB weighting)
      this._hp = this._calcHighpass(rate);
    }

    this._blockSamples = Math.round(rate * 0.4);   // 400ms
    this._hopSamples = Math.round(rate * 0.1);      // 100ms
    this._postInterval = this._hopSamples;           // post every 100ms
  }

  // High-shelf filter design for K-weighting stage 1
  // Parameters from BS.1770: Vh=1.58489319246111 (≈+4dB), Q=0.7071752369554193
  _calcShelf(rate) {
    const Vh = 1.58489319246111;
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const fc = 1681.974450955533;
    const Q = 0.7071752369554193;
    const K = Math.tan(Math.PI * fc / rate);
    const K2 = K * K;
    const a0 = 1 + K / Q + K2;
    return {
      b: [(Vh + Vb * K / Q + K2) / a0, (2 * (K2 - Vh)) / a0, (Vh - Vb * K / Q + K2) / a0],
      a: [1.0, (2 * (K2 - 1)) / a0, (1 - K / Q + K2) / a0]
    };
  }

  // High-pass filter design for K-weighting stage 2 (RLB)
  _calcHighpass(rate) {
    const fc = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan(Math.PI * fc / rate);
    const K2 = K * K;
    const a0 = 1 + K / Q + K2;
    return {
      b: [1 / a0, -2 / a0, 1 / a0],
      a: [1.0, (2 * (K2 - 1)) / a0, (1 - K / Q + K2) / a0]
    };
  }

  // Apply biquad filter to a single sample, mutating state in-place
  _biquad(coeffs, state, x) {
    const y = coeffs.b[0] * x + coeffs.b[1] * state.x1 + coeffs.b[2] * state.x2
                              - coeffs.a[1] * state.y1 - coeffs.a[2] * state.y2;
    state.x2 = state.x1;
    state.x1 = x;
    state.y2 = state.y1;
    state.y1 = y;
    return y;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !input[0].length) return true;

    const nCh = input.length;
    const len = input[0].length;
    const rate = sampleRate;  // AudioWorklet global

    this._initCoeffs(rate);

    // Initialise per-channel filter states on first call / channel change
    while (this._states.length < nCh) {
      this._states.push({
        shelf: { x1: 0, x2: 0, y1: 0, y2: 0 },
        hp:    { x1: 0, x2: 0, y1: 0, y2: 0 }
      });
    }
    if (this._hopSquares.length !== nCh) {
      this._hopSquares = new Array(nCh).fill(0);
    }

    // Process samples
    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < nCh; ch++) {
        const x = input[ch][i];
        // Pass-through audio
        if (output[ch]) output[ch][i] = x;

        // K-weighting: shelf → highpass
        const afterShelf = this._biquad(this._shelf, this._states[ch].shelf, x);
        const afterHP = this._biquad(this._hp, this._states[ch].hp, afterShelf);

        // Accumulate K-weighted squared sample for this hop
        this._hopSquares[ch] += afterHP * afterHP;

        // True-peak tracking (sample-domain, not oversampled)
        const absVal = Math.abs(x);
        if (absVal > this._truePeak) this._truePeak = absVal;
      }
      this._hopCount++;

      // End of 100ms hop
      if (this._hopCount >= this._hopSamples) {
        const ms = new Array(nCh);
        for (let ch = 0; ch < nCh; ch++) {
          ms[ch] = this._hopSquares[ch] / this._hopCount;
          this._hopSquares[ch] = 0;
        }
        this._hopCount = 0;

        // Store in ring buffer
        if (this._ring.length < this._ringSize) {
          this._ring.push(ms);
        } else {
          this._ring[this._ringIdx] = ms;
        }
        this._ringIdx = (this._ringIdx + 1) % this._ringSize;
        if (this._ringFilled < this._ringSize) this._ringFilled++;

        // Compute momentary (last 4 hops = 400ms) and short-term (all hops up to 3s)
        const momentary = this._computeLUFS(Math.min(4, this._ringFilled), nCh);
        const shortTerm = this._computeLUFS(this._ringFilled, nCh);

        const peakDB = this._truePeak > 0 ? 20 * Math.log10(this._truePeak) : -Infinity;
        this._truePeak = 0;

        this.port.postMessage({
          momentary,
          shortTerm,
          peakDB
        });
      }
    }

    return true;
  }

  // Compute ungated LUFS from the last `nHops` entries in the ring buffer.
  // For a real-time output meter, ungated momentary/short-term is standard
  // (gating is only required for integrated programme loudness).
  _computeLUFS(nHops, nCh) {
    if (nHops === 0) return -Infinity;

    let sum = 0;
    for (let i = 0; i < nHops; i++) {
      const idx = ((this._ringIdx - 1 - i) % this._ringSize + this._ringSize) % this._ringSize;
      const ms = this._ring[idx];
      for (let ch = 0; ch < nCh; ch++) {
        // Channel weight: 1.0 for L/R (front channels)
        sum += ms[ch];
      }
    }
    const meanSquare = sum / nHops;
    if (meanSquare <= 0) return -Infinity;
    return -0.691 + 10 * Math.log10(meanSquare);
  }
}

registerProcessor('meter-processor', MeterProcessor);
