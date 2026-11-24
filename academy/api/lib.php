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
        // Результаты тестов, пройденных до запуска Академии (импорт со старого сайта тестирования)
        "CREATE TABLE IF NOT EXISTS external_results (
            user_id $ref NOT NULL,
            test VARCHAR(200) NOT NULL,
            score DECIMAL(5,2) NOT NULL DEFAULT 0,
            correct INT NOT NULL DEFAULT 0,
            total INT NOT NULL DEFAULT 0,
            passed TINYINT NOT NULL DEFAULT 0,
            taken_at DATETIME NULL,
            attempts INT NOT NULL DEFAULT 1,
            cert_no VARCHAR(80) NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, test),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$tail",
        // Учебные материалы (презентации PDF), загруженные администратором
        "CREATE TABLE IF NOT EXISTS materials (
            id $id,
            title VARCHAR(200) NOT NULL,
            brand VARCHAR(120) NOT NULL DEFAULT '',
            category VARCHAR(40) NOT NULL DEFAULT '',
            description TEXT NULL,
            course_id VARCHAR(40) NOT NULL DEFAULT '',
            file VARCHAR(80) NOT NULL,
            original_name VARCHAR(200) NOT NULL DEFAULT '',
            size INT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            pdf VARCHAR(32) NULL,
            pdf_size INT NOT NULL DEFAULT 0,
            conv_tries INT NOT NULL DEFAULT 0,
            conv_error VARCHAR(300) NOT NULL DEFAULT '',
            link VARCHAR(500) NOT NULL DEFAULT ''
        )$tail",
        // Содержимое файлов материалов частями по 512 КБ (хранится в базе — не нужны права записи на диск)
        "CREATE TABLE IF NOT EXISTS material_chunks (
            upload VARCHAR(32) NOT NULL,
            idx INT NOT NULL,
            data " . ($sqlite ? 'BLOB' : 'MEDIUMBLOB') . " NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (upload, idx)
        )$tail",
        // Привязка Telegram: код для ссылки t.me/<бот>?start=<код> и чат сотрудника
        "CREATE TABLE IF NOT EXISTS tg_links (
            user_id $ref NOT NULL PRIMARY KEY,
            chat_id VARCHAR(40) NULL,
            code VARCHAR(32) NULL,
            linked_at DATETIME NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$tail",
        // Афиша: мероприятия и записи на них
        "CREATE TABLE IF NOT EXISTS events (
            id $id,
            title VARCHAR(200) NOT NULL,
            speaker VARCHAR(200) NOT NULL DEFAULT '',
            description TEXT NULL,
            place VARCHAR(200) NOT NULL DEFAULT '',
            link VARCHAR(300) NOT NULL DEFAULT '',
            starts_at DATETIME NOT NULL,
            duration INT NOT NULL DEFAULT 60,
            capacity INT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL
        )$tail",
        "CREATE TABLE IF NOT EXISTS event_regs (
            event_id $ref NOT NULL,
            user_id $ref NOT NULL,
            created_at DATETIME NOT NULL,
            reminded INT NOT NULL DEFAULT 0,
            PRIMARY KEY (event_id, user_id),
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )$tail",
        // Рейтинг продаж по акциям: периоды (загрузка Excel от руководства 2 раза в месяц) и строки продаж
        "CREATE TABLE IF NOT EXISTS sales_periods (
            id $id,
            title VARCHAR(120) NOT NULL,
            metric VARCHAR(10) NOT NULL DEFAULT 'qty',
            created_at DATETIME NOT NULL
        )$tail",
        "CREATE TABLE IF NOT EXISTS sales_rows (
            id $id,
            period_id INT NOT NULL,
            user_id INT NULL,
            name VARCHAR(160) NOT NULL DEFAULT '',
            branch VARCHAR(160) NOT NULL DEFAULT '',
            promo VARCHAR(200) NOT NULL DEFAULT '',
            qty DOUBLE NOT NULL DEFAULT 0,
            amount DOUBLE NOT NULL DEFAULT 0
        )$tail",
        // Рейтинг аптек по выполнению плана акций: исходный бланк (план на фармацевта, фармацевты, продажи) в JSON
        "CREATE TABLE IF NOT EXISTS sales_reports (
            period_id INT NOT NULL PRIMARY KEY,
            data " . ($sqlite ? 'TEXT' : 'MEDIUMTEXT') . " NOT NULL
        )$tail",
    ];
}

