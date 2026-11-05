<?php
// report.php – issue report endpoint for *.4st.uk
// Stores reports in reports.log (denied to web) and emails reports@4st.uk

define('REPORT_EMAIL', 'reports@4st.uk');
define('REPORT_MIN_ELAPSED_MS', 3000);   // reject submissions faster than this
define('REPORT_RATE_MAX', 3);            // max reports per IP ...
define('REPORT_RATE_WINDOW', 3600);      // ... within this many seconds
define('REPORT_MAX_BODY_BYTES', 262144);
define('REPORT_MAX_DIAGNOSTIC_BYTES', 196608);

// CORS — only allow *.4st.uk origins
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (preg_match('/\.4st\.uk$/i', parse_url($origin, PHP_URL_HOST) ?? '')) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST, OPTIONS');
    exit;
}

$body = file_get_contents('php://input', false, null, 0, REPORT_MAX_BODY_BYTES + 1);
if (strlen($body) > REPORT_MAX_BODY_BYTES) {
    http_response_code(413);
    exit;
}
$input = json_decode($body, true);
if (!is_array($input)) {
    http_response_code(400);
    exit;
}

// Honeypot — pretend success so bots don't retry
if (trim($input['website'] ?? '') !== '') {
    http_response_code(204);
    exit;
}

$message = trim($input['message'] ?? '');
$contact = trim($input['contact'] ?? '');
$nick    = trim($input['nick'] ?? '');
$ua      = trim($input['ua'] ?? '');
$ts      = trim($input['ts'] ?? '');
$elapsed = (int)($input['elapsed'] ?? 0);
$diagnostics = $input['diagnostics'] ?? null;
$automatic = ($input['automatic'] ?? false) === true;
$fault = null;

// Automatic reports have a separate, strictly bounded schema. Never persist
// arbitrary client fields or accept the old detailed automatic upload format.
if ($automatic) {
    $fault = $input['fault'] ?? null;
    $valid = is_array($fault) && count($fault) === 9 &&
        ($fault['schemaVersion'] ?? null) === 1 &&
        in_array($fault['reason'] ?? null, ['stalled-playback', 'silent-audio', 'restart-limit'], true) &&
        is_string($fault['sessionId'] ?? null) && preg_match('/^[a-f0-9]{32}$/D', $fault['sessionId']) &&
        array_key_exists('streamFingerprint', $fault) && ($fault['streamFingerprint'] === null ||
            (is_string($fault['streamFingerprint']) && preg_match('/^[a-f0-9]{64}$/D', $fault['streamFingerprint']))) &&
        is_array($fault['httpStatuses'] ?? null) && array_values($fault['httpStatuses']) === $fault['httpStatuses'] && count($fault['httpStatuses']) <= 8 &&
        is_string($fault['browser'] ?? null) &&
        preg_match('/^(Other|(Firefox|Chrome|Safari) [0-9]{1,4})$/D', $fault['browser']) &&
        is_array($fault['assets'] ?? null) && array_values($fault['assets']) === $fault['assets'] && count($fault['assets']) <= 4;
    if ($valid) {
        foreach ($fault['httpStatuses'] as $status) {
            if (!is_int($status) || $status < 400 || $status > 599) $valid = false;
        }
        foreach ($fault['assets'] as $asset) {
            if (!is_array($asset) || count($asset) !== 2 ||
                !in_array($asset['path'] ?? null, ['/core.js', '/player.js', '/stream-player.js', '/playback-diagnostics.js'], true) ||
                !(array_key_exists('version', $asset) && ($asset['version'] === null ||
                  (is_string($asset['version']) && preg_match('/^[a-f0-9]{1,64}$/D', $asset['version']))))) $valid = false;
        }
        foreach (['failure', 'current'] as $phase) {
            $sample = $fault[$phase] ?? null;
            if (!is_array($sample) || count($sample) !== 13) { $valid = false; continue; }
            foreach (['paused', 'muted', 'online', 'hidden'] as $key) {
                if (!is_bool($sample[$key] ?? null)) $valid = false;
            }
            foreach (['readyState' => 4, 'networkState' => 3] as $key => $max) {
                if (!isset($sample[$key]) || !is_int($sample[$key]) || $sample[$key] < 0 || $sample[$key] > $max) $valid = false;
            }
            if (!array_key_exists('errorCode', $sample) || !in_array($sample['errorCode'], [null, 1, 2, 3, 4], true) ||
                !array_key_exists('inputSilent', $sample) || !in_array($sample['inputSilent'], [null, true, false], true) ||
                !isset($sample['bufferSeconds']) || !is_int($sample['bufferSeconds']) || $sample['bufferSeconds'] < 0 || $sample['bufferSeconds'] > 86400) $valid = false;
            foreach ([
                'mode' => ['stream', 'mix'],
                'contextState' => [null, 'running', 'suspended', 'interrupted', 'closed'],
                'libraryState' => [null, 'loading', 'playing', 'retrying', 'stopping', 'stopped'],
                'playbackMethod' => [null, 'mediasource', 'webaudio', 'html5']
            ] as $key => $values) {
                if (!array_key_exists($key, $sample) || !in_array($sample[$key], $values, true)) $valid = false;
            }
        }
    }
    if (!$valid || $diagnostics !== null) { http_response_code(422); exit; }
    $message = 'Automatic playback report: ' . $fault['reason'] . '.';
    $contact = $nick = $ua = $ts = '';
}

