<?php
// Установщик: создаёт таблицы и первого администратора.
// Работает только пока в базе нет ни одного администратора.

declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: text/html; charset=utf-8');

function page(string $body): void
{
    echo '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>Установка Viva Academy</title><style>'
        . 'body{font:16px/1.6 system-ui,sans-serif;background:#f4f8fa;color:#17313d;margin:0;padding:32px 16px}'
        . 'main{max-width:480px;margin:auto;background:#fff;border:1px solid #d7e4ea;border-radius:16px;padding:28px}'
        . 'h1{font-size:1.4rem;margin-top:0}label{display:block;margin:14px 0 4px;font-weight:600}'
        . 'input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d7e4ea;border-radius:10px;font:inherit}'
        . 'button,a.btn{display:inline-block;margin-top:20px;background:#13708a;color:#fff;border:0;padding:12px 20px;border-radius:10px;font:600 1rem system-ui;cursor:pointer;text-decoration:none}'
        . '.err{background:#fbece4;color:#b5532a;padding:10px 14px;border-radius:10px}.ok{background:#e0f3e9;color:#23935f;padding:10px 14px;border-radius:10px}'
        . 'code{background:#eaf2f5;padding:2px 6px;border-radius:6px}</style></head><body><main>' . $body . '</main></body></html>';
    exit;
}

if (!is_file(__DIR__ . '/config.php')) {
    page('<h1>Шаг 1. Настройка базы данных</h1><p>Скопируйте файл <code>api/config.sample.php</code> в <code>api/config.php</code> '
        . 'и укажите в нём имя базы, пользователя и пароль MySQL из панели хостинга. Затем обновите эту страницу.</p>');
}

try {
    foreach (schema() as $sql) {
        db()->exec($sql);
    }
} catch (Throwable $e) {
    page('<h1>Не удалось подключиться к базе</h1><p class="err">' . htmlspecialchars($e->getMessage()) . '</p>'
        . '<p>Проверьте данные в <code>api/config.php</code>.</p>');
}

$hasAdmin = (bool)q("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")->fetchColumn();
if ($hasAdmin) {
    page('<h1>Установка завершена</h1><p class="ok">Таблицы созданы, администратор уже есть.</p>'
        . '<p>Для безопасности удалите файл <code>api/install.php</code> с сервера.</p><a class="btn" href="../#/login">Открыть платформу</a>');
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim((string)($_POST['name'] ?? ''));
    $login = mb_strtolower(trim((string)($_POST['login'] ?? '')));
    $password = (string)($_POST['password'] ?? '');
    if ($name === '' || !valid_login($login) || mb_strlen($password) < 10) {
        $error = 'Заполните все поля. Логин — от 3 символов, пароль — от 10 символов.';
    } else {
        q('INSERT INTO users (login, name, branch, position, role, password_hash, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
          [$login, mb_substr($name, 0, 120), '', 'Администратор', 'admin', password_hash($password, PASSWORD_DEFAULT), now()]);
        page('<h1>Готово!</h1><p class="ok">Администратор создан.</p><p>Удалите файл <code>api/install.php</code> с сервера '
            . 'и войдите в платформу со своим логином.</p><a class="btn" href="../#/login">Войти</a>');
    }
}

page('<h1>Шаг 2. Первый администратор</h1><p>База подключена, таблицы созданы. Создайте учётную запись администратора — '
    . 'с неё вы будете добавлять сотрудников и смотреть их прогресс.</p>'
    . ($error ? '<p class="err">' . htmlspecialchars($error) . '</p>' : '')
    . '<form method="post"><label for="n">Имя и фамилия</label><input id="n" name="name" required>'
    . '<label for="l">Логин</label><input id="l" name="login" required autocomplete="username">'
    . '<label for="p">Пароль (от 10 символов)</label><input id="p" name="password" type="password" required minlength="10" autocomplete="new-password">'
    . '<button>Создать администратора</button></form>');
