<?php
// API Viva Academy: api/index.php?action=<действие>
// Ответы — JSON. Изменяющие запросы — POST с заголовком X-CSRF-Token.

declare(strict_types=1);
require __DIR__ . '/lib.php';

set_exception_handler(function (Throwable $e) {
    error_log('[viva-academy] ' . $e->getMessage());
    fail(500, 'server', 'Ошибка сервера. Попробуйте позже.');
});

start_session();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Публичная проверка сертификата
if ($action === 'cert') {
    $id = substr((string)($_GET['id'] ?? ''), 0, 40);
    $r = q('SELECT u.name, r.course_id, r.passed_at, r.best FROM quiz_results r
            JOIN users u ON u.id = r.user_id WHERE r.cert_id = ?', [$id])->fetch();
    if (!$r) {
        fail(404, 'not_found', 'Сертификат не найден.');
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
        require_admin();
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
        $users = [];
        foreach (q('SELECT * FROM users ORDER BY name') as $r) {
            $users[] = public_user($r) + [
                'active' => (bool)$r['active'],
                'createdAt' => $r['created_at'],
                'lastLogin' => $r['last_login'],
                'lessons' => (object)($lessons[$r['id']] ?? []),
                'quiz' => (object)($quiz[$r['id']] ?? []),
            ];
        }
        json_out(['users' => $users, 'inviteCode' => setting('invite_code')]);

    case 'admin_user_save':
        $me = require_admin();
        $id = (int)(input()['id'] ?? 0);
        $login = mb_strtolower(str_in('login'));
        $name = str_in('name');
        $role = str_in('role') === 'admin' ? 'admin' : 'user';
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
            $created[] = ['login' => $login, 'name' => $name, 'password' => $password];
        }
        db()->commit();
        json_out(['created' => $created, 'skipped' => $skipped]);

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
        require_admin();
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
        $head = ['ФИО', 'Логин', 'Аптека / филиал', 'Должность', 'Последний вход', 'Общий прогресс, %', 'Сертификатов'];
        foreach ($list as $c) {
            $head[] = $c['title'];
        }
        fputcsv($out, $head, ';');
        foreach (q('SELECT * FROM users WHERE role = ? ORDER BY branch, name', ['user']) as $u) {
            $sum = 0;
            $certs = 0;
            $cells = [];
            foreach ($list as $cid => $c) {
                $res = $quiz[$u['id']][$cid] ?? null;
                $passed = $res && $res['passed_at'];
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
            ]), [round($sum / max(1, count($list))), $certs], $cells), ';');
        }
        exit;

    default:
        fail(404, 'unknown', 'Неизвестное действие.');
}
