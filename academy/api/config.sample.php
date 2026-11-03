<?php
// Скопируйте этот файл в config.php и укажите данные базы данных хостинга.
return [
    // MySQL / MariaDB (обычный хостинг):
    'dsn'      => 'mysql:host=localhost;dbname=vivaacademy;charset=utf8mb4',
    'user'     => 'db_user',
    'password' => 'db_password',

    // Для локальной проверки без MySQL можно использовать SQLite:
    // 'dsn' => 'sqlite:' . __DIR__ . '/../data/academy.sqlite',

    // Проходной балл итогового теста (0.8 = 80%).
    'pass_score' => 0.8,
];
