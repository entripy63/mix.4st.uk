<?php
// reports.php – issue reports viewer

// Simple auth — change this password before deploying
define('REPORTS_PASSWORD', 'ST201210');

if (!isset($_SERVER['PHP_AUTH_PW']) || $_SERVER['PHP_AUTH_PW'] !== REPORTS_PASSWORD) {
    header('WWW-Authenticate: Basic realm="Reports"');
    http_response_code(401);
    exit('Unauthorized');
}

$logFile = __DIR__ . '/reports.log';

// Clear = archive the current log to a timestamped backup
$notice = '';
if (($_POST['action'] ?? '') === 'clear') {
    if (is_file($logFile) && filesize($logFile) > 0) {
        $backup = __DIR__ . '/reports-' . date('Ymd-His') . '.bak';
        if (@rename($logFile, $backup)) {
            $notice = 'Archived ' . count(array_filter(explode("\n", (string)@file_get_contents($backup)))) . ' report(s) to ' . basename($backup);
        } else {
            $notice = 'Could not archive log (check file permissions).';
        }
    } else {
        $notice = 'Nothing to clear — log is empty.';
    }
}

$entries = [];
if (file_exists($logFile)) {
    foreach (file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $entry = json_decode($line, true);
        if ($entry) $entries[] = $entry;
    }
}
$entries = array_reverse($entries); // newest first
$total = count($entries);

function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Reports</title>
<style>
  body { background: #1a1a2e; color: #e0e0e0; font-family: -apple-system, sans-serif; margin: 0; padding: 20px; }
  h1 { color: #7c7cff; margin-top: 0; }
  .meta { color: #666; font-size: 13px; margin: 4px 0 20px; }
  .report { background: #252542; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; max-width: 800px; }
  .report .msg { white-space: pre-wrap; word-break: break-word; line-height: 1.5; margin: 0 0 12px; }
  .report .fields { color: #888; font-size: 12px; line-height: 1.6; }
  .report .fields b { color: #aaa; font-weight: normal; }
  .muted { color: #666; }
  .bar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .notice { background: #2d3a2d; color: #9fd49f; border-radius: 6px; padding: 8px 12px; font-size: 13px; margin-bottom: 16px; }
  button.clear { background: #5a2a2a; color: #ffcaca; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  button.clear:hover { background: #743434; }
  .archives { color: #666; font-size: 12px; margin-top: 24px; }
  .archives a { color: #7c7cff; }
</style>
</head>
<body>
<h1>🐞 Issue Reports</h1>

<?php if ($notice !== ''): ?>
  <div class="notice"><?= h($notice) ?></div>
<?php endif; ?>

<div class="bar">
  <span class="meta">
    <?= $total ?> report<?= $total === 1 ? '' : 's' ?>
    · Log size: <?= file_exists($logFile) ? round(filesize($logFile) / 1024, 1) . ' KB' : '0 KB' ?>
  </span>
  <?php if ($total > 0): ?>
    <form method="post" onsubmit="return confirm('Archive the current log to a timestamped backup and start fresh?');" style="margin:0;">
      <input type="hidden" name="action" value="clear">
      <button type="submit" class="clear">Clear (archive) log</button>
    </form>
  <?php endif; ?>
</div>

<?php if (empty($entries)): ?>
  <p class="muted">No reports yet.</p>
<?php else: ?>
  <?php foreach ($entries as $e): ?>
    <div class="report">
      <p class="msg"><?= h($e['message'] ?? '') ?></p>
      <div class="fields">
        <b>Contact:</b> <?= h(($e['contact'] ?? '') !== '' ? $e['contact'] : '(none)') ?><br>
        <b>Nick:</b> <?= h(($e['nick'] ?? '') !== '' ? $e['nick'] : '(none)') ?>
        · <b>When:</b> <?= h(substr($e['server_ts'] ?? $e['ts'] ?? '', 0, 19)) ?>
        · <b>IP:</b> <?= h($e['ip'] ?? '') ?><br>
        <b>UA:</b> <?= h($e['ua'] ?? '') ?>
      </div>
    </div>
  <?php endforeach; ?>
<?php endif; ?>

<?php $backups = glob(__DIR__ . '/reports-*.bak'); rsort($backups); ?>
<?php if (!empty($backups)): ?>
  <div class="archives">
    Archived logs (newest first):
    <?php foreach ($backups as $b): ?>
      <br><?= h(basename($b)) ?> — <?= round(filesize($b) / 1024, 1) ?> KB
    <?php endforeach; ?>
    <br><span class="muted">(stored on the server; not web-accessible)</span>
  </div>
<?php endif; ?>

</body>
</html>
