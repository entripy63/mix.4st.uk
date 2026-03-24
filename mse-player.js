// mse-player.js - IcecastMetadataPlayer wrapper for live stream playback
// Dependencies: core.js (aud, state), player.js (updatePlayPauseBtn, updateTimeDisplay)

// Wrap fetch so that live audio streams (no Content-Length) error on clean close
// instead of ending silently. This triggers IcecastMetadataPlayer's internal
// retry with seamless CRC32/PCM sync, surviving proxy timeouts (e.g. Cloud Run 60min).
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await _originalFetch.apply(this, args);
  const ct = response.headers.get('Content-Type') || '';
  if (!response.headers.get('Content-Length') && ct.startsWith('audio/') && response.body) {
    const body = response.body.pipeThrough(new TransformStream({
      flush() { throw new Error('network error'); },
    }));
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
};

let icecastPlayer = null;
const mseRestarts = [];
const MSE_MAX_RESTARTS = 3;
const MSE_RESTART_WINDOW = 60000; // 1 minute

async function msePlayLive(url, displayText) {
  await mseStopLive();

  // Enable ICY metadata support on the proxy
  const icyUrl = url.includes('?') ? url + '&icy=1' : url + '?icy=1';

  const startPlayer = () => {
    icecastPlayer = new IcecastMetadataPlayer(icyUrl, {
      audioElement: aud,
      metadataTypes: ['icy'],
      bufferLength: 3,
      enableLogging: true,
      onMetadata: (metadata) => {
        document.dispatchEvent(new CustomEvent('liveMetadata', {
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
            mseStopLive().then(() => {
              state.userPausedLive = true;
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
            console.error(`msePlayLive: ${MSE_MAX_RESTARTS} restarts in ${MSE_RESTART_WINDOW / 1000}s, giving up:`, message, error);
            mseStopLive().then(() => {
              state.userPausedLive = true;
              updatePlayPauseBtn();
              updateTimeDisplay();
            });
            return;
          }
          console.warn('msePlayLive: non-network error, restarting stream:', message, error);
          if (icecastPlayer) {
            try { icecastPlayer.detachAudioElement(); } catch (_) { /* detach may fail during error state */ }
            icecastPlayer = null;
            startPlayer();
          }
        } catch (handlerError) {
          console.error('msePlayLive: onError handler failed:', handlerError);
        }
      },
    });

    icecastPlayer.play();
  };

  startPlayer();
}

async function mseStopLive() {
  if (icecastPlayer) {
    try { await icecastPlayer.stop(); } catch (_) { /* abort expected */ }
    icecastPlayer.detachAudioElement();
    icecastPlayer = null;
  }
}

function mseIsActive() {
  return icecastPlayer !== null;
}
