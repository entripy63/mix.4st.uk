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
  try {
    // Try restoring live stream first (handles both mix and live restoration)
    const liveRestored = await restoreLivePlayer();
    if (liveRestored) {
      // Clear player.html-specific DOM after playLive() call
      loadPeaks(null);
      document.getElementById('coverArt').innerHTML = '';
      document.getElementById('trackList').innerHTML = '';
      // Restore browser mode and return - don't restore mix
      const savedBrowserMode = storage.get('browserMode', 'live');
      browserModes.switch(savedBrowserMode);
      return;
    }

    let savedPath = storage.get('currentMixPath');
    if (savedPath) {
      // Migrate old DJ paths (e.g., "aboo/mixname" -> "mixes/aboo/mixname")
      if (!savedPath.startsWith('mixes/')) {
        const parts = savedPath.split('/');
        if (parts[0] === 'moreDJs') {
          savedPath = 'mixes/' + savedPath;
        } else {
          savedPath = 'mixes/' + savedPath;
        }
        storage.set('currentMixPath', savedPath);
      }
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
        mix = { djPath, file, audioFile: `${file}.mp3`, peaksFile: `${file}.peaks.json`, name: file };
      }
      const details = await fetchMixDetails(mix);
      if (details.audioSrc) {
        state.isRestoring = true;
        load(details.audioSrc);
        const savedTime = storage.getNum('playerTime', 0);
        const wasPlaying = storage.getBool('wasPlaying', false);

        // Set currentTime after metadata is loaded
        const handleMetadataLoaded = () => {
          aud.currentTime = savedTime;
          aud.removeEventListener('loadedmetadata', handleMetadataLoaded);
          state.isRestoring = false;

          if (wasPlaying) {
            aud.play().catch(() => { });
          }
        };
        aud.addEventListener('loadedmetadata', handleMetadataLoaded, { once: true });

        // Fallback in case loadedmetadata never fires
        setTimeout(() => {
          if (state.isRestoring) {
            state.isRestoring = false;
            if (wasPlaying && aud.paused) {
              aud.play().catch(() => { });
            }
          }
        }, 2000);

        state.currentMix = mix;
        state.currentDownloadLinks = details.downloadLinks || [];
        state.currentCoverSrc = details.coverSrc;
        displayTrackList(mix, details.trackListTable, details.downloadLinks, details.coverSrc);
        loadPeaks(details.peaks);
        requestAnimationFrame(resizeWaveformCanvas);
      }
    }
  } catch (e) {
    console.error('Error restoring player:', e);
  }

  // Build DJ dropdown dynamically
  await buildDJDropdown();

  // Restore browser mode for non-live restoration
  const savedBrowserMode = storage.get('browserMode', 'dj');
  browserModes.switch(savedBrowserMode);

  // Restore mode-specific state (defer to ensure DOM is updated)
  setTimeout(async () => {
    if (savedBrowserMode === 'dj') {
      const savedDJ = storage.get('currentDJ');
      if (savedDJ) {
        await setCurrentDJ(savedDJ);
        const savedFilter = storage.get('currentFilter', '');
        if (savedFilter) {
          applyFilter(savedFilter);
        }
      }
    } else if (savedBrowserMode === 'all') {
      const savedDJ = storage.get('currentDJ');
      if (savedDJ) {
        const djSelect = document.getElementById('djSelect');
        if (djSelect) {
          djSelect.value = savedDJ;
        }
        // Load mixes for the selected DJ without DJ-mode-specific UI updates
        state.currentDJ = savedDJ;
        state.currentMixes = await fetchDJMixes(savedDJ);
        displayMixList(state.currentMixes);
      }
    } else if (savedBrowserMode === 'search') {
      const savedQuery = storage.get('lastSearchQuery', '');
      if (savedQuery) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.value = savedQuery;
          // Wait for search index to be loaded
          if (searchIndex && searchIndex.data) {
            const results = searchIndex.search(savedQuery);
            displaySearchResults(results, savedQuery);
          }
        }
      }
    }
  }, 100);
})();
