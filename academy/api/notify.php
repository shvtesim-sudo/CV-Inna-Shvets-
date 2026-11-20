<?php
// Telegram-бот, афиша мероприятий и напоминания.
// Подключается из index.php. Снаружи файл недоступен (api/.htaccess).

declare(strict_types=1);

const TZ_LOCAL = 'Europe/Chisinau'; // время Тирасполя

/* ── Telegram ── */

function tg_token(): string
{
    try {
        return setting('tg_token');
    } catch (Throwable $e) {
        return '';
    }
}

// Вызов Bot API. Возвращает result или null при ошибке.
function tg_api(string $method, array $params = [], string $token = ''): ?array
{
    $token = $token !== '' ? $token : tg_token();
    if ($token === '') {
        return null;
    }
    $base = rtrim(config()['tg_api'] ?? 'https://api.telegram.org', '/');
    $url = $base . '/bot' . $token . '/' . $method;
    $body = json_encode($params, JSON_UNESCAPED_UNICODE);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $raw = curl_exec($ch);
        curl_close($ch);
    } else {
        $raw = @file_get_contents($url, false, stream_context_create(['http' => [
            'method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => $body, 'timeout' => 10, 'ignore_errors' => true,
        ]]));
    }
    $r = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($r) || empty($r['ok'])) {
        error_log('[viva-academy] telegram ' . $method . ': ' . (is_string($raw) ? substr($raw, 0, 300) : 'нет ответа'));
        return null;
    }
    return is_array($r['result']) ? $r['result'] : ['value' => $r['result']];
}

function tg_send(string $chatId, string $html): bool
{
    $r = tg_api('sendMessage', ['chat_id' => $chatId, 'text' => $html, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true]);
    return $r !== null;
}

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function site_url(): string
{
    if (!empty(config()['site_url'])) {
        return rtrim(config()['site_url'], '/') . '/';
    }
    $saved = setting('site_url');
    return $saved !== '' ? $saved : 'https://vivaacademy.md/';
}

// Всем, кто подключил бота. Не дольше ~25 сотен сообщений за вызов — с паузой под лимиты Telegram.
function tg_broadcast(string $html): int
{
    if (tg_token() === '') {
        return 0;
    }
    @set_time_limit(300);
    $n = 0;
    foreach (q('SELECT t.chat_id FROM tg_links t JOIN users u ON u.id = t.user_id WHERE t.chat_id IS NOT NULL AND u.active = 1')->fetchAll() as $r) {
        if (tg_send((string)$r['chat_id'], $html)) {
            $n++;
        }
        usleep(40000);
    }
    return $n;
}

function tg_chat_of(int $uid): ?string
{
    $c = q('SELECT chat_id FROM tg_links WHERE user_id = ? AND chat_id IS NOT NULL', [$uid])->fetchColumn();
    return $c === false || $c === null ? null : (string)$c;
}

// Ссылка «Подключить Telegram» для сотрудника: t.me/<бот>?start=<код>
function tg_link_for(int $uid): ?string
{
    $bot = setting('tg_bot');
    if ($bot === '') {
        return null;
    }
    $row = q('SELECT code FROM tg_links WHERE user_id = ?', [$uid])->fetch();
    if ($row && $row['code']) {
        $code = $row['code'];
    } else {
        $code = bin2hex(random_bytes(12));
        q('DELETE FROM tg_links WHERE user_id = ?', [$uid]);
        q('INSERT INTO tg_links (user_id, chat_id, code, linked_at) VALUES (?, NULL, ?, NULL)', [$uid, $code]);
    }
    return 'https://t.me/' . $bot . '?start=' . $code;
}

