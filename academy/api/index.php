<?php
// API Viva Academy: api/index.php?action=<действие>
// Ответы — JSON. Изменяющие запросы — POST с заголовком X-CSRF-Token.

declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/notify.php';

set_exception_handler(function (Throwable $e) {
    error_log('[viva-academy] ' . $e->getMessage());
    fail(500, 'server', 'Ошибка сервера. Попробуйте позже.');
});

start_session();
migrate();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Вебхук Telegram: проверяется секрет, который сайт передал боту при подключении
if ($action === 'tg_webhook') {
    $secret = setting('tg_secret');
    if ($secret === '' || !hash_equals($secret, (string)($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? ''))) {
        fail(403, 'forbidden', 'Нет доступа.');
    }
    $upd = json_decode(file_get_contents('php://input') ?: '', true);
    if (is_array($upd)) {
        tg_handle_update($upd);
    }
    json_out(['ok' => true]);
}

// Регулярные задачи (напоминания, объявления о новых курсах). Безопасно вызывать часто: работа идёт не чаще раза в минуту.
if ($action === 'cron') {
    try {
        json_out(['ok' => true] + notify_tick());
    } catch (Throwable $e) {
        error_log('[viva-academy] cron: ' . $e->getMessage());
        json_out(['ok' => false, 'error' => mb_substr(get_class($e) . ': ' . $e->getMessage(), 0, 300)], 500);
    }
}

// Публичная проверка сертификата
if ($action === 'cert') {
    $id = substr((string)($_GET['id'] ?? ''), 0, 40);
    $r = q('SELECT u.name, r.course_id, r.passed_at, r.best FROM quiz_results r
            JOIN users u ON u.id = r.user_id WHERE r.cert_id = ?', [$id])->fetch();
    if (!$r) {
        // Сертификат по тесту с прежнего сайта тестирования
        try {
            $e = q('SELECT u.name, e.test, e.taken_at, e.score FROM external_results e
                    JOIN users u ON u.id = e.user_id WHERE e.cert_no = ? AND e.cert_no <> \'\' AND e.passed = 1', [$id])->fetch();
        } catch (Throwable $ex) {
            $e = false;
        }
        if (!$e) {
            fail(404, 'not_found', 'Сертификат не найден.');
        }
        json_out([
            'name' => $e['name'],
            'course' => $e['test'],
            'passedAt' => $e['taken_at'] ? strtotime($e['taken_at'] . ' UTC') * 1000 : null,
            'score' => (float)$e['score'] / 100,
        ]);
    }
    $c = courses()[$r['course_id']] ?? ['title' => $r['course_id']];
    json_out([
        'name' => $r['name'],
        'course' => $c['title'],
        'passedAt' => strtotime($r['passed_at'] . ' UTC') * 1000,
        'score' => (float)$r['best'],
    ]);
}

if ($action === 'me') {
    // Попутно — напоминания и объявления (после ответа, если сервер это умеет)
    // Ошибка здесь не должна портить ответ странице: ловим всё и только пишем в журнал.
    register_shutdown_function(function () {
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        }
        try {
            notify_tick();
        } catch (Throwable $e) {
            error_log('[viva-academy] tick: ' . $e->getMessage());
        }
    });
    try {
        $u = current_user();
        $selfRegister = setting('invite_code') !== '';
    } catch (PDOException $e) {
        fail(503, 'not_installed', 'Платформа ещё не установлена. Администратору: откройте api/install.php.');
    }
    json_out([
        'user' => $u ? public_user($u) : null,
        'progress' => $u ? user_progress((int)$u['id']) : null,
        'csrf' => $_SESSION['csrf'],
        'passScore' => (float)config()['pass_score'],
        'selfRegister' => $selfRegister,
        // Номер выкладки: по нему открытая страница узнаёт, что вышла новая версия
        // Сводные цифры для главной — только вошедшим сотрудникам, без персональных данных
        'stats' => $u ? [
            'staff' => (int)q("SELECT COUNT(*) FROM users WHERE role = 'user' AND active = 1")->fetchColumn(),
            'certs' => (int)q('SELECT COUNT(*) FROM quiz_results WHERE passed_at IS NOT NULL')->fetchColumn() + external_passed_total(),
        ] : null,
        'version' => is_file(__DIR__ . '/version.txt') ? trim((string)file_get_contents(__DIR__ . '/version.txt')) : '',
    ]);
}

