// Bounded playback flight recorder. Never records audio, metadata or raw errors.
// Load after core.js and before the player so faults are captured before recovery.
const playbackDiagnostics = (() => {
  const KEY = 'playbackDiagnostic';
  const MAX_BYTES = 131072;
  const MAX_AGE = 24 * 60 * 60 * 1000;
  const events = [];
  const actions = [];
  const transitions = [];
  const requests = new Map();
  let observedPlayer = null;
  let playerSequence = 0;
  let incidents = [];
  let startups = [];
  let generation = 0;
  let lastTick = 0;
  let lastTime = null;
  let progressAt = 0;
  let silentAt = null;

  function safeUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return { address: url.protocol };
      const result = { address: (url.origin + url.pathname).slice(0, 300) };
      // Preserve the useful upstream address, not the proxy's other parameters.
      const upstream = url.searchParams.get('url');
      if (upstream) {
        const inner = new URL(upstream, location.href);
        if (['http:', 'https:'].includes(inner.protocol)) {
          result.upstream = (inner.origin + inner.pathname).slice(0, 300);
        }
      }
      return result;
    } catch { return null; }
  }

  function snapshot() {
    const buffered = [];
    const ranges = aud.buffered;
    for (let i = Math.max(0, ranges.length - 3); i < ranges.length; i++) {
      buffered.push([ranges.start(i), ranges.end(i)]);
    }
    let inputRms = null;
    if (analyserNode?.getFloatTimeDomainData && audioCtx?.state === 'running') {
      const samples = new Float32Array(analyserNode.fftSize);
      analyserNode.getFloatTimeDomainData(samples);
      inputRms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    }
    return {
      mode: state.isStream ? 'stream' : 'mix',
      requested: safeUrl(state.isStream ? state.streamUrl : aud.src),
      playlist: state.isStream ? safeUrl(state.streamM3u) : null,
      media: safeUrl(aud.currentSrc),
      decoderStream: Boolean(aud.srcObject),
      currentTime: aud.currentTime,
      duration: Number.isFinite(aud.duration) ? aud.duration : null,
      paused: aud.paused,
      userPaused: state.isStream ? Boolean(state.userPausedStream) : aud.paused,
      ended: aud.ended,
      seeking: aud.seeking,
      readyState: aud.readyState,
      networkState: aud.networkState,
      errorCode: aud.error?.code || null,
      libraryState: observedPlayer?.state || null,
      playbackMethod: observedPlayer?.playbackMethod || null,
      buffered,
      volume: volume.get(),
      muted: volume.isMuted(),
      elementMuted: aud.muted,
      elementVolume: aud.volume,
      gain: gainNode?.gain.value ?? null,
      declickGain: declickNode?.gain.value ?? null,
      contextState: audioCtx?.state || null,
      contextTime: audioCtx?.currentTime ?? null,
      inputRms,
      hidden: document.hidden,
      online: navigator.onLine
    };
  }

  function record(type) {
    const at = new Date().toISOString();
    const isSeek = type === 'seeking' || type === 'seeked';
    const previous = events[events.length - 1];
    if (isSeek && previous?.type === 'seek' && previous.attempt === generation &&
        Date.now() - Date.parse(previous.at) < 5000) {
      previous.count++;
      previous.lastAt = at;
      return;
    }
    const event = { at, type: isSeek ? 'seek' : type, attempt: generation, playback: snapshot() };
    if (isSeek) event.count = 1;
    events.push(event);
    if (events.length > 60) events.shift();
    if (['play', 'playing', 'pause', 'waiting', 'stalled', 'ended', 'emptied', 'loadedmetadata', 'error'].includes(type)) {
      transition(`media:${type}`);
    }
    if (type === 'source-selected' || type.startsWith('control:')) {
      actions.push({ at, type, attempt: generation, source: event.playback.requested });
      // Keep the beginning of the recovery sequence as well as its latest steps.
      if (actions.length > 24) actions.splice(1, 1);
    }
    // Save actions as they happen rather than relying on pagehide during reload.
    // Periodic samples stay in memory until a fault.
    if (type !== 'sample') persist();
  }

  function transition(type, details = {}) {
    transitions.push({
      at: new Date().toISOString(), type, attempt: generation,
      ...details, playback: snapshot()
    });
    if (transitions.length > 48) transitions.shift();
    persist();
  }

  function watchPlayer(player, attempt) {
    observedPlayer = player;
    const playerId = ++playerSequence;
    // Observe public events, including playbackerror which can bypass onError
    // during retries. Never call playback methods or retain raw event messages.
    ['loading', 'playing', 'retrying', 'stopping', 'stopped', 'retry', 'retrytimeout',
      'streamstart', 'streamend', 'play', 'stop', 'error', 'playbackerror', 'warn'].forEach(type => {
      player.addEventListener(type, event => {
        const details = { attempt, playerId, libraryState: player.state, playbackMethod: player.playbackMethod };
        if (type === 'warn') {
          const messages = Array.isArray(event.detail) ? event.detail : [];
          if (messages.some(message => /^Synchronized old and new request\.$/.test(message))) details.sync = 'frames';
          const pcm = messages.find(message => /^Synchronized old and new request with \d+(\.\d+)?% confidence\.$/.test(message));
          if (pcm) { details.sync = 'pcm'; details.confidence = Number(pcm.match(/\d+(\.\d+)?/)[0]); }
          if (messages.some(message => message === 'Unable to sync old and new request.')) details.sync = 'failed';
        }
        // State events fire before the library's state getter is updated;
        // their event type identifies the target state, not playback.libraryState.
        transition(`library:${type}`, details);
      });
    });
  }

  function milestone(phase, { attempt = generation, httpStatus, mediaType, bufferSeconds } = {}) {
    if (['fetch-start', 'fetch-error', 'fetch-headers', 'fetch-first-byte'].includes(phase)) {
      transition(phase, { attempt, httpStatus });
    }
    const startup = startups.find(item => item.attempt === attempt);
    // Retain the first occurrence, not one entry per audio chunk or retry.
    if (!startup || startup.clock === null || startup.milestones.some(item => item.phase === phase)) return;
    const item = {
      phase, at: new Date().toISOString(),
      elapsedMs: Math.max(0, Math.round(performance.now() - startup.clock))
    };
    if (httpStatus !== undefined) item.httpStatus = httpStatus;
    if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mediaType)) item.mediaType = mediaType;
    if (Number.isFinite(bufferSeconds)) item.bufferSeconds = Math.round(bufferSeconds * 1000) / 1000;
    startup.milestones.push(item);
    persist();
    window.dispatchEvent(new CustomEvent('playbackdiagnosticschange'));
  }

  function report(attempt = null) {
    const previousCount = incidents.length;
    incidents = incidents.filter(item => Date.now() - Date.parse(item.firstError?.at || item.at) < MAX_AGE);
    if (previousCount && !incidents.length) clear();
    while (actions.length && Date.now() - Date.parse(actions[0].at) >= MAX_AGE) actions.shift();
    startups = startups.filter(item => Date.now() - Date.parse(item.at) < MAX_AGE);
    const saved = incidents.map(item => ({
      ...item, events: item.events.slice(), errors: item.errors.slice(), recovery: (item.recovery || []).slice()
    }));
    const result = {
      schemaVersion: 1,
      attempt: generation,
      generatedAt: new Date().toISOString(),
      page: location.origin + location.pathname,
      userAgent: navigator.userAgent.slice(0, 500),
      assets: [...document.scripts].filter(script => /\/(core|player|stream-player|playback-diagnostics)\.js$/.test(new URL(script.src, location.href).pathname))
        .map(script => {
          const url = new URL(script.src, location.href);
          return { path: url.pathname.slice(0, 300), version: url.searchParams.get('v')?.slice(0, 100) || null };
        }),
      current: snapshot(),
      // Retain the existing primary field for older report consumers.
      incident: saved.find(item => item.attempt === attempt) || saved[saved.length - 1] || null,
      incidents: saved,
      actions: actions.slice(),
      transitions: transitions.filter(item => Date.now() - Date.parse(item.at) < MAX_AGE),
      startups: startups.map(({ clock, ...item }) => ({ ...item, milestones: item.milestones.slice() })),
      playerResources: performance.getEntriesByType('resource')
        .filter(item => {
          const url = new URL(item.name, location.href);
          return url.origin === location.origin && /^\/vendor\/icecast-metadata-player-[\w.-]+\.js$/.test(url.pathname);
        }).slice(-12).map(item => ({
          path: new URL(item.name, location.href).pathname,
          at: new Date(performance.timeOrigin + item.startTime).toISOString(),
          durationMs: Math.round(item.duration), transferBytes: item.transferSize
        })),
      recent: events.filter(event => Date.now() - Date.parse(event.at) < MAX_AGE)
    };
    // Count UTF-8 bytes, not characters. Trim frozen event histories before the
    // recent timeline so an older fault cannot crowd out recovery evidence.
    while (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) {
      const longest = saved.reduce((a, b) => a.events.length > b.events.length ? a : b, saved[0]);
      if (longest?.events.length) longest.events.shift();
      else if (result.recent.length) result.recent.shift();
      else if (result.transitions.length > 8) result.transitions.shift();
      else if (saved.some(item => item.recovery.length > 8)) saved.find(item => item.recovery.length > 8).recovery.shift();
      else {
        if (result.actions.length > 2) result.actions.splice(1, 1);
        else if (saved.some(item => item.errors.length > 2)) saved.find(item => item.errors.length > 2).errors.splice(1, 1);
        else if (saved.some((item, index) => index > 0 && item !== result.incident)) {
          saved.splice(saved.findIndex((item, index) => index > 0 && item !== result.incident), 1);
        }
        else break;
      }
    }
    return result;
  }

  function persist() {
    if (!incidents.length) return;
    try {
      const data = report();
      if (data.incident) sessionStorage.setItem(KEY, JSON.stringify(data));
    } catch { /* optional storage */ }
  }

  function problem(reason, { category = null, priority = 1, persistent = false, source = null,
    attempt = generation, httpStatus = null, errorName = null } = {}) {
    const now = Date.now();
    const at = new Date().toISOString();
    const failure = {
      at, reason, category, httpStatus,
      errorName: errorName === null ? null : ['Error', 'TypeError', 'NotAllowedError', 'NotSupportedError',
        'AbortError', 'NetworkError', 'EncodingError', 'InvalidStateError', 'QuotaExceededError',
        'OperationError', 'SecurityError'].includes(errorName) ? errorName : 'OtherError'
    };
    let incident = incidents.find(item => item.attempt === attempt);
    if (!incident) {
      incident = {
        ...failure, priority, attempt,
        // A late callback may belong to the previous station, not current state.
        source: safeUrl(source),
        playback: snapshot(), events: JSON.parse(JSON.stringify(events.slice(-12))),
        recovery: transitions.filter(item => item.attempt === attempt).slice(-24),
        firstError: { ...failure, playback: snapshot() }, errors: []
      };
      incidents.push(incident);
      // An unrelated station must not overwrite the original failure.
      if (incidents.length > 6) incidents.splice(1, 1);
    } else if (priority > incident.priority) {
      Object.assign(incident, failure, {
        priority, playback: snapshot(),
        recovery: transitions.filter(item => item.attempt === attempt).slice(-24)
      });
    }
    incident.lastAt = at;
    const matching = incident.errors.find(item => item.reason === reason && item.category === category &&
      item.httpStatus === httpStatus && item.errorName === failure.errorName);
    if (matching) { matching.count++; matching.lastAt = at; }
    else {
      incident.errors.push({ ...failure, count: 1, lastAt: at });
      if (incident.errors.length > 8) incident.errors.splice(1, 1);
    }
    // Count repeated errors, but don't synchronously rewrite storage on every retry.
    if (!matching || now - Date.parse(incident.savedAt || incident.at) >= 60000) {
      incident.savedAt = at;
      persist();
      window.dispatchEvent(new CustomEvent('playbackdiagnosticschange'));
    }
    if (persistent) {
      window.dispatchEvent(new CustomEvent('playbackpersistentproblem', { detail: { reason, attempt } }));
    }
  }

  function watchStream(url, attempt) {
    try {
      requests.set(new URL(url, location.href).href, attempt);
      if (requests.size > 6) requests.delete(requests.keys().next().value);
    } catch { /* Diagnostics must not change how malformed playback URLs fail. */ }
  }

  function requestAttempt(input) {
    try {
      return requests.get(new URL(input instanceof Request ? input.url : input, location.href).href);
    } catch { return undefined; }
  }

  function resetProgress() {
    lastTime = null;
    progressAt = performance.now();
    silentAt = null;
  }

  function begin() {
    generation++;
    if (state.isStream) {
      startups.push({
        attempt: generation, at: new Date().toISOString(), clock: performance.now(),
        source: safeUrl(state.streamUrl), milestones: []
      });
      if (startups.length > 6) startups.splice(1, 1);
    }
    resetProgress();
    record('source-selected');
  }

  function clear() {
    incidents = [];
    startups = [];
    events.length = 0;
    actions.length = 0;
    transitions.length = 0;
    resetProgress();
    try { sessionStorage.removeItem(KEY); } catch { /* optional storage */ }
    window.dispatchEvent(new CustomEvent('playbackdiagnosticschange'));
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    if (saved?.schemaVersion === 1 && saved.incident &&
        Date.now() - Date.parse(saved.incident.at) >= 0 &&
        Date.now() - Date.parse(saved.incident.at) < MAX_AGE) {
      incidents = saved.incidents || [{ ...saved.incident, attempt: 0, errors: [] }];
      startups = (saved.startups || []).slice(-6).map(item => ({ ...item, clock: null }));
      generation = Math.max(saved.attempt || 0, ...incidents.map(item => item.attempt));
      actions.push(...(saved.actions || []));
      transitions.push(...(saved.transitions || []).slice(-48));
      playerSequence = Math.max(0, ...transitions.map(item => item.playerId || 0));
      // Keep actions taken after the fault when the page is reloaded.
      events.push(...saved.recent.slice(-60));
    } else sessionStorage.removeItem(KEY);
  } catch { /* A blocked or corrupt session store must not affect playback. */ }

  ['play', 'playing', 'pause', 'waiting', 'stalled', 'ended', 'emptied',
    'loadedmetadata', 'seeking', 'seeked', 'error'].forEach(type => {
    aud.addEventListener(type, () => {
      if (type === 'error') problem('media-error');
      record(type);
      // The stream library loops a silent startup clip, emitting constant seeks.
      if (type === 'seeking' && !state.isStream) resetProgress();
    }, true);
  });
  document.addEventListener('click', event => {
    const control = event.target.closest?.('#playPauseBtn, #muteBtn');
    if (control) record(`control:${control.id}`);
    else if (event.target.closest?.('#playHistory [title="Resume Now"]')) record('control:history-play');
    else if (event.target.closest?.('[onclick^="playLiveStream("]')) record('control:user-stream-play');
    else if (event.target.closest?.('[onclick^="playPresetStream("]')) record('control:preset-play');
  }, true);
  document.getElementById('volumeSlider').addEventListener('change', () => record('volume'));
  window.addEventListener('pagehide', persist);

  setInterval(() => {
    if (incidents.length && incidents.every(item => Date.now() - Date.parse(item.firstError?.at || item.at) >= MAX_AGE)) clear();
    const now = performance.now();
    const expected = state.isStream
      ? !state.userPausedStream && streamIsActive()
      : !aud.paused && !aud.ended;
    const intentionalSeek = aud.seeking && !state.isStream;
    if (!expected || intentionalSeek || now - lastTick > 15000) resetProgress();
    lastTick = now;
    if (!expected || intentionalSeek) return;
    record('sample');
    const sample = events[events.length - 1].playback;
    const placeholder = state.isStream && sample.media?.address === 'data:';
    const advanced = !placeholder && lastTime !== null && Math.abs(sample.currentTime - lastTime) > 0.05;
    if (lastTime === null || advanced) progressAt = now;
    lastTime = sample.currentTime;
    if (now - progressAt >= 30000) problem('stalled-playback', { priority: 2, persistent: true });
    // Silence is only a suspicion: never restart or interrupt playback for it.
    if (advanced && sample.inputRms !== null && sample.inputRms < 0.00001 &&
        sample.volume > 0 && !sample.muted) {
      if (silentAt === null) silentAt = now;
      if (now - silentAt >= 30000) problem('silent-audio', { priority: 2, persistent: true });
    } else silentAt = null;
  }, 5000);

  return { begin, problem, report, clear, milestone, watchStream, watchPlayer, requestAttempt, get attempt() { return generation; } };
})();