// Новые таблицы для уже установленной платформы: создаются один раз при первом запросе
const SCHEMA_VERSION = '9';
function migrate(): void
{
    try {
        if (setting('schema_version') === SCHEMA_VERSION) {
            return;
        }
    } catch (Throwable $e) {
        return; // платформа ещё не установлена — таблицы создаст установщик
    }
    try {
        foreach (schema() as $sql) {
            db()->exec($sql);
        }
        // Версия 6: PDF-копия презентаций PowerPoint (делает GitHub Actions, см. tools/convert-materials.py)
        foreach (['pdf VARCHAR(32) NULL', 'pdf_size INT NOT NULL DEFAULT 0', 'conv_tries INT NOT NULL DEFAULT 0', "conv_error VARCHAR(300) NOT NULL DEFAULT ''",
                  // Версия 7: видео по ссылке (Google Диск, YouTube) — файл не хранится в базе
                  "link VARCHAR(500) NOT NULL DEFAULT ''"] as $col) {
            try {
                db()->exec('ALTER TABLE materials ADD COLUMN ' . $col);
            } catch (Throwable $e) {
                // колонка уже есть
            }
        }
        seed();
        set_setting('schema_version', SCHEMA_VERSION);
    } catch (Throwable $e) {
        // Сайт продолжает работать; без новой таблицы недоступен только импорт старых результатов
        error_log('[viva-academy] migrate: ' . $e->getMessage());
    }
}

function external_passed_total(): int
{
    try {
        return (int)q('SELECT COUNT(*) FROM external_results WHERE passed = 1')->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}

// Первые данные, которые должны появиться на сайте вместе с обновлением (добавляются один раз)
function seed(): void
{
    if (setting('seed_event_nebulizer') === '') {
        // 20 ноября 2026, 14:30 по Тирасполю (UTC+2) = 12:30 UTC
        q('INSERT INTO events (title, speaker, description, place, link, starts_at, duration, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            'Небулайзер при лечении кашля и ОРВИ', 'Врач Рябчук Анна Сергеевна',
            'Когда небулайзер действительно помогает при кашле и ОРВИ, какие растворы можно использовать и как объяснить покупателю правила ингаляций.',
            '', '', '2026-11-20 12:30:00', 60, 0, now(),
        ]);
        set_setting('seed_event_nebulizer', '1');
    }
}

function external_results(int $uid): array
{
    $out = [];
    try {
        $rows = q('SELECT * FROM external_results WHERE user_id = ? ORDER BY taken_at DESC', [$uid])->fetchAll();
    } catch (Throwable $e) {
        return [];
    }
    foreach ($rows as $r) {
        $out[] = [
            'test' => $r['test'], 'score' => (float)$r['score'], 'correct' => (int)$r['correct'],
            'total' => (int)$r['total'], 'passed' => (bool)$r['passed'], 'attempts' => (int)$r['attempts'],
            'date' => $r['taken_at'] ? strtotime($r['taken_at'] . ' UTC') * 1000 : null, 'certNo' => $r['cert_no'],
        ];
    }
    return $out;
}

function setting(string $name, string $default = ''): string
{
    $v = q('SELECT value FROM settings WHERE name = ?', [$name])->fetchColumn();
    return $v === false ? $default : (string)$v;
}

