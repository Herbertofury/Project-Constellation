(() => {
  'use strict';
  const DEFAULTS = Object.freeze({ enabled: true, responsiveScrolling: true, adaptiveMotionRelief: false, pressureWindowMs: 5000, highPressureLongTaskMs: 350, highPressureLongTaskCount: 5, recoveryQuietMs: 3500 });
  class PressureWindow {
    constructor(settings = {}) { this.settings = { ...DEFAULTS, ...settings }; this.samples = []; this.lastLongTaskAt = 0; this.state = 'normal'; }
    configure(settings = {}) { this.settings = { ...this.settings, ...settings }; this.prune(Date.now()); return this.snapshot(Date.now()); }
    addLongTask(duration, now = Date.now()) { const ms = Number.isFinite(duration) ? Math.max(0, duration) : 0; this.samples.push({ at: now, duration: ms }); this.lastLongTaskAt = now; this.prune(now); this.recompute(now); return this.snapshot(now); }
    tick(now = Date.now()) { this.prune(now); this.recompute(now); return this.snapshot(now); }
    reset() { this.samples = []; this.lastLongTaskAt = 0; this.state = 'normal'; return this.snapshot(Date.now()); }
    prune(now) { const cutoff = now - this.settings.pressureWindowMs; this.samples = this.samples.filter((sample) => sample.at >= cutoff); }
    recompute(now) { const totalMs = this.samples.reduce((sum, sample) => sum + sample.duration, 0); const high = totalMs >= this.settings.highPressureLongTaskMs || this.samples.length >= this.settings.highPressureLongTaskCount; if (high) { this.state = 'high'; return; } if (this.state === 'high') { const quietFor = this.lastLongTaskAt ? now - this.lastLongTaskAt : Infinity; if (quietFor >= this.settings.recoveryQuietMs) this.state = 'normal'; } }
    snapshot(now = Date.now()) { this.prune(now); return { pressure: this.state, windowLongTasks: this.samples.length, windowLongTaskMs: Math.round(this.samples.reduce((sum, sample) => sum + sample.duration, 0)) }; }
  }
  const api = Object.freeze({ DEFAULTS, PressureWindow });
  globalThis.ProjectConstellationPerformance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