// Входящее обновление от Telegram (вебхук)
function tg_handle_update(array $upd): void
{
    $msg = $upd['message'] ?? null;
    if (!$msg || !isset($msg['chat']['id']) || ($msg['chat']['type'] ?? '') !== 'private') {
        return;
    }
    $chat = (string)$msg['chat']['id'];
    $text = trim((string)($msg['text'] ?? ''));
    $site = site_url();

    if (preg_match('~^/start(?:\s+([a-f0-9]{24}))?~', $text, $m)) {
        if (!empty($m[1])) {
            $row = q('SELECT t.user_id, u.name FROM tg_links t JOIN users u ON u.id = t.user_id WHERE t.code = ? AND u.active = 1', [$m[1]])->fetch();
            if ($row) {
                q('UPDATE tg_links SET chat_id = NULL WHERE chat_id = ? AND user_id <> ?', [$chat, $row['user_id']]);
                q('UPDATE tg_links SET chat_id = ?, linked_at = ? WHERE user_id = ?', [$chat, now(), $row['user_id']]);
                tg_send($chat, '✅ <b>' . h($row['name']) . '</b>, бот ВИВААКАДЕМИИ подключён.' . "\n\n"
                    . 'Сюда будут приходить новые курсы и тесты, анонсы мероприятий и напоминания о тех, на которые вы записались.' . "\n\n"
                    . '📅 Афиша: ' . $site . '#/events' . "\n"
                    . 'Отключить уведомления — команда /stop');
                return;
            }
            tg_send($chat, 'Ссылка устарела. Откройте ' . $site . '#/profile и нажмите «Подключить Telegram» ещё раз.');
            return;
        }
        $known = q('SELECT u.name FROM tg_links t JOIN users u ON u.id = t.user_id WHERE t.chat_id = ?', [$chat])->fetchColumn();
        tg_send($chat, $known
            ? '👋 ' . h((string)$known) . ', бот уже подключён. Афиша мероприятий: ' . $site . '#/events'
            : '👋 Это бот ВИВААКАДЕМИИ — обучения сотрудников Вивафарм.' . "\n\n"
              . 'Чтобы получать уведомления о новых тестах и мероприятиях, войдите в личный кабинет '
              . $site . '#/profile и нажмите «Подключить Telegram».');
        return;
    }
    if ($text === '/stop') {
        q('UPDATE tg_links SET chat_id = NULL WHERE chat_id = ?', [$chat]);
        tg_send($chat, 'Уведомления отключены. Подключить снова можно в личном кабинете: ' . $site . '#/profile');
        return;
    }
    if ($text === '/afisha' || $text === '/events') {
        tg_send($chat, events_digest());
        return;
    }
    tg_send($chat, 'Команды: /afisha — ближайшие мероприятия, /stop — отключить уведомления.' . "\n" . 'Сайт: ' . $site);
}

/* ── Мероприятия ── */

function local_dt(int $ts): DateTime
{
    $d = new DateTime('@' . $ts);
    $d->setTimezone(new DateTimeZone(TZ_LOCAL));
    return $d;
}

// «20 ноября, 14:30»
function human_dt(int $ts): string
{
    $months = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    $d = local_dt($ts);
    return (int)$d->format('j') . ' ' . $months[(int)$d->format('n')] . ', ' . $d->format('H:i');
}

function event_ts(array $e): int
{
    return strtotime($e['starts_at'] . ' UTC');
}

function event_text(array $e, string $lead): string
{
    $t = $lead . "\n\n" . '🎓 <b>' . h($e['title']) . '</b>' . "\n" . '🗓 ' . human_dt(event_ts($e));
    if ($e['speaker'] !== '') {
        $t .= "\n" . '👩‍⚕️ ' . h($e['speaker']);
    }
    if ($e['place'] !== '') {
        $t .= "\n" . '📍 ' . h($e['place']);
    }
    return $t;
}

function events_digest(): string
{
    $rows = q('SELECT * FROM events WHERE starts_at > ? ORDER BY starts_at LIMIT 5', [now()])->fetchAll();
    if (!$rows) {
        return 'Ближайших мероприятий пока нет. Афиша: ' . site_url() . '#/events';
    }
    $t = '📅 <b>Ближайшие мероприятия</b>';
    foreach ($rows as $e) {
        $t .= "\n\n" . '• <b>' . h($e['title']) . '</b>' . "\n" . '  ' . human_dt(event_ts($e)) . ($e['speaker'] !== '' ? ' · ' . h($e['speaker']) : '');
    }
    return $t . "\n\n" . 'Записаться: ' . site_url() . '#/events';
}

/* ── Регулярные задачи: напоминания и новые курсы ── */