// Безопасно при одновременных запросах: сначала обновляем, вставляем только если записи нет
function set_setting(string $name, string $value): void
{
    if (q('SELECT 1 FROM settings WHERE name = ?', [$name])->fetchColumn()) {
        q('UPDATE settings SET value = ? WHERE name = ?', [$value, $name]);
        return;
    }
    try {
        q('INSERT INTO settings (name, value) VALUES (?, ?)', [$name, $value]);
    } catch (PDOException $e) {
        q('UPDATE settings SET value = ? WHERE name = ?', [$value, $name]); // параллельный запрос успел вставить
    }
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

// Администратор или руководитель (руководитель только смотрит результаты)
function require_viewer(): array
{
    $u = require_user();
    if (!in_array($u['role'], ['admin', 'manager', 'demo'], true)) {
        fail(403, 'forbidden', 'Доступно только руководителям.');
    }
    return $u;
}

// Демо-доступ: интерфейс руководителя только для просмотра, ФИО и логины сотрудников скрыты
function demo_viewer(): bool
{
    static $d = null;
    if ($d === null) {
        $u = current_user();
        $d = $u !== null && $u['role'] === 'demo';
    }
    return $d;
}

function demo_name($id): string
{
    return $id !== null ? 'Сотрудник №' . (int)$id : 'Сотрудник (нет в Академии)';
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
    return ['lessons' => (object)$lessons, 'quiz' => (object)$quiz, 'external' => external_results($uid)];
}

/* ── Рейтинг ── */

// Рейтинг сотрудников по тестам: за каждый сданный курс — его лучший результат в процентах.
// Тест, сданный до запуска Академии, засчитывается за свой курс (по названию из импорта).
function rating(): array
{
    $best = []; // user_id → course_id → доля 0..1
    $tries = []; // user_id → course_id → попыток (при равных баллах выше тот, кто сдал с меньшего числа попыток)
    foreach (q('SELECT user_id, course_id, best, attempts FROM quiz_results WHERE passed_at IS NOT NULL') as $r) {
        $best[$r['user_id']][$r['course_id']] = (float)$r['best'];
        $tries[$r['user_id']][$r['course_id']] = max(1, (int)$r['attempts']);
    }
    $byLegacy = [];
    foreach (courses() as $cid => $c) {
        if (!empty($c['legacy'])) {
            $byLegacy[$c['legacy']] = $cid;
        }
    }
    try {
        $ext = q('SELECT user_id, test, score, attempts FROM external_results WHERE passed = 1')->fetchAll();
    } catch (Throwable $e) {
        $ext = [];
    }
    foreach ($ext as $r) {
        $cid = $byLegacy[$r['test']] ?? null;
        if ($cid !== null) {
            $v = min(1.0, (float)$r['score'] / 100);
            if ($v > ($best[$r['user_id']][$cid] ?? 0)) {
                $best[$r['user_id']][$cid] = $v;
                $tries[$r['user_id']][$cid] = max(1, (int)$r['attempts']);
            }
        }
    }
    $rows = [];
    foreach (q("SELECT id, name, branch FROM users WHERE role = 'user' AND active = 1") as $u) {
        $list = $best[$u['id']] ?? [];
        if (!$list) {
            continue;
        }
        $sum = array_sum($list);
        $rows[] = [
            'id' => (int)$u['id'], 'name' => $u['name'], 'branch' => $u['branch'],
            'passed' => count($list), 'avg' => (int)round($sum / count($list) * 100), 'points' => (int)round($sum * 100),
            'attempts' => array_sum($tries[$u['id']] ?? []),
        ];
    }
    usort($rows, function ($a, $b) {
        return [$b['points'], $a['attempts'], $a['name']] <=> [$a['points'], $b['attempts'], $b['name']];
    });
    // Равные баллы и попытки — одно место на всех
    foreach ($rows as $i => &$r) {
        $prev = $rows[$i - 1] ?? null;
        $r['place'] = $prev && $prev['points'] === $r['points'] && $prev['attempts'] === $r['attempts'] ? $prev['place'] : $i + 1;
    }
    unset($r);
    return $rows;
}

/* ── Учебные материалы ── */

// Файлы материалов хранятся в базе (таблица material_chunks): хостингу не нужны права записи на диск,
// а файлы попадают в резервную копию вместе с базой. materials.file — ключ загрузки.
function put_chunk(string $upload, int $idx, string $data): void
{
    $st = db()->prepare('INSERT INTO material_chunks (upload, idx, data, created_at) VALUES (?, ?, ?, ?)');
    $st->bindValue(1, $upload);
    $st->bindValue(2, $idx, PDO::PARAM_INT);
    $st->bindValue(3, $data, PDO::PARAM_LOB);
    $st->bindValue(4, now());
    $st->execute();
}

function chunk_data($v): string
{
    return is_resource($v) ? (string)stream_get_contents($v) : (string)$v;
}

// Тип файла материала по расширению исходного имени: pdf, pptx (pptx/ppsx/potx) или ppt (ppt/pps)
function material_type(string $name): string
{
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (in_array($ext, ['pptx', 'ppsx', 'potx'], true)) {
        return 'pptx';
    }
    if (in_array($ext, ['mp4', 'm4v', 'mov', 'webm'], true)) {
        return 'video';
    }
    return in_array($ext, ['ppt', 'pps'], true) ? 'ppt' : 'pdf';
}

// Сигнатура начала файла: PDF, ZIP (pptx) или OLE (старый ppt)
function material_magic(string $data): string
{
    if (substr($data, 0, 5) === '%PDF-') {
        return 'pdf';
    }
    if (substr($data, 0, 4) === "PK\x03\x04") {
        return 'pptx';
    }
    // MP4 и MOV: атом ftyp (или moov/mdat/wide/free в старых MOV) по смещению 4; WebM: сигнатура EBML
    if (in_array(substr($data, 4, 4), ['ftyp', 'moov', 'mdat', 'wide', 'free'], true) || substr($data, 0, 4) === "\x1A\x45\xDF\xA3") {
        return 'video';
    }
    return substr($data, 0, 8) === "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" ? 'ppt' : '';
}

// Ключ для конвертера презентаций (GitHub Actions). Файл api/conv_key.php создаёт выкладка;
// ключ выводится из секрета выкладки, поэтому отдельно настраивать ничего не нужно.
function conv_key_ok(): bool
{
    $f = __DIR__ . '/conv_key.php';
    $key = is_file($f) ? (string)(include $f) : '';
    $got = (string)($_SERVER['HTTP_X_CONV_KEY'] ?? '');
    return strlen($key) >= 32 && hash_equals($key, $got);
}

const CHUNK_SIZE = 524288; // 512 КБ — размер части при загрузке (js/app.js, tools/convert-materials.py)

// Отдать файл из частей в базе — по одной части за раз, не держа весь файл в памяти.
// $from/$to — диапазон байтов (включительно) для перемотки видео; части загружаются по CHUNK_SIZE.
function stream_upload(string $upload, int $from = 0, int $to = -1): void
{
    $i = intdiv($from, CHUNK_SIZE);
    $skip = $from - $i * CHUNK_SIZE;
    $left = $to < 0 ? PHP_INT_MAX : $to - $from + 1;
    for (; $left > 0; $i++) {
        $v = q('SELECT data FROM material_chunks WHERE upload = ? AND idx = ?', [$upload, $i])->fetchColumn();
        if ($v === false) {
            break;
        }
        $part = chunk_data($v);
        if ($skip) {
            $part = substr($part, $skip);
            $skip = 0;
        }
        if (strlen($part) > $left) {
            $part = substr($part, 0, $left);
        }
        $left -= strlen($part);
        echo $part;
        flush();
        if (connection_aborted()) {
            break;
        }
    }
}

function is_ppt(string $type): bool
{
    return $type === 'pptx' || $type === 'ppt';
}

function upload_size(string $upload): int
{
    $size = 0;
    foreach (q('SELECT data FROM material_chunks WHERE upload = ?', [$upload]) as $r) {
        $size += strlen(chunk_data($r['data']));
    }
    return $size;
}

// Ссылка на видео (Google Диск, YouTube и др.): только https, без пробелов и кавычек
function video_link(string $url): string
{
    $url = trim($url);
    if (!preg_match('~^https://[^\s"\'<>]+$~i', $url) || strlen($url) > 500) {
        return '';
    }
    return $url;
}

function material_row(array $r): array
{
    $link = (string)($r['link'] ?? '');
    $type = $link !== '' ? 'video' : material_type((string)$r['original_name']);
    return [
        'type' => $type,
        'link' => $link,
        // Для PowerPoint: есть ли готовая PDF-копия для просмотра и идёт ли ещё её подготовка
        'pdf' => is_ppt($type) && !empty($r['pdf']),
        'pdfSize' => (int)($r['pdf_size'] ?? 0),
        'converting' => is_ppt($type) && empty($r['pdf']) && (int)($r['conv_tries'] ?? 0) < 3,
        'id' => (int)$r['id'], 'title' => $r['title'], 'brand' => $r['brand'], 'category' => $r['category'],
        'description' => (string)$r['description'], 'course' => $r['course_id'], 'size' => (int)$r['size'],
        'added' => strtotime($r['created_at'] . ' UTC') * 1000,
    ];
}

// ─── Рейтинг продаж по акциям ───
function sales_norm(string $s): string
{
    $s = mb_strtolower(str_replace(['ё', 'Ё'], 'е', $s));
    return trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s));
}

