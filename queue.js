// queue.js - Queue Management

function generateQueueId() {
  state.queueIdCounter++;
  storage.set('queueIdCounter', state.queueIdCounter);
  return state.queueIdCounter;
}

// Ensure existing queue items have IDs
state.queue.forEach(item => {
  if (!item.queueId) item.queueId = generateQueueId();
});

function saveQueue() {
  const persistableQueue = state.queue.filter(mix => !mix.isLocal);
  storage.set('queue', persistableQueue);
  // Recalculate index for persistable queue
  const currentMix = state.queue[state.currentQueueIndex];
  const persistedIndex = currentMix && !currentMix.isLocal 
    ? persistableQueue.findIndex(m => getMixId(m) === getMixId(currentMix))
    : -1;
  storage.set('currentQueueIndex', persistedIndex);
}

function displayQueue() {
  const queueDiv = document.getElementById('queue');
  const totalDuration = calculateTotalDuration();
  const durationText = totalDuration ? ` · ${totalDuration}` : '';
  const playState = aud.paused ? 'Stopped' : 'Playing';
  const queueInfo = state.queue.length > 0 
    ? `<div class="queue-info">${state.currentQueueIndex >= 0 ? `${playState} ${state.currentQueueIndex + 1} of ${state.queue.length}` : `${state.queue.length} mixes`}${durationText}</div>` 
    : '';
  const header = state.queue.length > 0 
    ? `<div class="queue-header">
        <button onclick="clearQueue()">Clear</button>
        <button onclick="shuffleQueue()">Shuffle</button>
        <button class="loop-btn${state.loopQueue ? ' active' : ''}" onclick="toggleLoop()">Loop</button>
        <button onclick="skipPrev()" title="Previous in queue">↑ Prev</button>
        <button onclick="skipNext()" title="Next in queue">↓ Next</button>
      </div>` 
    : '';
  queueDiv.innerHTML = queueInfo + header + state.queue.map((mix, i) => {
    const djName = mix.artist || getDJName(mix.htmlPath || mix.djPath);
    const djSuffix = mix.isLocal ? '' : ` - ${escapeHtml(djName)}`;
    return `<div class="queue-item${i === state.currentQueueIndex ? ' current' : ''}" 
          draggable="true" 
          ondragstart="onDragStart(event, ${i})" 
          ondragover="onDragOver(event)" 
          ondrop="onDrop(event, ${i})"
          ondragend="onDragEnd()">
        <span class="drag-handle">☰</span>
        <span class="mix-name" onclick="playFromQueue(${i})">${escapeHtml(mix.name)}${djSuffix}</span>
        ${i !== state.currentQueueIndex ? `<button class="remove-btn" onclick="removeFromQueue(${i})">✕</button>` : ''}
      </div>`;
  }).join('');
}

function updateQueueInfo() {
  const infoDiv = document.querySelector('.queue-info');
  if (!infoDiv || state.queue.length === 0) return;
  
  const totalDuration = calculateTotalDuration();
  const durationText = totalDuration ? ` · ${totalDuration}` : '';
  const playState = aud.paused ? 'Stopped' : 'Playing';
  
  infoDiv.textContent = state.currentQueueIndex >= 0 
    ? `${playState} ${state.currentQueueIndex + 1} of ${state.queue.length}${durationText}`
    : `${state.queue.length} mixes${durationText}`;
}

function onDragStart(e, index) {
  state.draggedIndex = index;
  e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
  e.preventDefault();
}

function onDrop(e, dropIndex) {
  e.preventDefault();
  if (state.draggedIndex === null || state.draggedIndex === dropIndex) return;
  
  const draggedItem = state.queue.splice(state.draggedIndex, 1)[0];
  state.queue.splice(dropIndex, 0, draggedItem);
  
  // Update currentQueueIndex to follow the currently playing item
  if (state.currentQueueIndex === state.draggedIndex) {
    state.currentQueueIndex = dropIndex;
  } else if (state.draggedIndex < state.currentQueueIndex && dropIndex >= state.currentQueueIndex) {
    state.currentQueueIndex--;
  } else if (state.draggedIndex > state.currentQueueIndex && dropIndex <= state.currentQueueIndex) {
    state.currentQueueIndex++;
  }
  
  saveQueue();
  displayQueue();
}

function onDragEnd() {
  state.draggedIndex = null;
  document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('dragging'));
}

function clearQueue() {
  state.queue = [];
  state.currentQueueIndex = -1;
  saveQueue();
  displayQueue();
}

function shuffleQueue() {
  const currentMix = state.currentQueueIndex >= 0 ? state.queue[state.currentQueueIndex] : null;
  for (let i = state.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  if (currentMix) {
    state.currentQueueIndex = state.queue.findIndex(m => m.queueId === currentMix.queueId);
  }
  saveQueue();
  displayQueue();
}

function toggleLoop() {
  state.loopQueue = !state.loopQueue;
  storage.set('loopQueue', state.loopQueue);
  displayQueue();
}

function calculateTotalDuration() {
  let totalMinutes = 0;
  let hasDuration = false;
  state.queue.forEach(mix => {
    if (mix.duration && mix.duration !== '0:00:00') {
      const parts = mix.duration.split(':');
      totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]);
      hasDuration = true;
    }
  });
  if (!hasDuration) return '';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}:00`;
}

function skipNext() {
  if (state.currentQueueIndex >= 0 && state.currentQueueIndex < state.queue.length - 1) {
    playFromQueue(state.currentQueueIndex + 1);
  }
}

function skipPrev() {
  if (state.currentQueueIndex > 0) {
    playFromQueue(state.currentQueueIndex - 1);
  }
}

async function playFromQueue(index) {
  state.currentQueueIndex = index;
  saveQueue();
  await playMix(state.queue[index]);
}

function removeFromQueue(index) {
  if (index !== state.currentQueueIndex) {
    state.queue.splice(index, 1);
    if (index < state.currentQueueIndex) state.currentQueueIndex--;
    saveQueue();
    displayQueue();
  }
}

function addToQueue(mixId) {
  const mix = state.currentMixes.find(m => getMixId(m) === mixId);
  if (mix) {
    state.queue.push({ ...mix, queueId: generateQueueId() });
    saveQueue();
    displayQueue();
  }
}

function addAllToQueue() {
  state.displayedMixes.forEach(mix => {
    state.queue.push({ ...mix, queueId: generateQueueId() });
  });
  saveQueue();
  displayQueue();
}

displayQueue();
