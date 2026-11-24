# Деплой и телеметрия Kaleidra на games.vslav.dev/kaleidra — runbook (25.11.2026)

Как у Glimmerfall: та же схема, тот же сервер, тот же приём телеметрии.

## Схема
- Push в `main` → GitHub Actions: typecheck, lint, тесты, сборка → тарбол по `scp` на vps-31 → `/var/www/kaleidra/releases/<время>-<sha>` → атомарная смена симлинка `current`. Хранятся 3 релиза.
- nginx сайт `games`: `/var/www/games/kaleidra` → `/var/www/kaleidra/current`. Конфиг — общий `deploy/nginx/games.vslav.dev.conf` в репо Glimmerfall (один файл на весь домен).
- Ветка `main`, не `release`: репо уже создан с `main` по умолчанию.

## Обновление на телефонах
- Сборка кладёт `version.json`: версия, период опроса, последние 20 записей `changelog.json`.
- Игра спрашивает его раз в минуту (условный GET, 304 без изменений) и при возврате в приложение.
- Новая версия → кнопка у бонусов и на титуле → окно «что нового» → «Обновить» (сохранение, перезагрузка; уровень продолжается).
- Сборка падает, если в `changelog.json` нет записи для версии из `package.json`: каждый релиз — запись сверху.
- Service worker: ресурсы с хешем — из кэша, остальное — сеть, затем кэш (офлайн, установка на экран).

## Телеметрия
- Источник `kaleidra` в MegaApp ingest; ключ подставляет nginx из сниппета, в игре ключа нет.
- Потоки: `session`, `gl`, `error`, `perf` (окна кадров, загрузка, понижение качества), `attempt` (итог попытки + ходы для повтора), `update`.
- Запись попытки — под гексы: направление из 6 (3 бита), без шагов доски (ход только на спокойном поле). Повтор: сид доски + ходы → та же игра (тест).
- Dev-сборка не шлёт, пишет в консоль.

## Настройка (один раз)

1. Папка и симлинк:
   ```bash
   ssh vps-31 'mkdir -p /var/www/kaleidra/releases && chown -R www-data:www-data /var/www/kaleidra && ln -sfn /var/www/kaleidra/current /var/www/games/kaleidra'
   ```
2. Источник и ключ ingest (ключ создаётся на сервере и не покидает его):
   ```bash
   ssh vps-31 'set -e; K=$(openssl rand -base64 48 | tr -dc A-Za-z0-9 | head -c 32); E=/root/megaback/.env.prod; cp $E $E.bak-kaleidra; sed -i "s/^INGEST_SOURCES=.*/&,kaleidra:100MB/; s/^INGEST_KEYS=.*/&,$K/" $E; install -m 600 /dev/null /etc/nginx/snippets/kaleidra-ingest-key.conf; echo "proxy_set_header X-Ingest-Key \"$K\";" > /etc/nginx/snippets/kaleidra-ingest-key.conf; systemctl restart megaback; grep ^INGEST_SOURCES $E'
   ```
3. nginx (конфиг из репо Glimmerfall):
   ```bash
   scp /Users/user/code/GAMES/glimmerfall/deploy/nginx/games.vslav.dev.conf vps-31:/etc/nginx/sites-available/games
   ```
   ```bash
   ssh vps-31 'nginx -t && systemctl reload nginx'
   ```
4. Ключ деплоя `github-actions-kaleidra`:
   ```bash
   ssh-keygen -t ed25519 -N "" -C github-actions-kaleidra -f ~/.ssh/github-actions-kaleidra
   ```
   ```bash
   ssh vps-31 'cat >> /root/.ssh/authorized_keys' < ~/.ssh/github-actions-kaleidra.pub
   ```
5. GitHub, окружение `VPS_31` с секретами:
   ```bash
   gh api -X PUT repos/vslav-dev/kaleidra/environments/VPS_31
   ```
   ```bash
   gh secret set SSH_KEY --repo vslav-dev/kaleidra --env VPS_31 < ~/.ssh/github-actions-kaleidra
   ```
   ```bash
   gh secret set HOST --repo vslav-dev/kaleidra --env VPS_31 --body 31.58.137.7
   ```
   ```bash
   gh secret set USER --repo vslav-dev/kaleidra --env VPS_31 --body root
   ```
6. `git push` в `main` → Actions → Deploy.

## Проверка
- Actions: job `deploy` зелёный, в конце `active: <release>`.
- `curl -s https://games.vslav.dev/kaleidra/version.json` → текущая версия.
- `curl -s https://games.vslav.dev/kaleidra/build-info.json` → коммит = последний в `main`.
- Чтение телеметрии: `ssh vps-31 'cat /root/megaback/data/ingest/kaleidra/*.ndjson' | jq -c 'select(.stream != "session")'`.

## Откат
- `ssh vps-31 'ls /var/www/kaleidra/releases'` → `ssh vps-31 'cd /var/www/kaleidra && ln -sfn releases/<прошлый> current.next && mv -Tf current.next current'`.
- Или Actions → Deploy → Run workflow на нужном коммите.

## Чек-лист
- ✅ Клиент телеметрии, потоки `session`/`gl`/`error`/`perf`, старт до сцены
- ✅ Запись и повтор попытки на гекс-поле, тест повтора
- ✅ `version.json`, `changelog.json`, проверка записи при сборке
- ✅ Окно обновления: кнопка у бонусов и на титуле, «что нового», перезагрузка с сохранением
- ✅ Service worker и манифест
- ✅ Workflow, скрипт активации
- ✅ nginx: маршруты `/kaleidra/` и ingest в общем конфиге домена
- ✅ typecheck, lint, тесты, сборка
- ⭕ Папка и симлинк на сервере
- ⭕ Источник и ключ ingest, сниппет nginx
- ⭕ nginx на сервере
- ⭕ Ключ деплоя и секреты `VPS_31`
