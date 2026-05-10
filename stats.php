<?php
// stats.php – beacon.log analytics dashboard

// Simple auth — change this password before deploying
define('STATS_PASSWORD', 'ST201210');

if (!isset($_SERVER['PHP_AUTH_PW']) || $_SERVER['PHP_AUTH_PW'] !== STATS_PASSWORD) {
    header('WWW-Authenticate: Basic realm="Stats"');
    http_response_code(401);
    exit('Unauthorized');
}

// Parse beacon.log
$logFile = __DIR__ . '/beacon.log';
$entries = [];
if (file_exists($logFile)) {
    foreach (file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $entry = json_decode($line, true);
        if ($entry) $entries[] = $entry;
    }
}

$total = count($entries);

// Aggregate stats
$ips = [];
$nicks = [];
$events = [];
$streams = [];
$mixes = [];
$searches = [];
$sources = [];
$days = [];

foreach ($entries as $e) {
    $ip = $e['ip'] ?? 'unknown';
    $nick = $e['nick'] ?? 'unknown';
    $event = $e['event'] ?? 'unknown';
    $detail = $e['detail'] ?? '';
    $day = substr($e['server_ts'] ?? $e['ts'] ?? '', 0, 10);

    $ips[$ip] = ($ips[$ip] ?? 0) + 1;
    $nicks[$nick] = ($nicks[$nick] ?? 0) + 1;
    $events[$event] = ($events[$event] ?? 0) + 1;
    if ($day) $days[$day] = ($days[$day] ?? 0) + 1;

    if (($event === 'stream-play' || $event === 'daily-stream') && $detail) {
        $streams[$detail] = ($streams[$detail] ?? 0) + 1;
    }
    if (($event === 'mix-play' || $event === 'daily-mix') && $detail) {
        $mixes[$detail] = ($mixes[$detail] ?? 0) + 1;
    }
    $source = $e['source'] ?? '';
    if ($source) $sources[$source] = ($sources[$source] ?? 0) + 1;

    if ($event === 'search' && $detail) {
        $searches[] = ['query' => $detail, 'nick' => $nick, 'ts' => $e['server_ts'] ?? $e['ts'] ?? ''];
    }
}

arsort($ips);
arsort($nicks);
arsort($events);
arsort($streams);
arsort($mixes);
arsort($sources);
ksort($days);
$searches = array_slice(array_reverse($searches), 0, 30);

// Date range
$firstTs = $entries[0]['server_ts'] ?? $entries[0]['ts'] ?? null;
$lastTs = end($entries)['server_ts'] ?? end($entries)['ts'] ?? null;

function h($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

function renderTable($data, $col1, $col2, $limit = 20) {
    if (empty($data)) { echo '<p class="muted">No data</p>'; return; }
    echo '<table><tr><th>' . h($col1) . '</th><th>' . h($col2) . '</th></tr>';
    $i = 0;
    foreach ($data as $key => $val) {
        if ($i++ >= $limit) break;
        echo '<tr><td>' . h($key) . '</td><td>' . $val . '</td></tr>';
    }
    echo '</table>';
}
?>
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Stats</title>
<style>
  body { background: #1a1a2e; color: #e0e0e0; font-family: -apple-system, sans-serif; margin: 0; padding: 20px; }
  h1 { color: #7c7cff; margin-top: 0; }
  h2 { color: #5c6bc0; border-bottom: 1px solid #3d3d5c; padding-bottom: 6px; margin-top: 32px; }
  .summary { display: flex; gap: 20px; flex-wrap: wrap; margin: 16px 0; }
  .stat-box { background: #252542; border-radius: 8px; padding: 16px 24px; min-width: 120px; }
  .stat-box .num { font-size: 28px; font-weight: bold; color: #7c7cff; }
  .stat-box .label { color: #888; font-size: 13px; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; max-width: 600px; margin: 8px 0 16px; }
  th { text-align: left; color: #888; font-size: 12px; text-transform: uppercase; padding: 6px 12px; border-bottom: 1px solid #3d3d5c; }
  td { padding: 6px 12px; border-bottom: 1px solid #2a2a4a; }
  td:last-child { text-align: right; color: #7c7cff; }
  .muted { color: #666; }
  .meta { color: #666; font-size: 13px; margin: 4px 0; }
  .columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
</style>
</head>
<body>
<h1>📊 Beacon Stats</h1>
<p class="meta">
  <?= $total ?> events
  <?php if ($firstTs && $lastTs): ?>
    · <?= h(substr($firstTs, 0, 10)) ?> → <?= h(substr($lastTs, 0, 10)) ?>
  <?php endif; ?>
  · Log size: <?= file_exists($logFile) ? round(filesize($logFile) / 1024, 1) . ' KB' : '0 KB' ?>
</p>

<div class="summary">
  <div class="stat-box"><div class="num"><?= count($ips) ?></div><div class="label">Unique IPs</div></div>
  <div class="stat-box"><div class="num"><?= count($nicks) ?></div><div class="label">Nicknames</div></div>
  <div class="stat-box"><div class="num"><?= $events['session-start'] ?? 0 ?></div><div class="label">Sessions</div></div>
  <div class="stat-box"><div class="num"><?= ($events['stream-play'] ?? 0) + ($events['mix-play'] ?? 0) + ($events['daily-stream'] ?? 0) + ($events['daily-mix'] ?? 0) ?></div><div class="label">Plays</div></div>
  <div class="stat-box"><div class="num"><?= $events['search'] ?? 0 ?></div><div class="label">Searches</div></div>
</div>

<div class="columns">
<div>
  <h2>Events</h2>
  <?php renderTable($events, 'Event', 'Count'); ?>

  <h2>Nicknames</h2>
  <?php renderTable($nicks, 'Nick', 'Events'); ?>

  <h2>IPs</h2>
  <?php renderTable($ips, 'IP', 'Events'); ?>

  <h2>Sources</h2>
  <?php renderTable($sources, 'Source', 'Events'); ?>
</div>
<div>
  <h2>Top Streams</h2>
  <?php renderTable($streams, 'Stream', 'Plays'); ?>

  <h2>Top Mixes</h2>
  <?php renderTable($mixes, 'Mix', 'Plays'); ?>

  <h2>Daily Activity</h2>
  <?php renderTable($days, 'Date', 'Events', 60); ?>

  <h2>Recent Searches</h2>
  <?php if (empty($searches)): ?>
    <p class="muted">No searches</p>
  <?php else: ?>
    <table>
      <tr><th>Query</th><th>Nick</th><th>Time</th></tr>
      <?php foreach ($searches as $s): ?>
        <tr>
          <td><?= h($s['query']) ?></td>
          <td><?= h($s['nick']) ?></td>
          <td><?= h(substr($s['ts'], 0, 16)) ?></td>
        </tr>
      <?php endforeach; ?>
    </table>
  <?php endif; ?>
</div>
</div>


</body>
</html>
