// loudness-protection.js — Auto-reduce volume when loudness exceeds threshold
// Dependencies: core.js (volume, storage, audioCtx, gainNode), meter.js (meterNode),
//               player.js (volumeSlider, updateMuteBtn, timedFades)
//
// This is NOT a limiter or compressor. It automates the volume slider downward
// when short-term LUFS exceeds a threshold — exactly as if the user reached for
// the knob. Recovery is left entirely to the user.
//
// Co-operation: if the user raises volume above the level it was at when the
// threshold was set, they are overriding the ceiling — we disable rather than
// fight them.

const loudnessProtection = {
  _enabled: storage.getBool('loudnessProtectEnabled'),
  _thresholdLufs: storage.getNum('loudnessProtectThreshold', -14),

  // Volume level (0–1 slider position) at the time the threshold was set
  _levelAtSet: storage.getNum('loudnessProtectLevelAtSet', 0.5),

  // Cooldown: don't reduce if user touched slider recently
  _userAdjustedAt: 0,
  _userCooldownMs: 3000,

  // Rate limit: after an auto-reduction, hold off before considering another
  _lastReduceAt: 0,
  _reduceHoldMs: 3000,

  // Minimum reduction to bother with (dB)
  _minReductionDb: 1,

  get enabled() { return this._enabled; },

  setEnabled(on) {
    this._enabled = on;
    storage.set('loudnessProtectEnabled', on);
    if (on) {
      this._levelAtSet = volume.get();
      storage.set('loudnessProtectLevelAtSet', this._levelAtSet);
      // Reset threshold from current listening level if we have a reading
      if (isFinite(meterShortTerm) && meterShortTerm > -60) {
        this._thresholdLufs = Math.round(meterShortTerm);
        storage.set('loudnessProtectThreshold', this._thresholdLufs);
        if (typeof updateLoudnessThresholdDisplay === 'function') updateLoudnessThresholdDisplay();
        showToast(`Volume Ceiling set to ${this._thresholdLufs} LUFS`);
      }
    }
    volumeSlider.classList.toggle('ceiling-active', on);
    this._updateSliderTitle();
    ensureMeterAnalysis();
  },

  get thresholdLufs() { return this._thresholdLufs; },

  setThreshold(lufs) {
    this._thresholdLufs = lufs;
    this._levelAtSet = volume.get();
    storage.set('loudnessProtectThreshold', lufs);
    storage.set('loudnessProtectLevelAtSet', this._levelAtSet);
    this._updateSliderTitle();
  },

  // Called by volumeSlider 'input' handler to note user interaction
  notifyUserAdjust() {
    this._userAdjustedAt = Date.now();
  },

  // Called on each meter update (every ~100ms)
  onMeterUpdate(shortTermLufs) {
    if (!this._enabled) return;
    if (!isFinite(shortTermLufs)) return;

    const now = Date.now();

    // Don't act if user recently adjusted volume
    if (now - this._userAdjustedAt < this._userCooldownMs) return;

    // Don't act during timed fades
    if (typeof timedFades !== 'undefined' &&
        (timedFades._intervals.fadeout || timedFades._intervals.fadein)) return;

    // Don't act if we recently made a reduction
    if (now - this._lastReduceAt < this._reduceHoldMs) return;

    // How many dB over the threshold?
    const overDb = shortTermLufs - this._thresholdLufs;
    if (overDb < this._minReductionDb) return;

    // If the user has raised volume above where it was when the threshold was
    // set, they are overriding our ceiling — disable rather than fight them
    if (volume.get() > this._levelAtSet + 0.005) {
      this.setEnabled(false);
      const cb = document.getElementById('loudnessProtectCheckbox');
      if (cb) cb.checked = false;
      document.getElementById('loudnessThresholdRow').style.display = 'none';
      return;
    }

    // Reduce volume via the existing volume control
    // Work in the gain domain: current gain → reduce by overDb → find new slider position
    const currentLevel = volume.get();
    if (currentLevel <= 0) return;

    const currentGain = volume._toGain(currentLevel);
    if (currentGain <= 0) return;

    const reductionLinear = Math.pow(10, -overDb / 20);
    const targetGain = currentGain * reductionLinear;

    // Invert the taper to find the new slider position
    const newLevel = this._fromGain(targetGain);

    volume.set(newLevel);
    volumeSlider.value = volume.get() * 100;
    updateMuteBtn();

    this._lastReduceAt = now;
  },

  _updateSliderTitle() {
    volumeSlider.title = this._enabled
      ? `Volume (Ceiling ${this._thresholdLufs} LUFS)`
      : 'Volume';
  },

  // Inverse of volume._toGain: gain → linear slider position (0–1)
  // _toGain: x<0.5 → x*0.7, x>=0.5 → 0.35+(x-0.5)*1.3
  _fromGain(g) {
    if (g <= 0) return 0;
    if (g < 0.35) return g / 0.7;
    const level = 0.5 + (g - 0.35) / 1.3;
    return Math.min(1, level);
  }
};

// Apply slider indicator and title on load if already enabled
if (loudnessProtection.enabled) {
  volumeSlider.classList.add('ceiling-active');
}
loudnessProtection._updateSliderTitle();