// Ключ имени без учёта порядка слов: «Швец Инна» и «Инна Швец» совпадают
function sales_name_key(array $words): string
{
    sort($words);
    return implode(' ', $words);
}

// Привязка строк файла к сотрудникам: по логину, затем по ФИО (полностью или по фамилии и имени, в любом порядке), при совпадениях — по аптеке
function sales_matcher(): callable
{
    $byLogin = [];
    $byName = [];
    $byShort = [];
    foreach (q('SELECT id, login, name, branch FROM users WHERE active = 1') as $u) {
        $byLogin[mb_strtolower(trim($u['login']))] = (int)$u['id'];
        $n = sales_norm($u['name']);
        if ($n === '') {
            continue;
        }
        $w = explode(' ', $n);
        $byName[sales_name_key($w)][] = $u;
        if (count($w) >= 2) {
            // «Фамилия Имя» из «Фамилия Имя Отчество» и «Имя Фамилия» — оба варианта первых двух слов
            $byShort[sales_name_key([$w[0], $w[1]])][] = $u;
        }
    }
    $pick = function (array $list, string $branch) {
        if (count($list) === 1) {
            return (int)$list[0]['id'];
        }
        $b = sales_norm($branch);
        foreach ($list as $u) {
            if ($b !== '' && sales_norm($u['branch']) === $b) {
                return (int)$u['id'];
            }
        }
        return null; // однофамильцы без аптеки — не угадываем
    };
    return function (string $login, string $name, string $branch) use ($byLogin, $byName, $byShort, $pick) {
        $l = mb_strtolower(trim($login));
        if ($l !== '' && isset($byLogin[$l])) {
            return $byLogin[$l];
        }
        $n = sales_norm($name);
        if ($n === '') {
            return null;
        }
        $w = explode(' ', $n);
        $full = sales_name_key($w);
        if (isset($byName[$full])) {
            return $pick($byName[$full], $branch);
        }
        if (count($w) >= 2) {
            $short = sales_name_key([$w[0], $w[1]]);
            if (isset($byShort[$short])) {
                return $pick($byShort[$short], $branch);
            }
            if (isset($byName[$short])) {
                return $pick($byName[$short], $branch); // в Академии «Фамилия Имя», в отчёте с отчеством
            }
        }
        return null;
    };
}

