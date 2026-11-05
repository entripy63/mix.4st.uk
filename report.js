// report.js - Issue reporting modal
// Dependencies: ping.js (beaconNick)

let reportDiagnosticData = null;
let automaticReportAttemptAt = storage.getNum('automaticPlaybackReportAt', 0);
// Deliberately memory-only: neither an IP fingerprint nor a saved browser ID.
let automaticReportSessionId = null;

function showReport() {
  window.reportModalOpenedAt = Date.now();
  setReportStatus('', '');
  document.getElementById('reportIncludeDiagnostics').checked = false;
  document.getElementById('autoPlaybackReports').checked = storage.getBool('autoPlaybackReports', true);
  document.getElementById('diagnosticsCopyStatus').textContent = '';
  refreshPlaybackDiagnostics();
  document.getElementById('reportModal').style.display = 'flex';
  document.getElementById('reportMessage')?.focus();
}

function hideReport() {
  document.getElementById('reportModal').style.display = 'none';
}

document.getElementById('reportModal')?.addEventListener('click', function(e) {
  if (e.target === this) hideReport();
});

function setReportStatus(msg, kind) {
  const el = document.getElementById('reportStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'report-status' + (kind ? ' ' + kind : '');
}

function refreshPlaybackDiagnostics() {
  reportDiagnosticData = playbackDiagnostics.report();
  const incident = reportDiagnosticData.incident;
  const count = reportDiagnosticData.incidents.length;
  document.getElementById('diagnosticsSummary').textContent = incident
    ? `${count === 1 ? 'Saved problem' : `${count} saved problems; latest`}: ${incident.reason.replaceAll('-', ' ')} at ${new Date(incident.at).toLocaleString()}.`
    : 'No saved playback problem. You can still copy the current playback state.';
  document.getElementById('diagnosticsText').value = JSON.stringify(reportDiagnosticData, null, 2);
}

window.addEventListener('playbackdiagnosticschange', refreshPlaybackDiagnostics);

async function copyPlaybackDiagnostics() {
  const text = document.getElementById('diagnosticsText');
  const status = document.getElementById('diagnosticsCopyStatus');
  try {
    await navigator.clipboard.writeText(text.value);
    status.textContent = 'Diagnostics copied.';
  } catch {
    document.getElementById('diagnosticsPreview').open = true;
    text.focus();
    text.select();
    status.textContent = 'Clipboard unavailable. Copy the selected text below.';
  }
}

function submitIssueReport(fields) {
  return fetch('/report.php', {
    method: 'POST',
    ...(fields.automatic ? { referrerPolicy: 'no-referrer', credentials: 'omit' } : {}),
    headers: { 'Content-Type': 'text/plain' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      ...fields,
      ...(!fields.automatic ? {
        nick: (typeof beaconNick === 'function') ? beaconNick() : '',
        ua: navigator.userAgent,
        ts: new Date().toISOString()
      } : {})
    })
  });
}

window.addEventListener('playbackpersistentproblem', async event => {
  const now = Date.now();
  const lastAttempt = Math.max(automaticReportAttemptAt, storage.getNum('automaticPlaybackReportAt', 0));
  if (!storage.getBool('autoPlaybackReports', true) || now - lastAttempt < 3600000 || performance.now() < 3000) return;
  // Reserve before sending, including failed attempts, to prevent retry storms.
  automaticReportAttemptAt = now;
  storage.set('automaticPlaybackReportAt', now);
  const diagnostics = playbackDiagnostics.report(event.detail.attempt);
  // Deliberate allowlist: never send the detailed recorder by default.
  const compactState = sample => ({
    mode: sample.mode,
    paused: sample.paused,
    muted: sample.muted,
    online: sample.online,
    hidden: sample.hidden,
    readyState: sample.readyState,
    networkState: sample.networkState,
    errorCode: sample.errorCode,
    contextState: sample.contextState,
    libraryState: sample.libraryState,
    playbackMethod: sample.playbackMethod,
    bufferSeconds: Math.round(Math.max(0, ...sample.buffered.map(range => range[1] - sample.currentTime))),
    inputSilent: sample.inputRms === null ? null : sample.inputRms < 0.00001
  });
  const browser = navigator.userAgent.match(/(Firefox|Chrome|Version)\/(\d+)/);
  const fault = {
    schemaVersion: 1,
    reason: event.detail.reason,
    browser: browser ? `${browser[1] === 'Version' ? 'Safari' : browser[1]} ${browser[2]}` : 'Other',
    assets: diagnostics.assets,
    httpStatuses: [...new Set(diagnostics.incident.errors.map(error => error.httpStatus).filter(Number.isInteger))],
    failure: compactState(diagnostics.incident.playback),
    current: compactState(diagnostics.current)
  };
  const status = document.getElementById('diagnosticsAutoStatus');
  status.textContent = 'Sending automatic playback report…';
  try {
    if (automaticReportSessionId === null) {
      automaticReportSessionId = [...crypto.getRandomValues(new Uint8Array(16))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    fault.sessionId = automaticReportSessionId;
    fault.streamFingerprint = null;
    const source = diagnostics.incident.source || diagnostics.incident.playback.requested;
    const address = source?.upstream || source?.address;
    if (fault.failure.mode === 'stream' && address && crypto.subtle) {
      const url = new URL(address, location.href);
      if (['http:', 'https:'].includes(url.protocol)) {
        // Group upstream endpoints across proxies, never tokens or credentials.
        const canonical = url.origin + url.pathname;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
        fault.streamFingerprint = [...new Uint8Array(digest)]
          .map(byte => byte.toString(16).padStart(2, '0')).join('');
      }
    }
    // Opting out while hashing must prevent the pending upload too.
    if (!storage.getBool('autoPlaybackReports', true)) {
      status.textContent = 'Automatic reporting is off.';
      return;
    }
    const response = await submitIssueReport({
      automatic: true,
      elapsed: 3000,
      fault
    });
    status.textContent = response.ok ? 'Automatic playback report sent.' :
      'Automatic report did not send. Diagnostics remain available to copy or send manually.';
  } catch {
    status.textContent = 'Automatic report did not send. Diagnostics remain available to copy or send manually.';
  }
});

function sendReport() {
  const msgEl = document.getElementById('reportMessage');
  const contactEl = document.getElementById('reportContact');
  const hpEl = document.getElementById('reportWebsite');
  const btn = document.getElementById('reportSend');
  if (!msgEl || !btn) return;

  const message = msgEl.value.trim();
  if (message.length < 10) {
    setReportStatus('Please add a little more detail (at least 10 characters).', 'error');
    msgEl.focus();
    return;
  }

  const openedAt = window.reportModalOpenedAt || Date.now();
  const fields = {
    message,
    contact: (contactEl?.value || '').trim(),
    website: hpEl?.value || '',
    elapsed: Date.now() - openedAt
  };
  if (document.getElementById('reportIncludeDiagnostics').checked) {
    fields.diagnostics = reportDiagnosticData;
  }

  btn.disabled = true;
  setReportStatus('Sending…', '');

  submitIssueReport(fields)
    .then(res => {
      btn.disabled = false;
      if (res.ok) {
        msgEl.value = '';
        if (contactEl) contactEl.value = '';
        setReportStatus('Thanks — your report was sent.', 'ok');
      } else if (res.status === 429) {
        setReportStatus('Too many reports just now. Please try again later.', 'error');
      } else {
        setReportStatus('Sorry, that didn\'t send. Please try again.', 'error');
      }
    })
    .catch(() => {
      btn.disabled = false;
      setReportStatus('Sorry, that didn\'t send. Please check your connection.', 'error');
    });
}