// Учебные материалы: список и файл — только вошедшим
if ($action === 'materials') {
    require_user();
    try {
        $rows = q('SELECT * FROM materials ORDER BY created_at DESC, id DESC')->fetchAll();
    } catch (Throwable $e) {
        $rows = [];
    }
    json_out(['materials' => array_map('material_row', $rows)]);
}
if ($action === 'material_file') {
    require_user();
    // Сессию отпускаем сразу: видео грузится долго и параллельными запросами, а сессия блокирует другие запросы
    session_write_close();
    $m = q('SELECT * FROM materials WHERE id = ?', [(int)($_GET['id'] ?? 0)])->fetch();
    if (!$m) {
        fail(404, 'not_found', 'Материал не найден.');
    }
    // Видео по ссылке хранится не у нас — отправляем на источник
    if (!empty($m['link'])) {
        header('Location: ' . $m['link'], true, 302);
        exit;
    }
    $type = material_type((string)$m['original_name']);
    // У презентации PowerPoint по умолчанию отдаём PDF-копию (если готова), с orig=1 — исходный файл
    $usePdf = is_ppt($type) && !empty($m['pdf']) && empty($_GET['orig']);
    $kind = $usePdf ? 'pdf' : $type;
    $origExt = strtolower(pathinfo((string)$m['original_name'], PATHINFO_EXTENSION));
    $ext = $kind === 'pdf' ? '.pdf' : '.' . $origExt;
    $name = preg_replace('/[^\p{L}\p{N} ._-]+/u', '', $m['title']) ?: 'material';
    $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '_', pathinfo((string)$m['original_name'], PATHINFO_FILENAME));
    $ascii = preg_match('/[A-Za-z0-9]{2}/', $ascii) ? $ascii . $ext : 'vivaacademy-material-' . (int)$m['id'] . $ext;
    $videoMime = ['mov' => 'video/quicktime', 'webm' => 'video/webm'];
    $mime = ['pdf' => 'application/pdf', 'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'ppt' => 'application/vnd.ms-powerpoint', 'video' => $videoMime[$origExt] ?? 'video/mp4'];
    $size = (int)($usePdf ? $m['pdf_size'] : $m['size']);
    @set_time_limit(0);
    header('Content-Type: ' . $mime[$kind]);
    header('Cache-Control: private, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    header('Accept-Ranges: bytes');
    // PowerPoint браузер показать не может — всегда отдаём как скачивание; PDF и видео — смотреть на сайте
    header('Content-Disposition: ' . (!empty($_GET['dl']) || is_ppt($kind) ? 'attachment' : 'inline')
        . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($name . $ext));
    // Перемотка видео: браузер просит часть файла (Range: bytes=начало-конец)
    $from = 0;
    $to = $size - 1;
    if (preg_match('/^bytes=(\d*)-(\d*)$/', (string)($_SERVER['HTTP_RANGE'] ?? ''), $rg) && ($rg[1] !== '' || $rg[2] !== '')) {
        if ($rg[1] === '') {
            $from = max(0, $size - (int)$rg[2]);
        } else {
            $from = (int)$rg[1];
            $to = $rg[2] === '' ? $size - 1 : min((int)$rg[2], $size - 1);
        }
        if ($from > $to || $from >= $size) {
            http_response_code(416);
            header('Content-Range: bytes */' . $size);
            exit;
        }
        http_response_code(206);
        header('Content-Range: bytes ' . $from . '-' . $to . '/' . $size);
    }
    header('Content-Length: ' . ($to - $from + 1));
    stream_upload($usePdf ? $m['pdf'] : $m['file'], $from, $to);
    exit;
}

// Конвертер презентаций PowerPoint → PDF (GitHub Actions, tools/convert-materials.py). Доступ — по ключу выкладки.
if (strpos($action, 'conv_') === 0) {
    if (!conv_key_ok()) {
        fail(403, 'forbidden', 'Нет доступа.');
    }
    if ($action === 'conv_next') {
        foreach (q('SELECT id, original_name, size, conv_tries FROM materials WHERE pdf IS NULL AND conv_tries < 3 ORDER BY id') as $r) {
            if (is_ppt(material_type((string)$r['original_name']))) {
                json_out(['material' => ['id' => (int)$r['id'], 'name' => $r['original_name'], 'size' => (int)$r['size']]]);
            }
        }
        json_out(['material' => null]);
    }
    if ($action === 'conv_source') {
        $m = q('SELECT file, size FROM materials WHERE id = ?', [(int)($_GET['id'] ?? 0)])->fetch();
        if (!$m) {
            fail(404, 'not_found', 'Материал не найден.');
        }
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . (int)$m['size']);
        stream_upload($m['file']);
        exit;
    }
    if ($action === 'conv_chunk') {
        $token = preg_replace('/[^a-f0-9]/', '', str_in('upload', 64));
        $index = (int)(input()['index'] ?? -1);
        $data = base64_decode((string)(input()['data'] ?? ''), true);
        if (strlen($token) !== 32 || $index < 0 || $index > 400 || $data === false || $data === '' || strlen($data) > 1024 * 1024) {
            fail(422, 'invalid', 'Некорректная часть файла.');
        }
        if ($index === 0) {
            if (material_magic($data) !== 'pdf') {
                fail(422, 'invalid', 'Это не PDF.');
            }
            q('DELETE FROM material_chunks WHERE upload = ?', [$token]);
        } elseif ((int)q('SELECT COUNT(*) FROM material_chunks WHERE upload = ?', [$token])->fetchColumn() !== $index) {
            fail(409, 'order', 'Нарушен порядок частей.');
        }
        put_chunk($token, $index, $data);
        json_out(['ok' => true]);
    }
    if ($action === 'conv_done' || $action === 'conv_fail') {
        $id = (int)(input()['id'] ?? 0);
        if ($action === 'conv_fail') {
            q('UPDATE materials SET conv_tries = conv_tries + 1, conv_error = ? WHERE id = ?', [str_in('error', 300), $id]);
            json_out(['ok' => true]);
        }
        $token = preg_replace('/[^a-f0-9]/', '', str_in('upload', 64));
        $size = strlen($token) === 32 ? upload_size($token) : 0;
        if (!$size) {
            fail(422, 'invalid', 'PDF не загружен.');
        }
        $old = q('SELECT pdf FROM materials WHERE id = ?', [$id])->fetchColumn();
        q("UPDATE materials SET pdf = ?, pdf_size = ?, conv_error = '' WHERE id = ?", [$token, $size, $id]);
        if ($old && $old !== $token) {
            q('DELETE FROM material_chunks WHERE upload = ?', [$old]);
        }
        json_out(['ok' => true, 'size' => $size]);
    }
    fail(404, 'not_found', 'Неизвестное действие.');
}

