<?php
// secret-config.example.php — TEMPLATE ONLY.
//
// Copy this file to secret-config.php (which is gitignored and excluded from
// deployment) and replace the hashes below. Upload secret-config.php to each
// server manually via FTP — it is never committed and never pushed by deploy.
//
// Generate a bcrypt hash for a password (run anywhere with PHP CLI):
//   php -r "echo password_hash('your-password-here', PASSWORD_DEFAULT), \"\n\";"
//
// Used by stats.php (key 'stats') and reports.php (key 'reports').

return [
    'stats'   => '$2y$REPLACE_WITH_BCRYPT_HASH',
    'reports' => '$2y$REPLACE_WITH_BCRYPT_HASH',
];
