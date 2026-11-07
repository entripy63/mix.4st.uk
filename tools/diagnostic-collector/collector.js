// Paste this whole file into the player's DevTools console, then run:
// await diagnosticCollector.start({ hours: 12 })
// This is a local endurance-test tool, not a script loaded by the app.
(() => {
  if (window.diagnosticCollector) throw new Error('Collector already installed; use diagnosticCollector.status() or .stop().');
  let directory = null;
  let timer = null;
  let busy = false;
  let starting = false;
  let intervalMs = 0;
  let nextDue = null;
  let lastFile = null;
  let lastSavedAt = null;
  let error = null;
  const page = location.origin + location.pathname;

  async function saveNow() {
    if (!directory) throw new Error('Start the collector and choose a folder first.');
    if (busy) throw new Error('A diagnostic save is already in progress.');
    busy = true;
    try {
      if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Folder permission lost; stop and start the collector to grant it again.');
      }
      const report = playbackDiagnostics.report();
      if (report.page !== page || location.origin + location.pathname !== page) {
        throw new Error('Page identity changed; refusing to save under the wrong site.');
      }
      const at = new Date(report.generatedAt);
      if (!Number.isFinite(at.getTime())) throw new Error('Invalid diagnostic timestamp.');
      const pad = (value, length = 2) => String(value).padStart(length, '0');
      const date = `${pad(at.getFullYear() % 100)}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
      const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${pad(at.getMilliseconds(), 3)}`;
      const site = new URL(report.page).hostname.replace(/[^a-z0-9.-]/gi, '-');
      const filename = `MR-${date}-${time}-${site}.txt`;
      // Never overwrite an earlier capture, including one made by another tab.
      try {
        await directory.getFileHandle(filename);
        throw new Error(`File already exists: ${filename}`);
      } catch (cause) {
        if (cause.name !== 'NotFoundError') throw cause;
      }
      const file = await directory.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(JSON.stringify(report, null, 2) + '\n');
        await writable.close();
      } catch (cause) {
        await writable.abort().catch(() => {});
        throw cause;
      }
      lastFile = filename;
      lastSavedAt = report.generatedAt;
      nextDue = Date.now() + intervalMs;
      error = null;
      console.info('Diagnostic saved:', filename);
      return filename;
    } catch (cause) {
      error = cause.message;
      console.error('Diagnostic collector:', error);
      throw cause;
    } finally {
      busy = false;
    }
  }

  async function start({ hours = 12 } = {}) {
    if (starting || timer !== null || busy) throw new Error('Collector already starting or running.');
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('hours must be a positive number.');
    if (!window.showDirectoryPicker || typeof playbackDiagnostics === 'undefined' || typeof playbackDiagnostics.report !== 'function') {
      throw new Error('Requires a Chromium player page with diagnostics and directory access.');
    }
    starting = true;
    try {
      // Must happen before any await: the picker needs a user gesture.
      directory = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
      intervalMs = hours * 60 * 60 * 1000;
      await saveNow();
      // Check wall time so delayed background timers capture once on resumption,
      // rather than manufacturing reports for times when no capture was made.
      timer = setInterval(() => {
        if (!busy && Date.now() >= nextDue) saveNow().catch(() => {});
      }, 60000);
      return window.diagnosticCollector.status();
    } catch (cause) {
      directory = null;
      error = cause.message;
      throw cause;
    } finally {
      starting = false;
    }
  }

  window.diagnosticCollector = {
    start,
    saveNow,
    stop() {
      clearInterval(timer);
      timer = null;
      nextDue = null;
      // An already-started write is allowed to finish safely.
      if (!busy) directory = null;
    },
    status() {
      return { page, running: timer !== null, busy, lastFile, lastSavedAt,
        nextDue: timer !== null ? new Date(nextDue).toISOString() : null, error };
    }
  };
  console.info('Collector installed but not started. Run: await diagnosticCollector.start({ hours: 12 })');
})();