// Афиша мероприятий
if ($action === 'events') {
    $u = require_user();
    $up = q('SELECT * FROM events WHERE starts_at > ? ORDER BY starts_at', [gmdate('Y-m-d H:i:s', time() - 3 * 3600)])->fetchAll();
    $past = q('SELECT * FROM events WHERE starts_at <= ? ORDER BY starts_at DESC LIMIT 10', [gmdate('Y-m-d H:i:s', time() - 3 * 3600)])->fetchAll();
    $row = function ($e) use ($u) {
        return event_row($e, (int)$u['id']);
    };
    json_out(['upcoming' => array_map($row, $up), 'past' => array_map($row, $past),
              'telegram' => ['bot' => setting('tg_bot'), 'linked' => tg_chat_of((int)$u['id']) !== null]]);
}
if ($action === 'event_regs') {
    require_viewer();
    $rows = q('SELECT u.name, u.login, u.branch, r.created_at, t.chat_id FROM event_regs r JOIN users u ON u.id = r.user_id
               LEFT JOIN tg_links t ON t.user_id = r.user_id WHERE r.event_id = ? ORDER BY u.branch, u.name', [(int)($_GET['id'] ?? 0)])->fetchAll();
    json_out(['people' => array_map(function ($r) {
        return ['name' => $r['name'], 'login' => $r['login'], 'branch' => $r['branch'], 'at' => $r['created_at'], 'tg' => $r['chat_id'] !== null];
    }, $rows)]);
}
if ($action === 'tg_status') {
    $u = require_user();
    $bot = setting('tg_bot');
    json_out(['bot' => $bot, 'linked' => tg_chat_of((int)$u['id']) !== null, 'link' => $bot !== '' ? tg_link_for((int)$u['id']) : null]);
}

// Топ-10 по результатам тестов — для всех вошедших сотрудников
if ($action === 'top') {
    $u = require_user();
    $all = rating();
    $mine = null;
    foreach ($all as $i => $r) {
        if ($r['id'] === (int)$u['id']) {
            $mine = $r;
            break;
        }
    }
    $strip = function ($r) use ($u) {
        $r['isMe'] = $r['id'] === (int)$u['id'];
        unset($r['id']);
        return $r;
    };
    json_out([
        'top' => array_map($strip, array_slice($all, 0, 10)),
        'me' => $mine ? $strip($mine) : null,
        'total' => count($all),
    ]);
}

// Только чтение — GET, всё остальное — POST с CSRF-токеном
$readOnly = in_array($action, ['admin_users', 'admin_export'], true);
if ($method !== 'POST' && !$readOnly) {
    fail(405, 'method', 'Ожидается POST.');
}
if (!$readOnly) {
    check_csrf();
}

switch ($action) {
    case 'login':
        q('DELETE FROM login_attempts WHERE at < ?', [gmdate('Y-m-d H:i:s', time() - 900)]);
        $tries = (int)q('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [client_ip()])->fetchColumn();
        if ($tries >= 10) {
            fail(429, 'too_many', 'Слишком много попыток. Подождите 15 минут.');
        }
        $u = q('SELECT * FROM users WHERE login = ?', [mb_strtolower(str_in('login'))])->fetch();
        if (!$u || !$u['active'] || !password_verify((string)(input()['password'] ?? ''), $u['password_hash'])) {
            q('INSERT INTO login_attempts (ip, at) VALUES (?, ?)', [client_ip(), now()]);
            fail(401, 'bad_credentials', 'Неверный логин или пароль.');
        }
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id'];
        q('UPDATE users SET last_login = ? WHERE id = ?', [now(), $u['id']]);
        json_out(['user' => public_user($u), 'progress' => user_progress((int)$u['id'])]);

    case 'logout':
        $_SESSION = ['csrf' => bin2hex(random_bytes(16))];
        session_regenerate_id(true);
        json_out(['ok' => true, 'csrf' => $_SESSION['csrf']]);

    case 'register':
        $code = setting('invite_code');
        if ($code === '' || !hash_equals($code, str_in('code', 60))) {
            fail(403, 'bad_code', 'Неверный код приглашения. Узнайте его у руководителя.');
        }
        $login = mb_strtolower(str_in('login'));
        $name = str_in('name');
        $password = (string)(input()['password'] ?? '');
        if (!valid_login($login) || $name === '' || mb_strlen($password) < 8) {
            fail(422, 'invalid', 'Заполните ФИО, логин (от 3 символов) и пароль (от 8 символов).');
        }
        if (q('SELECT 1 FROM users WHERE login = ?', [$login])->fetchColumn()) {
            fail(409, 'exists', 'Такой логин уже занят.');
        }
        q('INSERT INTO users (login, name, branch, position, role, password_hash, active, created_at, last_login)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
          [$login, $name, str_in('branch'), str_in('position'), 'user', password_hash($password, PASSWORD_DEFAULT), now(), now()]);
        $uid = (int)db()->lastInsertId();
        session_regenerate_id(true);
        $_SESSION['uid'] = $uid;
        json_out(['user' => public_user(current_user()), 'progress' => user_progress($uid)]);

    case 'lesson':
        $u = require_user();
        $course = courses()[str_in('course', 40)] ?? null;
        $idx = (int)(input()['lesson'] ?? -1);
        if (!$course || $idx < 0 || $idx >= $course['lessons']) {
            fail(422, 'invalid', 'Неизвестный урок.');
        }
        $exists = q('SELECT 1 FROM lesson_progress WHERE user_id = ? AND course_id = ? AND lesson_idx = ?',
                    [$u['id'], str_in('course', 40), $idx])->fetchColumn();
        if (!$exists) {
            q('INSERT INTO lesson_progress (user_id, course_id, lesson_idx, done_at) VALUES (?, ?, ?, ?)',
              [$u['id'], str_in('course', 40), $idx, now()]);
        }
        json_out(['progress' => user_progress((int)$u['id'])]);

    case 'quiz':
        $u = require_user();
        $cid = str_in('course', 40);
        $course = courses()[$cid] ?? null;
        $answers = input()['answers'] ?? null;
        if (!$course || !is_array($answers) || count($answers) !== count($course['answers'])) {
            fail(422, 'invalid', 'Некорректные ответы.');
        }
        $correct = 0;
        foreach ($course['answers'] as $i => $key) {
            if ((int)$answers[$i] === $key) {
                $correct++;
            }
        }
        $total = count($course['answers']);
        $score = $correct / $total;
        $passed = $score >= (float)config()['pass_score'];

        $prev = q('SELECT * FROM quiz_results WHERE user_id = ? AND course_id = ?', [$u['id'], $cid])->fetch();
        if ($prev) {
            $passedAt = $prev['passed_at'] ?: ($passed ? now() : null);
            $certId = $prev['cert_id'] ?: ($passed ? make_cert_id($cid) : null);
            q('UPDATE quiz_results SET best = ?, attempts = attempts + 1, passed_at = ?, cert_id = ?
               WHERE user_id = ? AND course_id = ?',
              [max((float)$prev['best'], $score), $passedAt, $certId, $u['id'], $cid]);
        } else {
            q('INSERT INTO quiz_results (user_id, course_id, best, attempts, passed_at, cert_id) VALUES (?, ?, ?, 1, ?, ?)',
              [$u['id'], $cid, $score, $passed ? now() : null, $passed ? make_cert_id($cid) : null]);
        }
        json_out(['correct' => $correct, 'total' => $total, 'passed' => $passed, 'progress' => user_progress((int)$u['id'])]);

    case 'profile':
        $u = require_user();
        $name = str_in('name');
        if ($name === '') {
            fail(422, 'invalid', 'Укажите имя и фамилию.');
        }
        q('UPDATE users SET name = ?, branch = ?, position = ? WHERE id = ?',
          [$name, str_in('branch'), str_in('position'), $u['id']]);
        json_out(['user' => public_user(current_user())]);

    case 'password':
        $u = require_user();
        $new = (string)(input()['new'] ?? '');
        if (!password_verify((string)(input()['old'] ?? ''), $u['password_hash'])) {
            fail(422, 'bad_password', 'Текущий пароль указан неверно.');
        }
        if (mb_strlen($new) < 8) {
            fail(422, 'invalid', 'Новый пароль — не короче 8 символов.');
        }
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
        json_out(['ok' => true]);

    /* ── Администрирование ── */

    case 'admin_users':
        $viewer = require_viewer();
        $lessons = [];
        foreach (q('SELECT user_id, course_id, COUNT(*) AS n FROM lesson_progress GROUP BY user_id, course_id') as $r) {
            $lessons[$r['user_id']][$r['course_id']] = (int)$r['n'];
        }
        $quiz = [];
        foreach (q('SELECT user_id, course_id, best, attempts, passed_at, cert_id FROM quiz_results') as $r) {
            $quiz[$r['user_id']][$r['course_id']] = [
                'best' => (float)$r['best'],
                'attempts' => (int)$r['attempts'],
                'passed' => $r['passed_at'] !== null,
                'certId' => $r['cert_id'],
            ];
        }
        $ext = [];
        try {
            $extRows = q('SELECT user_id, test, score, passed, taken_at, attempts FROM external_results')->fetchAll();
        } catch (Throwable $e) {
            $extRows = [];
        }
        foreach ($extRows as $r) {
            $ext[$r['user_id']][] = [
                'test' => $r['test'], 'score' => (float)$r['score'], 'passed' => (bool)$r['passed'],
                'attempts' => (int)$r['attempts'], 'date' => $r['taken_at'],
            ];
        }
        $users = [];
        foreach (q('SELECT * FROM users ORDER BY name') as $r) {
            $users[] = public_user($r) + [
                'active' => (bool)$r['active'],
                'createdAt' => $r['created_at'],
                'lastLogin' => $r['last_login'],
                'lessons' => (object)($lessons[$r['id']] ?? []),
                'quiz' => (object)($quiz[$r['id']] ?? []),
                'external' => $ext[$r['id']] ?? [],
            ];
        }
        json_out(['users' => $users, 'inviteCode' => $viewer['role'] === 'admin' ? setting('invite_code') : '',
                  'telegram' => ['bot' => setting('tg_bot'),
                                 'linked' => (int)q('SELECT COUNT(*) FROM tg_links WHERE chat_id IS NOT NULL')->fetchColumn()],
                  'converter' => $viewer['role'] === 'admin' && setting('gh_token') !== '']);

    case 'admin_user_save':
        $me = require_admin();
        $id = (int)(input()['id'] ?? 0);
        $login = mb_strtolower(str_in('login'));
        $name = str_in('name');
        $role = in_array(str_in('role'), ['admin', 'manager'], true) ? str_in('role') : 'user';
        $active = !empty(input()['active']) ? 1 : 0;
        $password = (string)(input()['password'] ?? '');
        if (!valid_login($login) || $name === '') {
            fail(422, 'invalid', 'Укажите ФИО и логин (латиница, цифры, . _ @ - от 3 символов).');
        }
        if ($password !== '' && mb_strlen($password) < 8) {
            fail(422, 'invalid', 'Пароль — не короче 8 символов.');
        }
        $dup = q('SELECT id FROM users WHERE login = ? AND id <> ?', [$login, $id])->fetchColumn();
        if ($dup) {
            fail(409, 'exists', 'Такой логин уже занят.');
        }
        if ($id) {
            if ($id === (int)$me['id'] && ($role !== 'admin' || !$active)) {
                fail(422, 'self', 'Нельзя снять права или заблокировать самого себя.');
            }
            q('UPDATE users SET login = ?, name = ?, branch = ?, position = ?, role = ?, active = ? WHERE id = ?',
              [$login, $name, str_in('branch'), str_in('position'), $role, $active, $id]);
            if ($password !== '') {
                q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $id]);
            }
        } else {
            if ($password === '') {
                fail(422, 'invalid', 'Задайте пароль для нового сотрудника.');
            }
            q('INSERT INTO users (login, name, branch, position, role, password_hash, active, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [$login, $name, str_in('branch'), str_in('position'), $role, password_hash($password, PASSWORD_DEFAULT), $active, now()]);
        }
        json_out(['ok' => true]);

    case 'admin_import':
        require_admin();
        // Хеширование паролей для сотен сотрудников занимает время
        @set_time_limit(300);
        $rows = input()['rows'] ?? [];
        if (!is_array($rows) || count($rows) > 2000) {
            fail(422, 'invalid', 'Некорректный список.');
        }
        $created = [];
        $skipped = [];
        db()->beginTransaction();
        foreach ($rows as $row) {
            $login = mb_strtolower(mb_substr(trim((string)($row['login'] ?? '')), 0, 120));
            $name = mb_substr(trim((string)($row['name'] ?? '')), 0, 120);
            if (!valid_login($login) || $name === '') {
                $skipped[] = ['login' => $login, 'reason' => 'неверные данные'];
                continue;
            }
            if (q('SELECT 1 FROM users WHERE login = ?', [$login])->fetchColumn()) {
                $skipped[] = ['login' => $login, 'reason' => 'логин занят'];
                continue;
            }
            $password = trim((string)($row['password'] ?? ''));
            if (mb_strlen($password) < 8) {
                $password = substr(str_replace(['+', '/', '='], '', base64_encode(random_bytes(9))), 0, 10);
            }
            q('INSERT INTO users (login, name, branch, position, role, password_hash, active, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
              [$login, $name, mb_substr(trim((string)($row['branch'] ?? '')), 0, 120),
               mb_substr(trim((string)($row['position'] ?? '')), 0, 120), 'user',
               password_hash($password, PASSWORD_DEFAULT), now()]);
            $created[] = ['login' => $login, 'name' => $name, 'password' => $password,
                          'branch' => mb_substr(trim((string)($row['branch'] ?? '')), 0, 120)];
        }
        db()->commit();
        json_out(['created' => $created, 'skipped' => $skipped]);

    case 'admin_import_results':
        // Результаты со старого сайта тестирования: лучшая попытка сотрудника по каждому тесту.
        // Повторный импорт того же файла ничего не дублирует, а более высокий балл заменяет прежний.
        require_admin();
        @set_time_limit(300);
        $rows = input()['rows'] ?? [];
        if (!is_array($rows) || count($rows) > 5000) {
            fail(422, 'invalid', 'Некорректный список.');
        }
        $ids = [];
        foreach (q('SELECT id, login FROM users') as $u) {
            $ids[$u['login']] = (int)$u['id'];
        }
        $added = 0; $updated = 0; $same = 0; $unknown = [];
        db()->beginTransaction();
        foreach ($rows as $row) {
            $login = mb_strtolower(trim((string)($row['login'] ?? '')));
            $test = mb_substr(trim((string)($row['test'] ?? '')), 0, 200);
            if ($test === '' || !isset($ids[$login])) {
                $unknown[$login] = true;
                continue;
            }
            $score = max(0, min(100, (float)($row['score'] ?? 0)));
            $date = strtotime((string)($row['date'] ?? ''));
            $vals = [$score, (int)($row['correct'] ?? 0), (int)($row['total'] ?? 0), !empty($row['passed']) ? 1 : 0,
                     $date ? gmdate('Y-m-d H:i:s', $date) : null, max(1, (int)($row['attempts'] ?? 1)),
                     mb_substr(trim((string)($row['cert'] ?? '')), 0, 80)];
            $prev = q('SELECT score FROM external_results WHERE user_id = ? AND test = ?', [$ids[$login], $test])->fetchColumn();
            if ($prev === false) {
                q('INSERT INTO external_results (score, correct, total, passed, taken_at, attempts, cert_no, user_id, test)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', array_merge($vals, [$ids[$login], $test]));
                $added++;
            } elseif ($score > (float)$prev) {
                q('UPDATE external_results SET score = ?, correct = ?, total = ?, passed = ?, taken_at = ?, attempts = ?, cert_no = ?
                   WHERE user_id = ? AND test = ?', array_merge($vals, [$ids[$login], $test]));
                $updated++;
            } else {
                $same++;
            }
        }
        db()->commit();
        json_out(['added' => $added, 'updated' => $updated, 'unchanged' => $same, 'unknownLogins' => array_keys($unknown)]);

    case 'admin_reset_progress':
        require_admin();
        $id = (int)(input()['id'] ?? 0);
        q('DELETE FROM lesson_progress WHERE user_id = ?', [$id]);
        q('DELETE FROM quiz_results WHERE user_id = ?', [$id]);
        json_out(['ok' => true]);

    case 'admin_delete':
        $me = require_admin();
        $id = (int)(input()['id'] ?? 0);
        if ($id === (int)$me['id']) {
            fail(422, 'self', 'Нельзя удалить самого себя.');
        }
        q('DELETE FROM lesson_progress WHERE user_id = ?', [$id]);
        q('DELETE FROM quiz_results WHERE user_id = ?', [$id]);
        q('DELETE FROM external_results WHERE user_id = ?', [$id]);
        q('DELETE FROM users WHERE id = ?', [$id]);
        json_out(['ok' => true]);

    case 'admin_settings':
        require_admin();
        $code = str_in('inviteCode', 60);
        if ($code !== '' && mb_strlen($code) < 6) {
            fail(422, 'invalid', 'Код приглашения — не короче 6 символов.');
        }
        set_setting('invite_code', $code);
        json_out(['ok' => true]);

    case 'admin_export':
        require_viewer();
        $list = courses();
        $lessons = [];
        foreach (q('SELECT user_id, course_id, COUNT(*) AS n FROM lesson_progress GROUP BY user_id, course_id') as $r) {
            $lessons[$r['user_id']][$r['course_id']] = (int)$r['n'];
        }
        $quiz = [];
        foreach (q('SELECT user_id, course_id, best, passed_at FROM quiz_results') as $r) {
            $quiz[$r['user_id']][$r['course_id']] = $r;
        }
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="viva-academy-progress-' . gmdate('Y-m-d') . '.csv"');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF"); // BOM, чтобы Excel открыл кириллицу
        $extPassed = [];
        try {
            foreach (q('SELECT user_id, test FROM external_results WHERE passed = 1')->fetchAll() as $r) {
                $extPassed[$r['user_id']][$r['test']] = true;
            }
        } catch (Throwable $e) {
            // таблицы нет — колонка останется пустой
        }
        $head = ['ФИО', 'Логин', 'Аптека / филиал', 'Должность', 'Последний вход', 'Общий прогресс, %', 'Сертификатов', 'Сдано тестов до запуска Академии'];
        foreach ($list as $c) {
            $head[] = $c['title'];
        }
        fputcsv($out, $head, ';');
        foreach (q('SELECT * FROM users WHERE role = ? ORDER BY branch, name', ['user']) as $u) {
            $sum = 0;
            $certs = 0;
            $old = $extPassed[$u['id']] ?? [];
            $cells = [];
            foreach ($list as $cid => $c) {
                $res = $quiz[$u['id']][$cid] ?? null;
                $passed = $res && $res['passed_at'];
                // Тест этого курса сдан на прежнем сайте до запуска Академии
                if (!$passed && !empty($c['legacy']) && isset($old[$c['legacy']])) {
                    $sum += 100;
                    $certs++;
                    $cells[] = 'сдан до запуска Академии';
                    continue;
                }
                $pct = (int)round((($lessons[$u['id']][$cid] ?? 0) + ($passed ? 1 : 0)) / ($c['lessons'] + 1) * 100);
                $sum += $pct;
                $certs += $passed ? 1 : 0;
                $cells[] = $passed ? 'сдан (' . round($res['best'] * 100) . '%)' : $pct . '%';
            }
            $safe = function ($v) {
                $v = (string)$v;
                return preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v;
            };
            fputcsv($out, array_merge(array_map($safe, [
                $u['name'], $u['login'], $u['branch'], $u['position'], $u['last_login'] ?? '',
            ]), [round($sum / max(1, count($list))), $certs, count($old)], $cells), ';');
        }
        exit;

    // Загрузка PDF, PowerPoint или видео частями (обходит ограничение хостинга на размер одного запроса)
    case 'admin_material_chunk':
        require_admin();
        $token = preg_replace('/[^a-f0-9]/', '', str_in('upload', 64));
        $index = (int)(input()['index'] ?? -1);
        $data = base64_decode((string)(input()['data'] ?? ''), true);
        // До 2000 частей по 512 КБ — около 1 ГБ (видео)
        if (strlen($token) !== 32 || $index < 0 || $index > 2000 || $data === false || $data === '' || strlen($data) > 1024 * 1024) {
            fail(422, 'invalid', 'Некорректная часть файла.');
        }
        if ($index === 0) {
            if (material_magic($data) === '') {
                fail(422, 'invalid', 'Можно загрузить PDF, презентацию PowerPoint (.pptx, .ppt) или видео (.mp4).');
            }
            q('DELETE FROM material_chunks WHERE upload = ?', [$token]);
        } elseif ((int)q('SELECT COUNT(*) FROM material_chunks WHERE upload = ?', [$token])->fetchColumn() !== $index) {
            fail(409, 'order', 'Загрузка прервалась. Начните заново.');
        }
        put_chunk($token, $index, $data);
        json_out(['ok' => true]);

    case 'admin_material_save':
        require_admin();
        $id = (int)(input()['id'] ?? 0);
        $title = str_in('title', 200);
        if ($title === '') {
            fail(422, 'invalid', 'Укажите название материала.');
        }
        $fields = [$title, str_in('brand', 120), str_in('category', 40), str_in('description', 2000), str_in('course', 40)];
        $link = video_link(str_in('link', 500));
        if (str_in('link', 500) !== '' && $link === '') {
            fail(422, 'invalid', 'Ссылка на видео должна начинаться с https://');
        }
        if ($id) {
            q('UPDATE materials SET title = ?, brand = ?, category = ?, description = ?, course_id = ? WHERE id = ?', array_merge($fields, [$id]));
            if ($link !== '') {
                q("UPDATE materials SET link = ? WHERE id = ? AND link <> ''", [$link, $id]);
            }
            json_out(['ok' => true]);
        }
        if ($link !== '') {
            q("INSERT INTO materials (title, brand, category, description, course_id, file, original_name, size, created_at, link) VALUES (?, ?, ?, ?, ?, '', '', 0, ?, ?)",
              array_merge($fields, [now(), $link]));
            if (!empty(input()['announce'])) {
                tg_broadcast('🎬 <b>Новое обучающее видео</b>' . "\n\n" . h($title) . ($fields[1] !== '' ? ' · ' . h($fields[1]) : '')
                    . "\n\n" . 'Смотреть: ' . site_url() . '#/materials');
            }
            json_out(['ok' => true]);
        }
        $token = preg_replace('/[^a-f0-9]/', '', str_in('upload', 64));
        $first = q('SELECT data FROM material_chunks WHERE upload = ? AND idx = 0', [$token])->fetchColumn();
        $name = str_in('name', 200);
        if ($first !== false && material_magic(chunk_data($first)) !== material_type($name)) {
            fail(422, 'invalid', 'Расширение файла не совпадает с содержимым. Загрузите PDF, .pptx, .ppt или .mp4.');
        }
        $size = strlen($token) === 32 ? upload_size($token) : 0;
        if (!$size) {
            fail(422, 'invalid', 'Сначала загрузите файл.');
        }
        q('INSERT INTO materials (title, brand, category, description, course_id, file, original_name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          array_merge($fields, [$token, $name, $size, now()]));
        // Презентация PowerPoint: сразу запускаем конвертер PDF (если подключён токен GitHub)
        if (is_ppt(material_type($name))) {
            gh_dispatch();
        }
        if (!empty(input()['announce'])) {
            tg_broadcast('📚 <b>Новый учебный материал</b>' . "\n\n" . h($title) . ($fields[1] !== '' ? ' · ' . h($fields[1]) : '')
                . "\n\n" . 'Открыть: ' . site_url() . '#/materials');
        }
        // Части брошенных загрузок старше суток
        q('DELETE FROM material_chunks WHERE created_at < ? AND upload NOT IN (SELECT file FROM materials)
           AND upload NOT IN (SELECT pdf FROM materials WHERE pdf IS NOT NULL)', [gmdate('Y-m-d H:i:s', time() - 86400)]);
        json_out(['ok' => true]);

    case 'admin_material_delete':
        require_admin();
        $m = q('SELECT file, pdf FROM materials WHERE id = ?', [(int)(input()['id'] ?? 0)])->fetch();
        if ($m) {
            q('DELETE FROM material_chunks WHERE upload = ? OR upload = ?', [$m['file'], (string)$m['pdf']]);
            q('DELETE FROM materials WHERE id = ?', [(int)(input()['id'] ?? 0)]);
        }
        json_out(['ok' => true]);

    /* ── Telegram и афиша ── */

    case 'tg_unlink':
        $u = require_user();
        q('UPDATE tg_links SET chat_id = NULL WHERE user_id = ?', [$u['id']]);
        json_out(['ok' => true]);

    case 'event_register':
        $u = require_user();
        $e = q('SELECT * FROM events WHERE id = ?', [(int)(input()['id'] ?? 0)])->fetch();
        if (!$e) {
            fail(404, 'not_found', 'Мероприятие не найдено.');
        }
        if (empty(input()['on'])) {
            $was = q('DELETE FROM event_regs WHERE event_id = ? AND user_id = ?', [$e['id'], $u['id']])->rowCount();
            $chat = $was ? tg_chat_of((int)$u['id']) : null;
            if ($chat) {
                tg_send($chat, event_text($e, '❌ <b>Вы отменили запись на мероприятие</b>')
                    . "\n\n" . 'Напоминаний по нему больше не будет. Передумали — запишитесь снова: ' . site_url() . '#/events');
            }
            json_out(['ok' => true, 'telegram' => $chat !== null]);
        }
        if (event_ts($e) <= time()) {
            fail(422, 'closed', 'Регистрация закрыта: мероприятие уже началось.');
        }
        $already = q('SELECT 1 FROM event_regs WHERE event_id = ? AND user_id = ?', [$e['id'], $u['id']])->fetchColumn();
        if (!$already) {
            if ((int)$e['capacity'] > 0 && (int)q('SELECT COUNT(*) FROM event_regs WHERE event_id = ?', [$e['id']])->fetchColumn() >= (int)$e['capacity']) {
                fail(409, 'full', 'Мест больше нет.');
            }
            // Если до начала меньше суток — суточное напоминание не нужно, хватит подтверждения
            $soon = event_ts($e) - time() <= 86400 ? 1 : 0;
            q('INSERT INTO event_regs (event_id, user_id, created_at, reminded) VALUES (?, ?, ?, ?)', [$e['id'], $u['id'], now(), $soon]);
            $chat = tg_chat_of((int)$u['id']);
            if ($chat) {
                $text = event_text($e, '✅ <b>Вы записаны на мероприятие</b>') . ($e['link'] !== '' ? "\n" . '🔗 ' . h($e['link']) : '')
                    . "\n\n" . 'Напомню накануне и примерно за час до начала.';
                tg_send($chat, $text);
            }
        }
        json_out(['ok' => true, 'telegram' => tg_chat_of((int)$u['id']) !== null]);

    case 'admin_event_save':
        require_admin();
        $id = (int)(input()['id'] ?? 0);
        $title = str_in('title', 200);
        $local = str_in('local', 20);
        $dt = DateTime::createFromFormat('Y-m-d\TH:i', $local, new DateTimeZone(TZ_LOCAL));
        if ($title === '' || !$dt) {
            fail(422, 'invalid', 'Укажите название, дату и время.');
        }
        $dt->setTimezone(new DateTimeZone('UTC'));
        $link = str_in('link', 300);
        if ($link !== '' && !preg_match('~^https?://~i', $link)) {
            fail(422, 'invalid', 'Ссылка должна начинаться с https://');
        }
        $vals = [$title, str_in('speaker', 200), str_in('description', 3000), str_in('place', 200), $link,
                 $dt->format('Y-m-d H:i:s'), max(0, (int)(input()['duration'] ?? 60)), max(0, (int)(input()['capacity'] ?? 0))];
        if ($id) {
            $old = q('SELECT starts_at FROM events WHERE id = ?', [$id])->fetchColumn();
            q('UPDATE events SET title = ?, speaker = ?, description = ?, place = ?, link = ?, starts_at = ?, duration = ?, capacity = ? WHERE id = ?', array_merge($vals, [$id]));
            if ($old !== false && $old !== $vals[5]) {
                q('UPDATE event_regs SET reminded = 0 WHERE event_id = ?', [$id]); // перенесли — напомним заново
            }
        } else {
            q('INSERT INTO events (title, speaker, description, place, link, starts_at, duration, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', array_merge($vals, [now()]));
            $id = (int)db()->lastInsertId();
        }
        $sent = 0;
        if (!empty(input()['announce'])) {
            $e = q('SELECT * FROM events WHERE id = ?', [$id])->fetch();
            $sent = tg_broadcast(event_text($e, '📣 <b>' . (empty(input()['id']) ? 'Новое мероприятие в ВИВААКАДЕМИИ' : 'Мероприятие в ВИВААКАДЕМИИ') . '</b>')
                . "\n\n" . 'Записаться: ' . site_url() . '#/events');
        }
        json_out(['ok' => true, 'sent' => $sent]);

    case 'admin_event_delete':
        require_admin();
        q('DELETE FROM event_regs WHERE event_id = ?', [(int)(input()['id'] ?? 0)]);
        q('DELETE FROM events WHERE id = ?', [(int)(input()['id'] ?? 0)]);
        json_out(['ok' => true]);

    // Подключение бота: токен от @BotFather. Сайт сам проверяет его и настраивает вебхук.
    // Конвертер PowerPoint → PDF: токен GitHub для мгновенного запуска и ручной запуск
    case 'admin_conv_setup':
        require_admin();
        $token = trim(str_in('token', 300));
        if ($token === '') {
            set_setting('gh_token', '');
            json_out(['ok' => true, 'converter' => false]);
        }
        if (!preg_match('/^(github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/', $token)) {
            fail(422, 'invalid', 'Это не похоже на токен GitHub: он начинается с github_pat_. Скопируйте его целиком.');
        }
        $code = gh_dispatch($token);
        if ($code !== 204) {
            fail(422, 'invalid', $code === 0 ? 'Сайт не смог связаться с GitHub. Попробуйте позже.'
                : 'GitHub не принял токен (код ' . $code . '). Проверьте, что выбран репозиторий CV-Inna-Shvets- и разрешение Actions: Read and write.');
        }
        set_setting('gh_token', $token);
        json_out(['ok' => true, 'converter' => true]);

    case 'admin_conv_kick':
        require_admin();
        if (setting('gh_token') === '') {
            fail(409, 'no_token', 'Конвертер не подключён: добавьте токен GitHub в кабинете руководителя.');
        }
        $code = gh_dispatch();
        if ($code !== 204) {
            fail(502, 'github', 'GitHub не запустил конвертер (код ' . $code . '). Возможно, токен истёк — замените его в кабинете руководителя.');
        }
        json_out(['ok' => true]);

    case 'admin_tg_setup':
        require_admin();
        $token = trim(str_in('token', 100));
        if ($token === '') {
            if (tg_token() !== '') {
                tg_api('deleteWebhook');
            }
            foreach (['tg_token', 'tg_bot', 'tg_secret'] as $k) {
                set_setting($k, '');
            }
            json_out(['ok' => true, 'bot' => '']);
        }
        if (!preg_match('/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/', $token)) {
            fail(422, 'invalid', 'Это не похоже на токен бота. Скопируйте его из сообщения @BotFather целиком.');
        }
        $me = tg_api('getMe', [], $token);
        if (!$me || empty($me['username'])) {
            fail(422, 'invalid', 'Telegram не принял токен. Проверьте, что он скопирован полностью, или выпустите новый в @BotFather.');
        }
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        $base = ($https ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/') . '/';
        $secret = bin2hex(random_bytes(24));
        $hook = tg_api('setWebhook', ['url' => $base . 'api/index.php?action=tg_webhook', 'secret_token' => $secret,
                                      'allowed_updates' => ['message'], 'drop_pending_updates' => true], $token);
        if (!$hook) {
            fail(502, 'telegram', 'Бот найден, но Telegram не смог подключить адрес сайта. Сайт должен открываться по https.');
        }
        tg_api('setMyCommands', ['commands' => [
            ['command' => 'afisha', 'description' => 'Ближайшие мероприятия'],
            ['command' => 'stop', 'description' => 'Отключить уведомления'],
        ]], $token);
        set_setting('tg_token', $token);
        set_setting('tg_bot', $me['username']);
        set_setting('tg_secret', $secret);
        set_setting('site_url', $base);
        json_out(['ok' => true, 'bot' => $me['username']]);

    default:
        fail(404, 'unknown', 'Неизвестное действие.');
}
