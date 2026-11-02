<?php
// Finite, quiet test audio; never fetches a URL or reads a caller-selected file.
declare(strict_types=1);

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    exit;
}
$case = $_GET['case'] ?? '';
if (!is_string($case) || !preg_match('/\A[a-zA-Z0-9_-]{1,48}\z/', $case)) {
    http_response_code(400);
    exit;
}
$config = json_decode(file_get_contents(dirname(__DIR__) . '/config.json'), true, 512, JSON_THROW_ON_ERROR);
$headers = [];
foreach (getallheaders() as $name => $value) {
    // Do not retain cookies, authentication or arbitrary application headers.
    if (in_array(strtolower($name), [
        'host', 'user-agent', 'accept', 'accept-encoding', 'accept-language',
        'connection', 'icy-metadata', 'range', 'cache-control', 'pragma',
        'origin', 'referer', 'forwarded', 'x-forwarded-for', 'x-forwarded-proto',
        'cf-connecting-ip', 'cf-worker', 'cf-ray', 'cf-visitor', 'cf-ipcountry',
        'true-client-ip', 'cdn-loop', 'via', 'sec-fetch-mode', 'sec-fetch-site'
    ], true)) {
        $headers[$name] = substr($value, 0, 2048);
    }
}
$record = [
    'at' => gmdate('c'), 'case' => $case,
    'remote' => $_SERVER['REMOTE_ADDR'] ?? null,
    'port' => $_SERVER['REMOTE_PORT'] ?? null,
    'http' => $_SERVER['SERVER_PROTOCOL'] ?? null,
    'tls' => $_SERVER['SSL_PROTOCOL'] ?? null,
    'cipher' => $_SERVER['SSL_CIPHER'] ?? null,
    'sni' => $_SERVER['SSL_TLS_SNI'] ?? null,
    'headers' => $headers
];
$line = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR) . "\n";
if (file_put_contents($config['log'], $line, FILE_APPEND | LOCK_EX) === false) {
    http_response_code(503);
    exit;
}

// One second, mono 8 kHz PCM, 440 Hz at approximately -36 dBFS.
$pcm = '';
for ($i = 0; $i < 8000; $i++) {
    $pcm .= pack('v', ((int) round(512 * sin(2 * M_PI * 440 * $i / 8000))) & 65535);
}
$wav = 'RIFF' . pack('V', 36 + strlen($pcm)) . 'WAVEfmt '
    . pack('VvvVVvv', 16, 1, 1, 8000, 16000, 2, 16)
    . 'data' . pack('V', strlen($pcm)) . $pcm;
header('Content-Type: audio/wav');
header('Content-Length: ' . strlen($wav));
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');
echo $wav;
