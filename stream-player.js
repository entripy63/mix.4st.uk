// stream-player.js - IcecastMetadataPlayer wrapper for stream playback
// Dependencies: core.js (aud, state), player.js (updatePlayPauseBtn, updateTimeDisplay)

// Wrap fetch so that live audio streams (no Content-Length) error on clean close
// instead of ending silently. This triggers IcecastMetadataPlayer's internal
// retry with seamless CRC32/PCM sync, surviving proxy timeouts (e.g. Cloud Run 60min).
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
  const attempt = playbackDiagnostics.requestAttempt(args[0]);
  if (attempt !== undefined) playbackDiagnostics.milestone('fetch-start', { attempt });
  let response;
  try {
    response = await _originalFetch.apply(this, args);
  } catch (error) {
    if (attempt !== undefined) playbackDiagnostics.milestone('fetch-error', { attempt });
    throw error;
  }
  if (attempt !== undefined && response.status >= 400 && response.status <= 599) {
    playbackDiagnostics.problem('http-error', {
      attempt, category: 'http', httpStatus: response.status,
      source: args[0] instanceof Request ? args[0].url : String(args[0])
    });
  }
  const contentType = response.headers.get('Content-Type') || '';
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (attempt !== undefined) playbackDiagnostics.milestone('fetch-headers', {
    attempt, httpStatus: response.status, mediaType: ct
  });
  // PLS/M3U playlists also use audio/* types, but their normal EOF must remain
  // readable by fetchPlaylist(), not become a synthetic stream failure.
  const isPlaylist = ct.includes('scpls') || ct.includes('mpegurl');
  let headers = response.headers;
  let body = response.body;
  const failOnClose = ct.startsWith('audio/') && !isPlaylist && !response.headers.get('Content-Length');
  if (ct.startsWith('audio/') && !isPlaylist) {
    // Preserve quoted parameter values (including semicolons). Only charset is
    // irrelevant to binary audio; the player requires quoted codec values.
    const normalized = contentType.match(/(?:[^;"]|"(?:\\.|[^"\\])*")+/g)
      .filter(part => !/^\s*charset\s*=/i.test(part))
      .map(part => part.replace(/^\s*codecs\s*=\s*(.+?)\s*$/i,
        (_, value) => ` codecs=${value.startsWith('"') ? value : `"${value}"`}`))
      .join(';');
    if (normalized !== contentType) {
      headers = new Headers(response.headers);
      headers.set('Content-Type', normalized);
    }
  }
  if (body && (failOnClose || attempt !== undefined)) {
    let firstByte = true;
    body = body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        if (firstByte && chunk.byteLength) {
          firstByte = false;
          if (attempt !== undefined) playbackDiagnostics.milestone('fetch-first-byte', { attempt, httpStatus: response.status });
        }
        controller.enqueue(chunk);
      },
      // Finite responses and playlists must still finish normally.
      flush() { if (failOnClose) throw new Error('network error'); },
    }));
  }
  if (headers !== response.headers || body !== response.body) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
};

let streamPlayer = null;
let streamPageUnloading = false;
// Navigation closes the input too; that is not a playback failure to recover from.
window.addEventListener('beforeunload', () => { streamPageUnloading = true; });
window.addEventListener('pageshow', () => { streamPageUnloading = false; });
const mseRestarts = [];
const MSE_MAX_RESTARTS = 3;
const MSE_RESTART_WINDOW = 60000; // 1 minute

async function streamPlay(url, displayText) {
  const attempt = playbackDiagnostics.attempt;
  playbackDiagnostics.milestone('stop-previous-start', { attempt });
  await streamStop();
  playbackDiagnostics.milestone('stop-previous-end', { attempt });

  // Enable ICY metadata support on the proxy
  const icyUrl = url.includes('?') ? url + '&icy=1' : url + '?icy=1';
  playbackDiagnostics.watchStream(icyUrl, attempt);

  const startPlayer = () => {
    if (streamPageUnloading) return;
    playbackDiagnostics.milestone('player-start', { attempt });
    streamPlayer = new IcecastMetadataPlayer(icyUrl, {
      audioElement: aud,
      metadataTypes: ['icy'],
      bufferLength: 3,
      enableLogging: true,
      onLoad: () => playbackDiagnostics.milestone('library-load', { attempt }),
      onStreamStart: () => playbackDiagnostics.milestone('stream-start', { attempt }),
      onStream: () => playbackDiagnostics.milestone('stream-audio', { attempt }),
      onBuffer: bufferSeconds => playbackDiagnostics.milestone('buffering', { attempt, bufferSeconds }),
      onRetry: () => playbackDiagnostics.milestone('retry', { attempt }),
      onMetadata: (metadata) => {
        document.dispatchEvent(new CustomEvent('streamMetadata', {
          detail: { metadata, displayText }
        }));
      },
      onPlay: () => {
        playbackDiagnostics.milestone('playback-start', { attempt });
        updatePlayPauseBtn(); updateTimeDisplay();
      },
      onStop: () => { updatePlayPauseBtn(); updateTimeDisplay(); },
      onError: (message, error) => {
        if (streamPageUnloading) return;
        try {
          // Network errors (fetch failures, aborts) are retried by the library internally
          const msg = String(message || '') + ' ' + String(error?.message || '');
          const isNetworkError = /network|fetch|abort/i.test(msg);
          playbackDiagnostics.problem('stream-error', {
            category: isNetworkError ? 'network' : error?.name === 'NotAllowedError' ? 'autoplay' : 'decoder',
            priority: isNetworkError ? 0 : 1,
            attempt, errorName: error?.name || null,
            source: url
          });
          if (isNetworkError) return;

          if (error?.name === 'NotAllowedError') {
            // Browser blocked autoplay — stop the player and reset UI to paused
            streamStop().then(() => {
              state.userPausedStream = true;
              updatePlayPauseBtn();
              updateTimeDisplay();
            });
            return;
          }
          // Non-network errors (e.g. MSE internal TypeError) — restart the stream
          const now = Date.now();
          mseRestarts.push(now);
          // Trim to recent window
          while (mseRestarts.length && mseRestarts[0] < now - MSE_RESTART_WINDOW) mseRestarts.shift();
          if (mseRestarts.length > MSE_MAX_RESTARTS) {
            playbackDiagnostics.problem('restart-limit', { priority: 2, persistent: true, source: url, attempt });
            console.error(`streamPlay: ${MSE_MAX_RESTARTS} restarts in ${MSE_RESTART_WINDOW / 1000}s, giving up:`, message, error);
            streamStop().then(() => {
              state.userPausedStream = true;
              updatePlayPauseBtn();
              updateTimeDisplay();
            });
            return;
          }
          console.warn('streamPlay: non-network error, restarting stream:', message, error);
          if (streamPlayer) {
            streamStop().then(() => startPlayer());
          }
        } catch (handlerError) {
          console.error('streamPlay: onError handler failed:', handlerError);
        }
      },
    });

    playbackDiagnostics.watchPlayer?.(streamPlayer, attempt);
    streamPlayer.play();
  };

  startPlayer();
}

async function streamStop() {
  if (streamPlayer) {
    try { await streamPlayer.stop(); } catch (_) { /* abort expected */ }
    streamPlayer.detachAudioElement();
    streamPlayer = null;
  }
}

function streamIsActive() {
  return streamPlayer !== null;
}