// Запускается из cron (GitHub Actions каждые 15 минут) и попутно при обычных запросах, не чаще раза в минуту.
function notify_tick(bool $force = false): array
{
    $done = ['reminders' => 0, 'courses' => 0];
    // «Захват» запуска одним запросом: при одновременных вызовах работу делает только тот, чей UPDATE сработал,
    // иначе напоминания могли бы уйти дважды
    try {
        $last = setting('tick_at');
        if ($last === '') {
            set_setting('tick_at', '0');
            $last = '0';
        }
        if (!$force && time() - (int)$last < 60) {
            return $done;
        }
        $won = q('UPDATE settings SET value = ? WHERE name = ? AND value = ?', [(string)time(), 'tick_at', $last])->rowCount();
        if ($won !== 1) {
            return $done;
        }
    } catch (Throwable $e) {
        return $done;
    }

    // Новые курсы с тестами: сравниваем с тем, что уже объявляли
    $ids = array_keys(courses());
    $known = setting('known_courses');
    if ($known === '') {
        set_setting('known_courses', implode(',', $ids)); // первый запуск — ничего не рассылаем
    } else {
        $new = array_diff($ids, explode(',', $known));
        if ($new) {
            set_setting('known_courses', implode(',', $ids));
            $list = '';
            foreach ($new as $cid) {
                $list .= "\n" . '• <a href="' . h(site_url() . '#/course/' . $cid) . '">' . h(courses()[$cid]['title']) . '</a>';
            }
            $done['courses'] = tg_broadcast('🆕 <b>' . (count($new) > 1 ? 'Новые курсы' : 'Новый курс') . ' с тестом в ВИВААКАДЕМИИ</b>' . $list
                . "\n\n" . 'Пройдите тест и получите сертификат.');
        }
    }

    if (tg_token() === '') {
        return $done;
    }
    // Напоминания: за сутки (бит 1) и примерно за час (бит 2) до начала
    $now = time();
    $rows = q('SELECT r.event_id, r.user_id, r.reminded, e.*, t.chat_id FROM event_regs r
               JOIN events e ON e.id = r.event_id
               JOIN tg_links t ON t.user_id = r.user_id AND t.chat_id IS NOT NULL
               WHERE e.starts_at > ? AND e.starts_at < ? AND r.reminded < 3',
        [gmdate('Y-m-d H:i:s', $now), gmdate('Y-m-d H:i:s', $now + 86400 + 900)])->fetchAll();
    foreach ($rows as $r) {
        $left = event_ts($r) - $now;
        $bit = 0;
        if ($left <= 90 * 60 && !((int)$r['reminded'] & 2)) {
            $bit = 3; // за час; суточное уже не нужно
            $lead = '⏰ <b>Скоро начало — в ' . local_dt(event_ts($r))->format('H:i') . '</b>';
        } elseif ($left <= 86400 && $left > 90 * 60 && !((int)$r['reminded'] & 1)) {
            $bit = 1;
            $lead = '🔔 <b>Напоминание: вы записаны на мероприятие</b>';
        }
        if (!$bit) {
            continue;
        }
        $text = event_text($r, $lead);
        if ($r['link'] !== '') {
            $text .= "\n" . '🔗 ' . h($r['link']);
        }
        if (tg_send((string)$r['chat_id'], $text)) {
            q('UPDATE event_regs SET reminded = ? WHERE event_id = ? AND user_id = ?', [((int)$r['reminded']) | $bit, $r['event_id'], $r['user_id']]);
            $done['reminders']++;
        }
        usleep(40000);
    }
    return $done;
}

function event_row(array $e, int $uid): array
{
    $regs = (int)q('SELECT COUNT(*) FROM event_regs WHERE event_id = ?', [$e['id']])->fetchColumn();
    $mine = (bool)q('SELECT 1 FROM event_regs WHERE event_id = ? AND user_id = ?', [$e['id'], $uid])->fetchColumn();
    return [
        'id' => (int)$e['id'], 'title' => $e['title'], 'speaker' => $e['speaker'], 'description' => (string)$e['description'],
        'place' => $e['place'], 'link' => $mine ? $e['link'] : ($e['link'] !== '' ? 'after' : ''),
        'startsAt' => event_ts($e) * 1000, 'local' => local_dt(event_ts($e))->format('Y-m-d\TH:i'),
        'duration' => (int)$e['duration'], 'capacity' => (int)$e['capacity'], 'registered' => $regs, 'mine' => $mine,
    ];
}

// Конвертер PowerPoint → PDF (GitHub Actions, .github/workflows/academy-convert.yml).
// Сайт запускает его сразу после загрузки презентации — по токену GitHub с правом Actions: Read and write.
// Без токена конвертер запускается только по расписанию GitHub (оно бывает раз в несколько часов).
function gh_repo(): string
{
    $r = setting('gh_repo');
    return $r !== '' ? $r : 'shvtesim-sudo/CV-Inna-Shvets-';
}

function gh_dispatch(string $token = ''): int
{
    $token = $token !== '' ? $token : setting('gh_token');
    if ($token === '') {
        return 0;
    }
    $url = 'https://api.github.com/repos/' . gh_repo() . '/actions/workflows/academy-convert.yml/dispatches';
    $headers = ['Authorization: Bearer ' . $token, 'Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28',
                'User-Agent: VivaAcademy', 'Content-Type: application/json'];
    $body = '{"ref":"main"}';
    $code = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $raw = @file_get_contents($url, false, stream_context_create(['http' => [
            'method' => 'POST', 'header' => implode("\r\n", $headers) . "\r\n", 'content' => $body, 'timeout' => 10, 'ignore_errors' => true]]));
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $code = (int)$m[1];
        }
    }
    if ($code !== 204) {
        error_log('[viva-academy] github dispatch: HTTP ' . $code . ' ' . (is_string($raw) ? substr($raw, 0, 200) : ''));
    }
    return $code;
}
