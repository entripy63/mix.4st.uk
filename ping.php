<?php
// beacon.php – lightweight analytics endpoint for *.4st.uk

// CORS
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

$event  = trim($input['event'] ?? '');
$nick   = trim($input['nick'] ?? '');
$detail = trim($input['detail'] ?? '');
$ts     = trim($input['ts'] ?? '');

if ($event === '' || strlen($event) > 100 ||
    $nick === '' || strlen($nick) > 100 ||
    strlen($detail) > 500) {
    http_response_code(422);
    exit;
}

$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'];

$record = json_encode([
    'event'     => $event,
    'nick'      => $nick,
    'detail'    => $detail,
    'ts'        => $ts,
    'server_ts' => date('c'),
    'ip'        => $ip,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";

file_put_contents(__DIR__ . '/beacon.log', $record, FILE_APPEND | LOCK_EX);

http_response_code(204);
