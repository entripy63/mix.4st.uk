// report.js - Issue reporting modal
// Dependencies: ping.js (beaconNick)

function showReport() {
  window.reportModalOpenedAt = Date.now();
  setReportStatus('', '');
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
  const body = JSON.stringify({
    message,
    contact: (contactEl?.value || '').trim(),
    website: hpEl?.value || '',
    elapsed: Date.now() - openedAt,
    nick: (typeof beaconNick === 'function') ? beaconNick() : '',
    ua: navigator.userAgent,
    ts: new Date().toISOString()
  });

  btn.disabled = true;
  setReportStatus('Sending…', '');

  fetch('/report.php', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body
  })
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
