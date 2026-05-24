# Автотесты деплоя

Без сторонних зависимостей — встроенный **`node:test`** (Node 22). Боевой код не меняют, только проверяют. Тесты, требующие БД/сервера, **пропускаются**, если окружение не задано (локальный прогон не падает).

## Запуск

```bash
cd backend

# Всё (unit всегда; db/smoke — если заданы DATABASE_URL / поднят сервер)
node --test test/

# Только unit (без БД и сети)
node --test test/chunk.unit.test.js test/providers.unit.test.js

# Post-deploy gate против развёрнутого URL (код возврата ≠ 0 при провале)
SMOKE_BASE_URL=https://feynmap.example \
SMOKE_EMAIL=admin@org SMOKE_PASSWORD=*** \
node scripts/deploy-check.mjs
```

## Что покрыто

| Файл | Что проверяет | Нужно |
|---|---|---|
| `chunk.unit.test.js` | RAG-чанкер: пустой вход, размеры чанков, мультиязычность | — (всегда) |
| `providers.unit.test.js` | provider-фабрика резолвит по ENV; стабы → 501; неизвестный → ошибка | — (стаб `local`) |
| `db.deploy.test.js` | расширения `vector`/`pgcrypto`, ключевые таблицы, seed (16 прав/6 ролей/матрица), pgvector roundtrip | `DATABASE_URL` |
| `api.smoke.test.js` | `/health`, guard 401, логин→JWT→`/auth/me` | поднятый сервер (`SMOKE_BASE_URL`) |
| `../scripts/deploy-check.mjs` | дожидается `/health`, прогоняет smoke, exit-code для CD | развёрнутый URL |

## ENV

- `DATABASE_URL` — целевая БД для db-deploy тестов.
- `SMOKE_BASE_URL` — адрес развёрнутого бэка (по умолч. `http://localhost:8787`).
- `SMOKE_EMAIL` / `SMOKE_PASSWORD` / `SMOKE_ORG_SLUG` — включают проверку authed-пути.
- `SMOKE_TIMEOUT_MS` — ожидание готовности `/health` (по умолч. 60000).

## Полный прогон (как при проверке деплоя)

Без внешнего CI — всё гоняется локально:

```bash
cd backend
npm ci
npm run db:migrate && npm run db:seed   # нужна локальная Postgres+pgvector
node --test test/                        # unit + db-deploy
node server.js & sleep 2                 # поднять бэкенд
node scripts/deploy-check.mjs            # post-deploy smoke (exit-code)
```
