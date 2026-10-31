<?php
// Общие функции API: конфигурация, база данных, сессия, ответы.
// Совместимо с PHP 7.4+.

declare(strict_types=1);

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/config.php';
        if (!is_file($file)) {
            fail(503, 'not_configured', 'Сервер не настроен: создайте api/config.php из config.sample.php');
        }
        $cfg = array_merge(['pass_score' => 0.8], require $file);
    }
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config();
        $pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['password'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        if (driver() === 'sqlite') {
            $pdo->exec('PRAGMA foreign_keys = ON');
        }
    }
    return $pdo;
}

function driver(): string
{
    return strpos(config()['dsn'], 'sqlite:') === 0 ? 'sqlite' : 'mysql';
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function courses(): array
{
    static $c = null;
    if ($c === null) {
        $c = require __DIR__ . '/answers.php';
    }
    return $c;
}

function schema(): array
{
    $sqlite = driver() === 'sqlite';
    $id = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY';
    $ref = $sqlite ? 'INTEGER' : 'INT UNSIGNED';
    $tail = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    return [
        "CREATE TABLE IF NOT EXISTS users (
            id $id,
            login VARCHAR(120) NOT NULL UNIQUE,
            name VARCHAR(120) NOT NULL,
            branch VARCHAR(120) NOT NULL DEFAULT '',
            position VARCHAR(120) NOT NULL DEFAULT '',
            role VARCHAR(10) NOT NULL DEFAULT 'user',
            password_hash VARCHAR(255) NOT NULL,
            active TINYINT NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            last_login DATETIME NULL
        )$tail",
        "CREATE TABLE IF NOT EXISTS lesson_progress (
            user_id $ref NOT NULL,
            course_id VARCHAR(40) NOT NULL,
            lesson_idx INT NOT NULL,
            done_at DATETIME NOT NULL,
            PRIMARY KEY (user_id, course_id, lesson_idx),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$tail",
        "CREATE TABLE IF NOT EXISTS quiz_results (
            user_id $ref NOT NULL,
            course_id VARCHAR(40) NOT NULL,
            best DECIMAL(5,4) NOT NULL DEFAULT 0,
            attempts INT NOT NULL DEFAULT 0,
            passed_at DATETIME NULL,
            cert_id VARCHAR(40) NULL UNIQUE,
            PRIMARY KEY (user_id, course_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$tail",
        "CREATE TABLE IF NOT EXISTS settings (
            name VARCHAR(40) PRIMARY KEY,
            value VARCHAR(255) NOT NULL
        )$tail",
        "CREATE TABLE IF NOT EXISTS login_attempts (
            ip VARCHAR(45) NOT NULL,
            at DATETIME NOT NULL
        )$tail",
    ];
}

function setting(string $name, string $default = ''): string
{
    $v = q('SELECT value FROM settings WHERE name = ?', [$name])->fetchColumn();
    return $v === false ? $default : (string)$v;
}

function set_setting(string $name, string $value): void
{
    q('DELETE FROM settings WHERE name = ?', [$name]);
    q('INSERT INTO settings (name, value) VALUES (?, ?)', [$name, $value]);
}

/* ── HTTP ── */

function json_out(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $code, string $message): void
{
    json_out(['error' => $code, 'message' => $message], $status);
}

function input(): array
{
    static $data = null;
    if ($data === null) {
        $data = json_decode(file_get_contents('php://input') ?: '[]', true);
        if (!is_array($data)) {
            $data = [];
        }
    }
    return $data;
}

function str_in(string $key, int $max = 120): string
{
    $v = input()[$key] ?? '';
    return is_scalar($v) ? mb_substr(trim((string)$v), 0, $max) : '';
}

function client_ip(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45);
}

/* ── Сессия и доступ ── */

function start_session(): void
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('VIVAACADEMY');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
}

function check_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!hash_equals($_SESSION['csrf'] ?? '', $sent)) {
        fail(403, 'csrf', 'Сессия устарела. Обновите страницу.');
    }
}

function current_user(): ?array
{
    if (empty($_SESSION['uid'])) {
        return null;
    }
    $u = q('SELECT * FROM users WHERE id = ? AND active = 1', [$_SESSION['uid']])->fetch();
    return $u ?: null;
}

function require_user(): array
{
    $u = current_user();
    if (!$u) {
        fail(401, 'auth', 'Войдите в личный кабинет.');
    }
    return $u;
}

function require_admin(): array
{
    $u = require_user();
    if ($u['role'] !== 'admin') {
        fail(403, 'forbidden', 'Доступно только администратору.');
    }
    return $u;
}

function public_user(array $u): array
{
    return [
        'id' => (int)$u['id'],
        'login' => $u['login'],
        'name' => $u['name'],
        'branch' => $u['branch'],
        'position' => $u['position'],
        'role' => $u['role'],
    ];
}

function valid_login(string $login): bool
{
    return (bool)preg_match('/^[\p{L}\p{N}._@+\-]{3,120}$/u', $login);
}

function make_cert_id(string $courseId): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $rnd = '';
    for ($i = 0; $i < 6; $i++) {
        $rnd .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return 'VA-' . strtoupper(substr($courseId, 0, 3)) . '-' . gmdate('Y') . '-' . $rnd;
}

/* ── Прогресс ── */

function user_progress(int $uid): array
{
    $lessons = [];
    foreach (q('SELECT course_id, lesson_idx FROM lesson_progress WHERE user_id = ?', [$uid]) as $r) {
        $lessons[$r['course_id']][] = (int)$r['lesson_idx'];
    }
    $quiz = [];
    foreach (q('SELECT * FROM quiz_results WHERE user_id = ?', [$uid]) as $r) {
        $quiz[$r['course_id']] = [
            'best' => (float)$r['best'],
            'attempts' => (int)$r['attempts'],
            'passedAt' => $r['passed_at'] ? strtotime($r['passed_at'] . ' UTC') * 1000 : null,
            'certId' => $r['cert_id'],
        ];
    }
    return ['lessons' => (object)$lessons, 'quiz' => (object)$quiz];
}
