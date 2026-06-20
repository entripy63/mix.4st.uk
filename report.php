<?php
// report.php – issue report endpoint for *.4st.uk
// Stores reports in reports.log (denied to web) and emails reports@4st.uk

define('REPORT_EMAIL', 'reports@4st.uk');
define('REPORT_MIN_ELAPSED_MS', 3000);   // reject submissions faster than this
define('REPORT_RATE_MAX', 3);            // max reports per IP ...
define('REPORT_RATE_WINDOW', 3600);      // ... within this many seconds

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

$input = json_decode(file_get_contents('php://input'), true);
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
$record = json_encode([
    'message'   => $message,
    'contact'   => $contact,
    'nick'      => $nick,
    'ua'        => $ua,
    'ts'        => $ts,
    'server_ts' => date('c'),
    'ip'        => $ip,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";

file_put_contents(__DIR__ . '/reports.log', $record, FILE_APPEND | LOCK_EX);

// Email notification (plain text; user input only ever in the body, never headers)
$subject = 'mixes.4st.uk issue report';
$mailBody = $message . "\n\n"
    . '---' . "\n"
    . 'Contact: ' . ($contact !== '' ? $contact : '(none)') . "\n"
    . 'Nick: '    . ($nick !== '' ? $nick : '(none)') . "\n"
    . 'When: '    . date('c') . "\n"
    . 'IP: '      . $ip . "\n"
    . 'UA: '      . $ua . "\n";
$headers = 'From: noreply@4st.uk' . "\r\n"
    . 'Content-Type: text/plain; charset=UTF-8';
@mail(REPORT_EMAIL, $subject, $mailBody, $headers);

http_response_code(204);