// Сводка периода: участники по убыванию показателя (сумма, если она есть в файле, иначе количество)
function sales_board(int $periodId): array
{
    $period = q('SELECT * FROM sales_periods WHERE id = ?', [$periodId])->fetch();
    if (!$period) {
        return [null, [], []];
    }
    $users = [];
    foreach (q('SELECT id, name, branch FROM users') as $u) {
        $users[(int)$u['id']] = $u;
    }
    $people = [];
    $promos = [];
    foreach (q('SELECT * FROM sales_rows WHERE period_id = ?', [$periodId]) as $r) {
        $uid = $r['user_id'] !== null ? (int)$r['user_id'] : null;
        $key = $uid !== null ? 'u' . $uid : 'n' . sales_norm($r['name']) . '|' . sales_norm($r['branch']);
        if (!isset($people[$key])) {
            $u = $uid !== null ? ($users[$uid] ?? null) : null;
            $people[$key] = ['userId' => $uid, 'name' => $u ? $u['name'] : $r['name'],
                             'branch' => $r['branch'] !== '' ? $r['branch'] : ($u ? (string)$u['branch'] : ''),
                             'qty' => 0.0, 'amount' => 0.0, 'promos' => []];
        }
        $p = &$people[$key];
        $p['qty'] += (float)$r['qty'];
        $p['amount'] += (float)$r['amount'];
        $promo = $r['promo'] !== '' ? $r['promo'] : 'Без названия акции';
        if (!isset($p['promos'][$promo])) {
            $p['promos'][$promo] = ['promo' => $promo, 'qty' => 0.0, 'amount' => 0.0];
        }
        $p['promos'][$promo]['qty'] += (float)$r['qty'];
        $p['promos'][$promo]['amount'] += (float)$r['amount'];
        unset($p);
        if (!isset($promos[$promo])) {
            $promos[$promo] = ['promo' => $promo, 'qty' => 0.0, 'amount' => 0.0, 'people' => []];
        }
        $promos[$promo]['qty'] += (float)$r['qty'];
        $promos[$promo]['amount'] += (float)$r['amount'];
        $promos[$promo]['people'][$key] = ($promos[$promo]['people'][$key] ?? 0) + (float)($period['metric'] === 'amount' ? $r['amount'] : $r['qty']);
    }
    $metric = $period['metric'];
    $list = array_values(array_filter($people, function ($p) { return $p['qty'] > 0 || $p['amount'] > 0; }));
    usort($list, function ($a, $b) use ($metric) {
        return [$b[$metric], $b['qty'], $a['name']] <=> [$a[$metric], $a['qty'], $b['name']];
    });
    $place = 0;
    $prev = null;
    foreach ($list as $i => &$p) {
        if ($prev === null || $p[$metric] < $prev) {
            $place = $i + 1;
            $prev = $p[$metric];
        }
        $p['place'] = $place;
        $p['value'] = $p[$metric];
        $p['promos'] = array_values($p['promos']);
        usort($p['promos'], function ($a, $b) use ($metric) { return $b[$metric] <=> $a[$metric]; });
    }
    unset($p);
    foreach ($promos as &$pr) {
        arsort($pr['people']);
        $leaderKey = array_key_first($pr['people']);
        $pr['leader'] = $leaderKey !== null && isset($people[$leaderKey]) ? $people[$leaderKey]['name'] : '';
        $pr['participants'] = count(array_filter($pr['people'], function ($v) { return $v > 0; }));
        unset($pr['people']);
    }
    unset($pr);
    $promos = array_values($promos);
    usort($promos, function ($a, $b) use ($metric) { return $b[$metric] <=> $a[$metric]; });
    return [$period, $list, $promos];
}

