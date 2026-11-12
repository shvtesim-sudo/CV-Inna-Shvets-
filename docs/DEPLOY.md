# Автообновление vivaacademy.md из GitHub

После настройки каждое изменение папки `academy/` в ветке `main` само выкладывается на сервер.
Workflow — `.github/workflows/deploy-academy.yml`. Настройка — один раз, примерно 15–20 минут.

## Что делает выкладка
- Проверяет синтаксис PHP-файлов.
- Копирует файлы сайта на сервер по SSH (`rsync`): только добавляет и перезаписывает, ничего не удаляет.
- **Не трогает** `api/config.php`, `api/install.php`, папку `data/` и базу данных.
- В конце проверяет, что сайт и API отвечают.

Пока секреты не заданы, выкладка пропускается с предупреждением — ошибкой это не считается.

## Настройка

### 1. Доступ к репозиторию
Владелец репозитория добавляет администратора: **Settings → Collaborators → Add people** (по логину GitHub). Секреты администратор вносит сам — закрытый ключ никому пересылать не нужно.

### 2. Пользователь на сервере
Подойдёт пользователь, у которого есть права на запись в папку сайта. Рекомендуется отдельный, без sudo:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG www-data deploy
sudo chown -R www-data:www-data /var/www/vivaacademy.md
sudo chmod -R g+w /var/www/vivaacademy.md
sudo apt-get install -y rsync
```

Путь `/var/www/vivaacademy.md` замените на фактическую папку сайта.

### 3. SSH-ключ только для выкладки
На своём компьютере:

```bash
ssh-keygen -t ed25519 -C "github-deploy vivaacademy" -f vivaacademy_deploy -N ""
```

Содержимое `vivaacademy_deploy.pub` добавьте на сервере в `~deploy/.ssh/authorized_keys` (права: папка `700`, файл `600`, владелец `deploy`).

Проверьте вход: `ssh -i vivaacademy_deploy deploy@СЕРВЕР`.

### 4. Отпечаток сервера

```bash
ssh-keyscan -p 22 СЕРВЕР
```

Сверьте отпечаток с сервером (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). Весь вывод `ssh-keyscan` пойдёт в секрет `DEPLOY_KNOWN_HOSTS`.

### 5. Секреты в GitHub
**Settings → Secrets and variables → Actions → New repository secret**:

| Секрет | Значение |
| --- | --- |
| `DEPLOY_HOST` | адрес сервера (домен или IP) |
| `DEPLOY_PORT` | порт SSH, если не 22 (иначе можно не задавать) |
| `DEPLOY_USER` | пользователь, например `deploy` |
| `DEPLOY_PATH` | папка сайта, например `/var/www/vivaacademy.md` |
| `DEPLOY_SSH_KEY` | всё содержимое закрытого ключа `vivaacademy_deploy` |
| `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan` из шага 4 |

После этого закрытый ключ `vivaacademy_deploy` на компьютере можно удалить.

### 6. Первая выкладка
**Actions → Deploy Viva Academy → Run workflow** (ветка `main`). Зелёная галочка — сайт обновлён. Откройте vivaacademy.md с очисткой кэша (Ctrl+F5).

## Если выкладка не прошла
- `Permission denied (publickey)` — открытый ключ не добавлен в `authorized_keys` нужного пользователя или неверный `DEPLOY_USER`.
- `Host key verification failed` — неверный или неполный `DEPLOY_KNOWN_HOSTS`.
- `rsync: command not found` — установите `rsync` на сервере.
- `Permission denied` при записи файлов — у пользователя нет прав на запись в папку сайта (шаг 2).
- Не прошла проверка «сайт отвечает» — файлы загружены, но сайт или PHP вернули ошибку: смотрите журнал ошибок Apache/PHP.

## Откат
Отмените изменение в GitHub (кнопка **Revert** в слитом PR) — выкладка запустится сама и вернёт прежние файлы.
