# FeynMap — учусь, объясняя + живая карта компетенций

Двухдневный хакатон-проект. Пользователь объясняет тему ИИ-«наивному студенту»,
параллельно ИИ-«ассессор» оценивает компетенции и строит живой радар. В финале —
карта навыков, пробелы и короткие рекомендации.

## Стек
- **Frontend:** React + Vite + TypeScript + Tailwind + recharts
- **Backend:** Node + Express прокси к Anthropic Claude
- **Модели:** `claude-sonnet-4-6` (Студент), `claude-haiku-4-5-20251001` (Ассессор)

## Структура
```
backend/   — Express API (/chat, /assess), ключ Anthropic только здесь
  src/db/  — Drizzle schema + миграции + seeder (Phase 1+)
frontend/  — React-приложение, чат + радар + финальный отчёт
docs/      — architecture.drawio
docker/    — опциональный initdb для docker-compose (не нужен для локалки)
```

## Запуск (локально, без Docker)

Хакатон-демо — всё на ноутбуке. Postgres ставим нативно через brew,
pgvector тянется вместе с ним. Docker не нужен.

### 1. Postgres + pgvector (один раз)
```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"   # можно дописать в ~/.zshrc

createdb feynmap
psql feynmap -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

> pgvector в brew собран под `postgresql@17` — поэтому именно эта версия,
> не `@16`. Схема и SQL у нас идентичны для обеих.

### 2. Конфиг
```bash
cp backend/.env.example backend/.env
```
В `backend/.env` заполнить:
- `ANTHROPIC_API_KEY=sk-ant-...`
- `DATABASE_URL=postgres://$(whoami)@localhost:5432/feynmap`
- `JWT_SECRET=$(openssl rand -hex 32)` — сгенерировать и вставить
- `SEED_DEV_ADMIN=true` + `SEED_DEV_PASSWORD=...` (для первого запуска)

### 3. Backend
```bash
cd backend
npm install
npm run db:migrate   # применить миграции Drizzle
npm run db:seed      # 16 permissions + 6 ролей + матрица + dev-admin
npm run dev          # http://localhost:8787
```

### 4. Frontend
В другом терминале:
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```
Vite-прокси перенаправит `/api/*` на бэкенд.

---

### Альтернатива: Docker (если по какой-то причине нужен)
В репо лежит `docker-compose.yml` с образом `pgvector/pgvector:pg16`.
Использовать так:
```bash
docker compose up -d
# DATABASE_URL=postgres://feynmap:feynmap@localhost:5432/feynmap
```
Демо-путь — лучше без Docker (быстрее, RAM не ест).

## Демо-сценарий
1. Открыть фронт, ввести тему (например, «TCP handshake» или «Энтропия в термодинамике»).
2. Объяснять короткими сообщениями — Студент будет переспрашивать.
3. Справа в реальном времени обновляется радар компетенций.
4. Через 5–8 ходов — кнопка «Завершить» → финальный отчёт с пробелами и рекомендациями.

## Архитектура
См. [`docs/architecture.drawio`](docs/architecture.drawio) — откройте на
[app.diagrams.net](https://app.diagrams.net).