// ─── Рейтинг аптек по выполнению плана акций (бланк руководства) ───
// Ключ аптеки по названию: «Аптека № 7, г. Тирасполь…» → a7, «Фп №55, …» / «ФП №55» → fp55
function pharm_key(string $s): string
{
    $s = mb_strtolower(str_replace(['ё', 'Ё'], 'е', $s));
    if (preg_match('/(аптек\w*|ф\.?\s*п\.?|фармпункт\w*|аптечн\w*\s+пункт\w*)\s*№?\s*(\d+)/u', $s, $m)) {
        return (preg_match('/^апте/u', $m[1]) ? 'a' : 'fp') . (int)$m[2];
    }
    return '';
}

// Расчёт по правилам отчёта руководства: план группы = план на фармацевта × фармацевтов аптеки;
// «по количеству» = Σ min(факт; план) / Σ план; итоговый % = среднее min(факт/план; 100%) по группам;
// бренд: «по ассортименту» = среднее зачётных процентов групп бренда по всем аптекам, оценка = минимум из двух.
function sales_pharm_report(array $d): array
{
    $pharm = $d['pharmacies'] ?? [];
    $groups = $d['groups'] ?? [];
    $n = count($pharm);
    $list = [];
    foreach ($pharm as $k => $p) {
        $cnt = (float)($p['pharmacists'] ?? 0);
        $plan = $fact = $cred = 0.0;
        $pcts = [];
        $gl = [];
        foreach ($groups as $g) {
            $gp = (float)$g['plan1'] * $cnt;
            $gf = (float)($g['fact'][$k] ?? 0);
            $plan += $gp;
            $fact += $gf;
            $cred += min($gf, $gp);
            if ($gp > 0) {
                $pcts[] = min($gf / $gp, 1);
            }
            $gl[] = ['name' => $g['name'], 'brand' => $g['brand'] ?? '', 'plan' => round($gp, 3), 'fact' => round($gf, 3), 'pct' => $gp > 0 ? round($gf / $gp, 4) : null];
        }
        $name = trim((string)$p['name']);
        $parts = explode(',', $name, 2);
        $list[] = ['idx' => $k, 'name' => $name, 'short' => trim($parts[0]), 'address' => trim($parts[1] ?? ''), 'key' => pharm_key($name), 'pharmacists' => $cnt,
                   'plan' => round($plan, 3), 'fact' => round($fact, 3), 'pctOver' => $plan > 0 ? round($fact / $plan, 4) : 0,
                   'pctQty' => $plan > 0 ? round($cred / $plan, 4) : 0, 'pctAvg' => $pcts ? round(array_sum($pcts) / count($pcts), 4) : 0, 'groups' => $gl];
    }
    usort($list, function ($a, $b) { return [$b['pctAvg'], $b['pctQty'], $a['name']] <=> [$a['pctAvg'], $a['pctQty'], $b['name']]; });
    $place = 0;
    $prev = null;
    foreach ($list as $i => &$p) {
        if ($prev === null || $p['pctAvg'] < $prev) {
            $place = $i + 1;
            $prev = $p['pctAvg'];
        }
        $p['place'] = $place;
    }
    unset($p);
    $totalPh = array_sum(array_map(function ($p) { return (float)($p['pharmacists'] ?? 0); }, $pharm));
    $brands = [];
    $positions = [];
    foreach ($groups as $g) {
        $b = (string)($g['brand'] ?? '');
        $gfact = 0.0;
        if (!isset($brands[$b])) {
            $brands[$b] = ['brand' => $b, 'plan' => 0.0, 'fact' => 0.0, 'credited' => 0.0, 'pcts' => [], 'groups' => 0];
        }
        $brands[$b]['groups']++;
        foreach ($pharm as $k => $p) {
            $gp = (float)$g['plan1'] * (float)($p['pharmacists'] ?? 0);
            $gf = (float)($g['fact'][$k] ?? 0);
            $gfact += $gf;
            $brands[$b]['credited'] += min($gf, $gp);
            if ($gp > 0) {
                $brands[$b]['pcts'][] = min($gf / $gp, 1);
            }
        }
        $gplan = (float)$g['plan1'] * $totalPh;
        $brands[$b]['plan'] += $gplan;
        $brands[$b]['fact'] += $gfact;
        $pct = $gplan > 0 ? $gfact / $gplan : 0;
        $positions[] = ['brand' => $b, 'name' => $g['name'], 'plan1' => (float)$g['plan1'], 'plan' => round($gplan, 3), 'fact' => round($gfact, 3), 'pct' => round($pct, 4),
                        'zone' => $pct >= 0.5 ? 'top' : ($pct >= 0.3 ? 'mid' : 'low')];
    }
    $brands = array_values(array_map(function ($b) {
        $q = $b['plan'] > 0 ? $b['credited'] / $b['plan'] : 0;
        $a = $b['pcts'] ? array_sum($b['pcts']) / count($b['pcts']) : 0;
        return ['brand' => $b['brand'], 'plan' => round($b['plan'], 3), 'fact' => round($b['fact'], 3), 'credited' => round($b['credited'], 3),
                'pctQty' => round($q, 4), 'pctAssort' => round($a, 4), 'score' => round(min($q, $a), 4), 'groups' => $b['groups']];
    }, $brands));
    usort($brands, function ($a, $b) { return $b['score'] <=> $a['score']; });
    usort($positions, function ($a, $b) { return $b['pct'] <=> $a['pct']; });
    return ['pharmacies' => $list, 'brands' => $brands, 'positions' => $positions, 'groupsCount' => count($groups), 'pharmacists' => $totalPh];
}

