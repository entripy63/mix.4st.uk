// stream-player.js - IcecastMetadataPlayer wrapper for stream playback
// Dependencies: core.js (aud, state), player.js (updatePlayPauseBtn, updateTimeDisplay)

// Wrap fetch so that live audio streams (no Content-Length) error on clean close
// instead of ending silently. This triggers IcecastMetadataPlayer's internal
// retry with seamless CRC32/PCM sync, surviving proxy timeouts (e.g. Cloud Run 60min).
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await _originalFetch.apply(this, args);
  const contentType = response.headers.get('Content-Type') || '';
  const ct = contentType.split(';')[0].trim().toLowerCase();
  // PLS/M3U playlists also use audio/* types, but their normal EOF must remain
  // readable by fetchPlaylist(), not become a synthetic stream failure.
  const isPlaylist = ct.includes('scpls') || ct.includes('mpegurl');
  let headers = response.headers;
  let body = response.body;
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
    if (!response.headers.get('Content-Length') && body) {
      body = body.pipeThrough(new TransformStream({
        flush() { throw new Error('network error'); },
      }));
    }
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
const mseRestarts = [];
const MSE_MAX_RESTARTS = 3;
const MSE_RESTART_WINDOW = 60000; // 1 minute

async function streamPlay(url, displayText) {
  await streamStop();

  // Enable ICY metadata support on the proxy
  const icyUrl = url.includes('?') ? url + '&icy=1' : url + '?icy=1';

  const startPlayer = () => {
    streamPlayer = new IcecastMetadataPlayer(icyUrl, {
      audioElement: aud,
      metadataTypes: ['icy'],
      bufferLength: 3,
      enableLogging: true,
      onMetadata: (metadata) => {
        document.dispatchEvent(new CustomEvent('streamMetadata', {
          detail: { metadata, displayText }
        }));
      },
      onPlay: () => { updatePlayPauseBtn(); updateTimeDisplay(); },
      onStop: () => { updatePlayPauseBtn(); updateTimeDisplay(); },
      onError: (message, error) => {
        try {
          // Network errors (fetch failures, aborts) are retried by the library internally
          const msg = String(message || '') + ' ' + String(error?.message || '');
          if (/network|fetch|abort/i.test(msg)) return;

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
