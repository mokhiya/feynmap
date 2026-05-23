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
  src/db/  — Drizzle schema + миграции (Phase 1+)
frontend/  — React-приложение, чат + радар + финальный отчёт
docs/      — architecture.drawio
docker/    — initdb (CREATE EXTENSION vector, pgcrypto)
```

## Запуск

### 1. Конфиг
```bash
cp backend/.env.example backend/.env
# заполнить ANTHROPIC_API_KEY и JWT_SECRET (openssl rand -hex 32)
```

### 2. База (Postgres 16 + pgvector)
```bash
docker compose up -d
docker compose logs -f db   # дождаться "database system is ready"
```

### 3. Backend
```bash
cd backend
npm install
npm run db:migrate   # применить миграции Drizzle
npm run db:seed      # роли + permissions + dev-admin (опционально на этом шаге)
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

## Демо-сценарий
1. Открыть фронт, ввести тему (например, «TCP handshake» или «Энтропия в термодинамике»).
2. Объяснять короткими сообщениями — Студент будет переспрашивать.
3. Справа в реальном времени обновляется радар компетенций.
4. Через 5–8 ходов — кнопка «Завершить» → финальный отчёт с пробелами и рекомендациями.

## Архитектура
См. [`docs/architecture.drawio`](docs/architecture.drawio) — откройте на
[app.diagrams.net](https://app.diagrams.net).