// Ключ аптеки для группировки сотрудников: номер аптеки/ФП, иначе название как есть
function pharm_group_key(string $branch): string
{
    $k = pharm_key($branch);
    return $k !== '' ? $k : (sales_norm($branch) !== '' ? 'n' . sales_norm($branch) : '');
}

// Бланк по продавцам: колонки — сотрудники (ФИО), план на 1 фармацевта у каждого свой.
// Продавцы считаются по тем же правилам, что и аптеки; аптека = сумма её продавцов (план × число продавцов).
function sales_plan_people(array $d): array
{
    $people = array_values($d['people'] ?? []);
    $groups = $d['groups'] ?? [];
    $match = sales_matcher();
    $users = [];
    foreach (q('SELECT id, name, branch FROM users') as $u) {
        $users[(int)$u['id']] = $u;
    }
    $info = [];
    foreach ($people as $k => $p) {
        $name = trim((string)($p['name'] ?? ''));
        $branch = trim((string)($p['branch'] ?? ''));
        $uid = $match('', $name, $branch);
        if ($branch === '' && $uid !== null && isset($users[$uid])) {
            $branch = trim((string)$users[$uid]['branch']);
        }
        $info[$k] = ['name' => $name, 'branch' => $branch, 'userId' => $uid];
    }
    $pr = sales_pharm_report(['pharmacies' => array_map(function ($p) { return ['name' => str_replace(',', ' ', $p['name']), 'pharmacists' => 1]; }, $info), 'groups' => $groups]);
    $sellers = [];
    foreach ($pr['pharmacies'] as $x) {
        $i = $info[$x['idx']];
        $sellers[] = ['place' => $x['place'], 'name' => $i['name'], 'branch' => $i['branch'], 'userId' => $i['userId'],
                      'plan' => $x['plan'], 'fact' => $x['fact'], 'pctOver' => $x['pctOver'], 'pctQty' => $x['pctQty'], 'pctAvg' => $x['pctAvg'],
                      'done' => count(array_filter($x['groups'], function ($g) { return $g['pct'] !== null && $g['pct'] >= 1; })), 'groups' => $x['groups']];
    }
    // Аптеки: складываем продавцов с одинаковой аптекой
    $ph = [];
    foreach ($info as $k => $i) {
        $key = pharm_group_key($i['branch']);
        if ($key === '') {
            continue;
        }
        if (!isset($ph[$key])) {
            $ph[$key] = ['name' => $i['branch'], 'cols' => []];
        }
        $ph[$key]['cols'][] = $k;
    }
    $ph = array_values($ph);
    $gs = [];
    foreach ($groups as $g) {
        $f = [];
        foreach ($ph as $x) {
            $sum = 0.0;
            foreach ($x['cols'] as $c) {
                $sum += (float)($g['fact'][$c] ?? 0);
            }
            $f[] = $sum;
        }
        $gs[] = ['fact' => $f] + $g;
    }
    $ar = $ph ? sales_pharm_report(['pharmacies' => array_map(function ($x) { return ['name' => $x['name'], 'pharmacists' => count($x['cols'])]; }, $ph), 'groups' => $gs]) : null;
    foreach ($ar ? $ar['pharmacies'] : [] as $j => $x) {
        $ar['pharmacies'][$j]['key'] = pharm_group_key($ph[$x['idx']]['name']);
    }
    return [
        'sellers' => $sellers,
        'noBranch' => count(array_filter($info, function ($i) { return $i['branch'] === ''; })),
        'pharmacies' => $ar ? $ar['pharmacies'] : [],
        // Бренды и позиции — по всей сети продавцов
        'brands' => $pr['brands'], 'positions' => $pr['positions'], 'groupsCount' => $pr['groupsCount'], 'pharmacists' => count($people),
    ];
}

// Таблица продаж по сотрудникам (без плана): аптека = сумма продаж её сотрудников
function sales_people_pharm(array $list, string $metric): array
{
    $ph = [];
    foreach ($list as $p) {
        $key = pharm_group_key((string)$p['branch']);
        if ($key === '') {
            continue;
        }
        if (!isset($ph[$key])) {
            $ph[$key] = ['key' => $key, 'name' => (string)$p['branch'], 'people' => 0, 'qty' => 0.0, 'amount' => 0.0];
        }
        $ph[$key]['people']++;
        $ph[$key]['qty'] += (float)$p['qty'];
        $ph[$key]['amount'] += (float)$p['amount'];
    }
    $ph = array_values($ph);
    usort($ph, function ($a, $b) use ($metric) { return [$b[$metric], $a['name']] <=> [$a[$metric], $b['name']]; });
    $place = 0;
    $prev = null;
    foreach ($ph as $i => &$x) {
        if ($prev === null || $x[$metric] < $prev) {
            $place = $i + 1;
            $prev = $x[$metric];
        }
        $x['place'] = $place;
        $x['qty'] = round($x['qty'], 2);
        $x['amount'] = round($x['amount'], 2);
    }
    unset($x);
    return $ph;
}

