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

async function msePlayLive(url, displayText) {
  await mseStopLive();

  // Enable ICY metadata support on the proxy
  const icyUrl = url.includes('?') ? url + '&icy=1' : url + '?icy=1';

  icecastPlayer = new IcecastMetadataPlayer(icyUrl, {
    audioElement: aud,
    metadataTypes: ['icy'],
    bufferLength: 2,
    enableLogging: true,
    onMetadata: (metadata) => {
      document.dispatchEvent(new CustomEvent('liveMetadata', {
        detail: { metadata, displayText }
      }));
    },
    onPlay: () => { updatePlayPauseBtn(); updateTimeDisplay(); },
    onStop: () => { updatePlayPauseBtn(); updateTimeDisplay(); },
  });

  icecastPlayer.play();
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
