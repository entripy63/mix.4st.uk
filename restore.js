// restore.js - Page restoration and local file upload

// Handle local file selection
document.getElementById('fileInput').addEventListener('change', async function (e) {
  const files = Array.from(e.target.files);
  let rejected = 0;

  for (const file of files) {
    const canPlay = await checkAudioSupport(file);
    if (canPlay === '') {
      rejected++;
      continue;
    }
    if (canPlay === 'maybe') {
      showToast(`Warning: ${file.name} may not play correctly`);
    }
    const audioSrc = URL.createObjectURL(file);
    state.queue.push({
      name: file.name.replace(/\.[^/.]+$/, ''),
      audioSrc: audioSrc,
      isLocal: true,
      queueId: generateQueueId()
    });
  }

  if (rejected > 0) {
    showToast(`${rejected} file(s) not supported by this browser`);
  }

  saveQueue();
  displayQueue();
  e.target.value = '';
});

// Page restoration
(async function restorePlayer() {
  // Log session start with whatever is currently loaded
  const restoredStream = storage.get('streamDisplayText');
  const restoredMix = storage.get('currentMixPath');
  beacon('session-start', restoredStream || restoredMix || '', 'restore');

  try {
    // Try restoring live stream first (handles both mix and live restoration)
    const liveRestored = await restoreStreamPlayer();
    if (liveRestored) {
      // Clear player.html-specific DOM after playStream() call
      loadPeaks(null);
      document.getElementById('coverArt').innerHTML = '';
      document.getElementById('trackList').innerHTML = '';
      document.getElementById('actionBar').innerHTML = '';
      // Restore middle column tab and browser mode BEFORE probing starts
      await buildDJDropdown();
      const savedMiddleTab = storage.get('middleTab', 'queue');
      switchMiddleTab(savedMiddleTab);
      const savedBrowserMode = storage.get('browserMode', 'live');
      browserModes.switch(savedBrowserMode);
      // Now start incremental stream probing (fire-and-forget so streams appear one by one)
      await loadDefaultStreamsOnFirstRun();
      const config = { shouldRedisplayAfterProbe: shouldRedisplayStreams };
      initLiveStreams(config).catch(e => console.error('Failed to initialize live streams:', e));
      // Repair Play History entries that reference a removed proxy (fire-and-forget)
      playHistory.refreshStaleProxies({ shouldRedisplayAfterProbe: shouldRedisplayHistory })
        .catch(e => console.error('Failed to refresh history proxies:', e));
      return;
    }

    let savedPath = storage.get('currentMixPath');
    if (savedPath) {
      savedPath = normalizeMixId(savedPath);
      storage.set('currentMixPath', savedPath);
      const parts = savedPath.split('/');
      const file = parts.pop();
      const djPath = parts.join('/');
      let mix;
      try {
        const mixes = await fetchDJMixes(djPath);
        mix = mixes.find(m => m.file === file);
      } catch (e) {
        // Manifest not available, build minimal object
      }
      if (!mix) {
        mix = { djPath, file, audioFile: `${file}.mp3`, name: file };
      }
      const details = await fetchMixDetails(mix);
      if (details.audioSrc) {
        const savedTime = storage.getNum('playerTime', 0);
        const wasPlaying = storage.getBool('wasPlaying', false);

        state.isRestoring = true;
        if (wasPlaying) {
          await playAt(details.audioSrc, savedTime);
        } else {
          await load(details.audioSrc);
          if (savedTime > 0) {
            if (aud.readyState < 1) {
              await new Promise(resolve => {
                aud.addEventListener('loadedmetadata', resolve, { once: true });
              });
            }
            aud.currentTime = savedTime;
          }
        }
        state.isRestoring = false;

        state.currentMix = mix;
        state.currentDownloadLinks = details.downloadLinks || [];
        state.currentCoverSrc = details.coverSrc;
        displayTrackList(mix, details.trackListTable, details.coverSrc);
        loadPeaks(details.peaks);
        requestAnimationFrame(resizeWaveformCanvas);
      }
    }
  } catch (e) {
    console.error('Error restoring player:', e);
  }

  // Build DJ dropdown dynamically
  await buildDJDropdown();

  // Restore middle column tab
  const savedMiddleTab = storage.get('middleTab', 'queue');
  switchMiddleTab(savedMiddleTab);

  // Restore browser mode for non-live restoration
  // browserModes.switch() handles all mode-specific state restoration
  const savedBrowserMode = storage.get('browserMode', 'dj');
  await browserModes.switch(savedBrowserMode);

  // Initialize live streams (proxy config already loading from livedata.js)
  // This runs after all scripts are loaded, so window.onStreamAdded is registered
  await loadProxyConfig();
  await loadDefaultStreamsOnFirstRun();
  const config = {
    shouldRedisplayAfterProbe: shouldRedisplayStreams
  };
  initLiveStreams(config).catch(e => console.error('Failed to initialize live streams:', e));
  // Repair Play History entries that reference a removed proxy (fire-and-forget)
  playHistory.refreshStaleProxies({ shouldRedisplayAfterProbe: shouldRedisplayHistory })
    .catch(e => console.error('Failed to refresh history proxies:', e));
})();