// Optional, versioned diagnostics; old clients still send plain issue reports.
if (($diagnostics !== null && (!is_array($diagnostics) ||
        ($diagnostics['schemaVersion'] ?? null) !== 1 ||
        strlen(json_encode($diagnostics, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) > REPORT_MAX_DIAGNOSTIC_BYTES)) ||
    (!$automatic && isset($input['fault']))) {
    http_response_code(422);
    exit;
}

// Time trap + length validation
if ($elapsed < REPORT_MIN_ELAPSED_MS ||
    strlen($message) < 10 || strlen($message) > 2000 ||
    strlen($contact) > 200 ||
    strlen($nick) > 100 ||
    strlen($ua) > 500) {
    http_response_code(422);
    exit;
}

$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';

// Per-IP rate limit (simple file of recent timestamps)
$rlFile = __DIR__ . '/report_rate_' . md5($ip);
$now = time();
$recent = [];
if (is_file($rlFile)) {
    foreach (explode("\n", (string)file_get_contents($rlFile)) as $t) {
        $t = (int)$t;
        if ($t && ($now - $t) < REPORT_RATE_WINDOW) $recent[] = $t;
    }
}
if (count($recent) >= REPORT_RATE_MAX) {
    http_response_code(429);
    exit;
}
$recent[] = $now;
file_put_contents($rlFile, implode("\n", $recent), LOCK_EX);

// Persist to log (JSON line)
$record = json_encode($automatic ? [
    'server_ts' => date('c'),
    'automatic' => true,
    'fault' => $fault,
] : [
    'message'   => $message,
    'contact'   => $contact,
    'nick'      => $nick,
    'ua'        => $ua,
    'ts'        => $ts,
    'server_ts' => date('c'),
    'ip'        => $ip,
    'automatic' => $automatic,
    'diagnostics' => $diagnostics,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";

if (file_put_contents(__DIR__ . '/reports.log', $record, FILE_APPEND | LOCK_EX) !== strlen($record)) {
    http_response_code(500);
    exit;
}

// The request hostname is an informational label, not a trusted installation ID.
$reportHost = strtolower($_SERVER['HTTP_HOST'] ?? '');
if (strlen($reportHost) > 253 || !filter_var($reportHost, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
    $reportHost = 'Website';
}
$subject = '[' . $reportHost . '] Issue report';
$mailBody = $automatic
    ? $message . "\n\nMinimal fault data:\n" . json_encode($fault, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n"
    : $message . "\n\n"
    . '---' . "\n"
    . 'Contact: ' . ($contact !== '' ? $contact : '(none)') . "\n"
    . 'Nick: '    . ($nick !== '' ? $nick : '(none)') . "\n"
    . 'When: '    . date('c') . "\n"
    . 'IP: '      . $ip . "\n"
    . 'UA: '      . $ua . "\n";
if ($diagnostics !== null) {
    $mailBody .= "\nPlayback diagnostics (" . ($automatic ? 'automatic' : 'attached') . "):\n"
        . json_encode($diagnostics, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
}
$headers = 'From: noreply@4st.uk' . "\r\n"
    . 'Content-Type: text/plain; charset=UTF-8';
@mail(REPORT_EMAIL, $subject, $mailBody, $headers);

http_response_code(204);
